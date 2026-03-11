#!/usr/bin/env node
/**
 * Zeotap → ODP Audience Latency Test
 *
 * Fires N events in parallel (each with a unique visitor ID) to Zeotap,
 * then polls ODP until each visitor appears in the target audience.
 * Writes live results to test-results.json for the HTML page to consume.
 *
 * Usage:
 *   node latency-test.js [options]
 *
 * Options (all optional, env vars also accepted):
 *   --count          N events to fire in parallel            (default: 1)
 *   --write-key      Zeotap write key                        (default: 18116ee9-...)
 *   --audiences      Comma-separated audience names          (default: zeotap_1480882676452872192)
 *   --poll-interval  Poll interval in ms                     (default: 2000)
 *   --timeout        Max wait per visitor in ms              (default: 120000)
 *   --page-url       Page URL embedded in the event          (default: http://127.0.0.1:8080/)
 *   --odp-api-key    ODP API key (or set ODP_API_KEY in .env)
 */

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');

const RESULTS_DIR  = path.join(__dirname, 'results');
const INDEX_FILE   = path.join(__dirname, 'results-index.json');
const ODP_ENDPOINT = 'https://api.eu1.odp.optimizely.com/v3/graphql';
const ZEOTAP_URL = 'https://spl.zeotap.com/fp?cookieSync=false&identify=true&optin=yes&track=true';

// --- arg parsing ---
function arg(flag, env, def) {
  const idx = process.argv.indexOf(flag);
  if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
  if (env && process.env[env]) return process.env[env];
  return def;
}

const COUNT          = parseInt(arg('--count',         null,          '1'), 10);
const WRITE_KEY      = arg('--write-key',     'ZEOTAP_WRITE_KEY', '18116ee9-c6e4-4f8a-9345-2efe472deccf');
const AUDIENCE_NAMES = arg('--audiences',     'ODP_AUDIENCES',    'zeotap_1480882676452872192').split(',').map(s => s.trim());
const POLL_INTERVAL  = parseInt(arg('--poll-interval', null,          '2000'), 10);
const TIMEOUT_MS     = parseInt(arg('--timeout',       null,          '120000'), 10);
const PAGE_URL       = arg('--page-url',      null,                'http://127.0.0.1:8080/');
const ODP_API_KEY    = arg('--odp-api-key',   'ODP_API_KEY',       null);

// --- helpers ---
function uuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function shortId() {
  return uuid().replace(/-/g, '').slice(0, 21);
}

let RESULTS_FILE = null;

function save(data) {
  if (RESULTS_FILE) {
    fs.writeFileSync(RESULTS_FILE, JSON.stringify(data, null, 2));
  }
}

function updateIndex(entry) {
  let index = [];
  if (fs.existsSync(INDEX_FILE)) {
    try { index = JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')); } catch (_) {}
  }
  const existing = index.findIndex(e => e.batchId === entry.batchId);
  if (existing !== -1) {
    index[existing] = entry;
  } else {
    index.unshift(entry);
  }
  fs.writeFileSync(INDEX_FILE, JSON.stringify(index, null, 2));
}

// --- main ---
async function runVisitor(index, batchMeta) {
  const visitorId = `oeu${Date.now()}r${Math.random()}`;
  const zs = uuid();
  const zi = uuid();

  const entry = {
    index,
    visitorId,
    zs,
    zi,
    status: 'firing',
    eventFiredAt: null,
    eventHttpStatus: null,
    eventError: null,
    polls: [],
    resolvedAt: null,
    resolvedAfterMs: null,
  };

  // Write initial state
  batchMeta.visitors[index] = entry;
  save(batchMeta);

  // Fire Zeotap event — start clock BEFORE the request so we measure from
  // the moment Zeotap receives it, not after we get the HTTP response back.
  const payload = {
    events: [{
      event: { id: shortId(), eventName: 'pageView', eventTimestamp: Date.now() },
      user: { zs, zi, zi_domain: '.127.0.0.1' },
      page: {
        path: '/',
        referrer: '',
        url: PAGE_URL,
        optimizely_visitor_id: visitorId,
      },
      meta: {},
      version: '4.4.5',
    }],
  };

  // Clock starts the moment we send the request
  const started = Date.now();

  try {
    const res = await fetch(ZEOTAP_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json;charset=UTF-8',
        'Authorization': `Basic ${Buffer.from(`w_k:${WRITE_KEY}`).toString('base64')}`,
        'Origin': 'http://127.0.0.1:8080',
        'Referer': 'http://127.0.0.1:8080/',
      },
      body: JSON.stringify(payload),
    });
    entry.eventFiredAt = new Date().toISOString();
    entry.eventHttpStatus = res.status;
    entry.eventRttMs = Date.now() - started; // how long Zeotap took to respond
    entry.status = 'polling';
    console.log(`[${index}] Event fired  visitorId=${visitorId}  HTTP ${res.status}  RTT ${entry.eventRttMs}ms`);
  } catch (err) {
    entry.eventError = err.message;
    entry.status = 'error';
    console.error(`[${index}] Event failed: ${err.message}`);
    save(batchMeta);
    return;
  }

  save(batchMeta);

  if (!ODP_API_KEY) {
    entry.status = 'no-odp-key';
    entry.eventError = 'ODP_API_KEY not set — skipping audience poll';
    console.warn(`[${index}] No ODP_API_KEY — skipping poll`);
    save(batchMeta);
    return;
  }

  // Poll ODP — first poll fires immediately (no initial delay), then every POLL_INTERVAL.
  const gql = `
    query AudienceCheck($userId: String!, $audiences: [String!]!) {
      customer(web_user_id: $userId) {
        audiences(subset: $audiences) {
          edges { node { name state description is_ready } }
        }
      }
    }
  `;

  await new Promise(resolve => {
    function poll() {
      const elapsed = Date.now() - started;

      if (elapsed > TIMEOUT_MS) {
        entry.status = 'timeout';
        console.log(`[${index}] Timed out after ${elapsed}ms`);
        save(batchMeta);
        return resolve();
      }

      fetch(ODP_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ODP_API_KEY },
        body: JSON.stringify({ query: gql, variables: { userId: visitorId, audiences: AUDIENCE_NAMES } }),
      })
        .then(r => r.json())
        .then(data => {
          const edges = (data.data && data.data.customer && data.data.customer.audiences && data.data.customer.audiences.edges) || [];
          const pollEntry = {
            ts: new Date().toISOString(),
            elapsedMs: Date.now() - started,
            audiences: edges.map(e => e.node),
            error: null,
          };
          entry.polls.push(pollEntry);

          const allReady = edges.length > 0 && edges.every(e => e.node.is_ready);
          if (allReady) {
            entry.resolvedAt = new Date().toISOString();
            entry.resolvedAfterMs = Date.now() - started;
            entry.status = 'resolved';
            console.log(`[${index}] Resolved in ${entry.resolvedAfterMs}ms`);
            save(batchMeta);
            return resolve();
          }

          console.log(`[${index}] Poll at ${pollEntry.elapsedMs}ms — not ready yet`);
          save(batchMeta);
          setTimeout(poll, POLL_INTERVAL);
        })
        .catch(err => {
          const pollEntry = { ts: new Date().toISOString(), elapsedMs: Date.now() - started, audiences: null, error: err.message };
          entry.polls.push(pollEntry);
          console.error(`[${index}] Poll error: ${err.message}`);
          save(batchMeta);
          setTimeout(poll, POLL_INTERVAL);
        });
    }

    // First poll fires immediately; subsequent polls wait POLL_INTERVAL
    if (entry.polls.length === 0) poll(); else setTimeout(poll, POLL_INTERVAL);
  });
}

async function main() {
  if (!ODP_API_KEY) {
    console.warn('Warning: ODP_API_KEY not set — events will fire but audience polling will be skipped.');
  }

  if (!fs.existsSync(RESULTS_DIR)) {
    fs.mkdirSync(RESULTS_DIR, { recursive: true });
  }

  const batchId = uuid();
  const startedAt = new Date().toISOString();
  const timestamp = startedAt.replace(/:/g, '-').replace(/\..+/, '');
  const filename = `results-${timestamp}.json`;
  RESULTS_FILE = path.join(RESULTS_DIR, filename);

  const batchMeta = {
    batchId,
    filename,
    startedAt,
    finishedAt: null,
    config: {
      count: COUNT,
      writeKey: WRITE_KEY,
      audienceNames: AUDIENCE_NAMES,
      pollIntervalMs: POLL_INTERVAL,
      timeoutMs: TIMEOUT_MS,
      pageUrl: PAGE_URL,
    },
    visitors: new Array(COUNT).fill(null),
  };

  save(batchMeta);
  updateIndex({
    batchId,
    filename,
    startedAt,
    finishedAt: null,
    count: COUNT,
    audienceNames: AUDIENCE_NAMES,
    status: 'running',
  });
  console.log(`Starting batch: ${COUNT} visitor(s) — results → ${RESULTS_FILE}`);

  await Promise.all(
    Array.from({ length: COUNT }, (_, i) => runVisitor(i, batchMeta))
  );

  batchMeta.finishedAt = new Date().toISOString();
  save(batchMeta);

  const resolvedVisitors = batchMeta.visitors.filter(v => v && v.status === 'resolved');
  const avgMs = resolvedVisitors.length
    ? Math.round(resolvedVisitors.reduce((s, v) => s + v.resolvedAfterMs, 0) / resolvedVisitors.length)
    : null;

  updateIndex({
    batchId,
    filename,
    startedAt,
    finishedAt: batchMeta.finishedAt,
    count: COUNT,
    audienceNames: AUDIENCE_NAMES,
    status: 'done',
    resolved: resolvedVisitors.length,
    avgMs,
  });

  console.log(`\nDone. Results written to ${RESULTS_FILE}`);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
