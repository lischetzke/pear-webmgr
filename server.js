require('dotenv').config();

const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const PORT = Number(process.env.PORT || 3001);
const PORT_SSL = Number(process.env.PORT_SSL || PORT + 1);
const YTM_HOST = process.env.YTM_HOST || 'localhost';
const YTM_PORT = process.env.YTM_PORT || 26538;
const USE_SSL = String(process.env.USE_SSL || 'false').toLowerCase() === 'true';
const SSL_KEY_PATH = process.env.SSL_KEY_PATH;
const SSL_CERT_PATH = process.env.SSL_CERT_PATH;
const YTM_TARGET = `http://${YTM_HOST}:${YTM_PORT}`;

const CACHE_DIR = path.join(__dirname, '.img-cache');
if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR);

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

// --- Image cache proxy ---

app.get('/img-cache', (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).end();

  const hash = crypto.createHash('md5').update(url).digest('hex');
  const metaPath = path.join(CACHE_DIR, hash + '.meta');
  const dataPath = path.join(CACHE_DIR, hash + '.bin');

  if (fs.existsSync(dataPath) && fs.existsSync(metaPath)) {
    try {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      res.set('Content-Type', meta.contentType || 'image/jpeg');
      res.set('Cache-Control', 'public, max-age=86400');
      return fs.createReadStream(dataPath).pipe(res);
    } catch {}
  }

  const client = url.startsWith('https') ? https : http;
  client.get(url, (upstream) => {
    if (upstream.statusCode !== 200) {
      return res.status(upstream.statusCode).end();
    }

    const contentType = upstream.headers['content-type'] || 'image/jpeg';
    const chunks = [];

    upstream.on('data', (chunk) => chunks.push(chunk));
    upstream.on('end', () => {
      const buf = Buffer.concat(chunks);
      fs.writeFileSync(dataPath, buf);
      fs.writeFileSync(metaPath, JSON.stringify({ contentType, url }));

      res.set('Content-Type', contentType);
      res.set('Cache-Control', 'public, max-age=86400');
      res.end(buf);
    });
    upstream.on('error', () => res.status(502).end());
  }).on('error', () => res.status(502).end());
});

// --- Shared autoplay state (synced across all web clients) ---

let autoplayEnabled = false;
let autoplayLastTriggeredAt = 0;
const AUTOPLAY_LOCK_MS = 12000; // prevent two clients from double-adding

app.get('/api/webmgr/autoplay', (req, res) => {
  res.json({ enabled: autoplayEnabled });
});

app.post('/api/webmgr/autoplay', express.json(), (req, res) => {
  const { enabled } = req.body;
  if (typeof enabled !== 'boolean') return res.status(400).end();
  autoplayEnabled = enabled;
  res.status(204).end();
});

// Clients call this before adding an autoplay song to claim the right to do so.
// Returns {ok:true} when the caller may proceed; {ok:false} when another client
// already triggered within the lock window or autoplay is disabled.
app.post('/api/webmgr/autoplay/trigger', express.json(), (req, res) => {
  const now = Date.now();
  if (!autoplayEnabled) return res.json({ ok: false });
  if (now - autoplayLastTriggeredAt < AUTOPLAY_LOCK_MS) return res.json({ ok: false });
  autoplayLastTriggeredAt = now;
  res.json({ ok: true });
});

app.use(createProxyMiddleware({
  target: YTM_TARGET,
  changeOrigin: true,
  pathFilter: '/api',
}));

function getLanIP() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        return iface.address;
      }
    }
  }
  return '127.0.0.1';
}

let server;
let listenPort;
let protocol;

if (USE_SSL) {
  if (!SSL_KEY_PATH || !SSL_CERT_PATH) {
    console.error('USE_SSL=true requires SSL_KEY_PATH and SSL_CERT_PATH');
    process.exit(1);
  }

  const keyPath = path.resolve(SSL_KEY_PATH);
  const certPath = path.resolve(SSL_CERT_PATH);
  server = https.createServer({
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certPath),
  }, app);
  listenPort = PORT_SSL;
  protocol = 'https';
} else {
  server = http.createServer(app);
  listenPort = PORT;
  protocol = 'http';
}

server.listen(listenPort, '0.0.0.0', () => {
  const ip = getLanIP();
  console.log(`YTM Web Remote running at:`);
  console.log(`  Local:   ${protocol}://localhost:${listenPort}`);
  console.log(`  Network: ${protocol}://${ip}:${listenPort}`);
  console.log(`  Proxying API to: ${YTM_TARGET}`);
});
