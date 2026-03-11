require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fetch = require('node-fetch');

const app = express();
const PORT = process.env.PORT || 3001;
const ODP_ENDPOINT = 'https://api.eu1.odp.optimizely.com/v3/graphql';

app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
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
