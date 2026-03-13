require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const app = express();
const PORT = process.env.PORT || 3001;
const ODP_ENDPOINT = 'https://api.eu1.odp.optimizely.com/v3/graphql';
const RESULTS_DIR  = path.join(__dirname, 'results');
const INDEX_FILE   = path.join(__dirname, 'results-index.json');

app.use(cors());
app.use(express.json());
app.use('/results', express.static(RESULTS_DIR));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/results-index', (_req, res) => {
  if (!fs.existsSync(INDEX_FILE)) return res.json([]);
  try {
    res.json(JSON.parse(fs.readFileSync(INDEX_FILE, 'utf8')));
  } catch (e) {
    res.status(500).json({ error: 'Failed to read index' });
  }
});

app.get('/api/results/:filename', (req, res) => {
  const file = path.join(RESULTS_DIR, path.basename(req.params.filename));
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  try {
    res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
  } catch (e) {
    res.status(500).json({ error: 'Failed to read file' });
  }
});

app.post('/api/audience-check', async (req, res) => {
  const apiKey = process.env.ODP_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ODP_API_KEY not set in .env' });
  }

  const { visitorId, audienceNames } = req.body;
  if (!visitorId || typeof visitorId !== 'string') {
    return res.status(400).json({ error: 'visitorId (string) and audienceNames (non-empty array) are required' });
  }
  if (!Array.isArray(audienceNames) || audienceNames.length === 0) {
    return res.status(400).json({ error: 'visitorId (string) and audienceNames (non-empty array) are required' });
  }

  const query = `
    query AudienceCheck($userId: String!, $audiences: [String!]!) {
      customer(web_user_id: $userId) {
        audiences(subset: $audiences) {
          edges {
            node {
              name
              state
              description
              is_ready
            }
          }
        }
      }
    }
  `;

  try {
    const odpRes = await fetch(ODP_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      body: JSON.stringify({ query, variables: { userId: visitorId, audiences: audienceNames } }),
    });

    const data = await odpRes.json();
    res.status(odpRes.status).json(data);
  } catch (err) {
    res.status(502).json({ error: 'Failed to reach ODP endpoint', details: err.message });
  }
});

app.listen(PORT, () => {
  console.log(`ODP proxy server running on http://localhost:${PORT}`);
  console.log(`Endpoint: ${ODP_ENDPOINT}`);
});
