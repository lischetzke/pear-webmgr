const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const os = require('os');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const http = require('http');

const PORT = process.env.PORT || 3001;
const YTM_HOST = process.env.YTM_HOST || 'localhost';
const YTM_PORT = process.env.YTM_PORT || 26538;
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

app.listen(PORT, '0.0.0.0', () => {
  const ip = getLanIP();
  console.log(`YTM Web Remote running at:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${ip}:${PORT}`);
  console.log(`  Proxying API to: ${YTM_TARGET}`);
});
