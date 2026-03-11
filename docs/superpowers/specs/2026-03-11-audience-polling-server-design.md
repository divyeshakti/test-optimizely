# Audience Polling Server — Design Spec
**Date:** 2026-03-11
**Status:** Approved

---

## Overview

Add a local Express server (`server/`) that proxies ODP GraphQL audience-check calls on behalf of the browser, eliminating CORS restrictions. Enhance the existing "Audience Polling" tab in `index.html` to call the local server and display live `is_ready` results inline.

---

## Goals

- Browser can execute a live ODP audience check without CORS issues
- API key is kept server-side in `.env`, never exposed to the browser
- Europe endpoint (`https://api.eu1.odp.optimizely.com/v3/graphql`) is the default
- The existing curl-generator section is preserved; the live-check section is added below it
- Page flow guards: visitor ID must exist and server must be running before the check can be triggered

---

## Non-Goals

- No real-time SSE polling loop (one-shot on button click only)
- No deployment — local dev tool only
- No endpoint selection server-side (Europe is hardcoded)

---

## Repository Structure

```
/optimizely
  index.html                          ← existing, Audience Polling tab enhanced
  server/
    server.js                         ← Express proxy server
    package.json                      ← dependencies: express, cors, dotenv, node-fetch
    .env.example                      ← ODP_API_KEY=your_key_here (committed)
    .env                              ← ODP_API_KEY=<real key> (gitignored)
```

---

## Server Design (`server/server.js`)

### Dependencies
- `express` — HTTP server
- `cors` — CORS middleware, allows all origins (local dev)
- `dotenv` — loads `.env`
- `node-fetch@2` — HTTP client for ODP GraphQL calls (v2 is CommonJS-compatible; v3+ is ESM-only). Pin as `"node-fetch": "^2.7.0"` in `package.json`.

### Endpoints

#### `GET /health`
Returns `{ "status": "ok" }` with 200.
Used by the browser to poll whether the server is running (every 3 seconds).

#### `POST /api/audience-check`
**Request body:**
```json
{
  "visitorId": "oeu1773145893729r0.599...",
  "audienceNames": ["zeotap_1480882676452872192"]
}
```

**Server behaviour:**
1. Read `ODP_API_KEY` from `process.env`; return 500 `{ error: "ODP_API_KEY not set in .env" }` if missing
2. Validate request body: if `visitorId` (string) or `audienceNames` (non-empty array) are missing/invalid, return 400 `{ error: "visitorId (string) and audienceNames (non-empty array) are required" }`
3. Build GraphQL query filtering by `audienceNames`
3. POST to `https://api.eu1.odp.optimizely.com/v3/graphql` with headers `x-api-key` and `Content-Type: application/json`
4. Return ODP response JSON as-is with 200
5. If ODP returns HTTP 200 but the body contains a top-level `errors` array (standard GraphQL error), the server returns 200 with the body unchanged; the browser surfaces `errors[0].message` in the error card
6. If ODP returns a non-200 HTTP status, forward the status code and raw body to the client

**GraphQL query shape:**

Uses `web_user_id` — matching the existing curl-generator in `index.html`:
```graphql
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
```

### CORS
`cors()` middleware with no restriction — allows all origins. Suitable for local dev (`file://` and `http://localhost`).

### Port
`3001` (configurable via `PORT` env var).

---

## UI Changes (`index.html` — Audience Polling tab)

### Existing section
The curl-generator section (API key input, endpoint selector, audience names input, visitor ID input, Generate curl button, curl output cards) is **unchanged**.

### New "Live Check" section (added below curl output cards)

#### Server Status card
- On page load and every 3 seconds: `fetch('http://localhost:3001/health')`
- Shows: `● Server: Running` (green) or `● Server: Not running — start with: cd server && node server.js` (red)
- If server transitions from running → not running (poll fails after previously succeeding), the "Run Live Check" button is disabled again and the red indicator re-appears

#### Visitor ID status
- Reuses existing Optimizely visitor ID polling logic
- Shows: `● Visitor ID: <id>` (green) or `● Visitor ID: Not available yet` (amber)

#### "Run Live Check" button
- Disabled (greyed) unless server is running AND visitor ID is available
- Reads visitor ID from the existing `#odp-vuid` field (which is already auto-populated from `window.optimizely.get('visitor_id').randomId` and supports manual override)
- Uses audience names from `#odp-audience-names` field; defaults to `zeotap_1480882676452872192` if empty (this default is environment-specific — it may not exist in all ODP accounts; a UI note warns the user)
- The API key and endpoint fields in the curl-generator section above are **not used** by the live check — the server reads the key from `.env` and hardcodes the EU endpoint. A note in the UI makes this explicit.

#### Result card (shown after successful check)
One row per audience edge returned:

| Field | Display |
|-------|---------|
| `name` | Audience name (monospace) |
| `state` | Badge: `qualified` (green) / `not_qualified` (grey) / other (amber) |
| `description` | Plain text |
| `is_ready` | Prominent indicator: ✓ **Ready** (green) / ✗ **Not Ready** (red) |

If `edges` is empty (audience not matched), show: "No audience segments returned — the audience may not exist in this ODP account."

If the API returns an error (HTTP non-200 or GraphQL `errors` array), show an error card with the message from `errors[0].message` or the raw HTTP error body.

---

## Page Flow

```
Page load
  │
  ├─ Poll /health every 3s → update server status indicator
  ├─ Poll window.optimizely visitor ID → update visitor ID indicator
  │
  └─ Both green?
       │
       └─ "Run Live Check" button enabled
            │
            └─ User clicks
                 │
                 └─ POST /api/audience-check { visitorId, audienceNames }
                      │
                      ├─ Success → render result rows with is_ready indicator
                      └─ Error   → render error card
```

---

## Environment Setup

`server/.env.example`:
```
ODP_API_KEY=your_odp_private_api_key_here
```

`server/.gitignore` (or root `.gitignore` updated):
```
server/.env
```

User copies `.env.example` → `.env` and fills in the key before starting the server.

---

## Start Instructions (shown in UI)

```
cd server
npm install
node server.js
```

---

## Security Notes

- `ODP_API_KEY` never leaves the server process
- CORS is open only because this is a local dev tool; not suitable for production deployment
- `.env` is gitignored
