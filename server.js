const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const os = require('os');
const path = require('path');

const PORT = process.env.PORT || 3001;
const YTM_HOST = process.env.YTM_HOST || 'localhost';
const YTM_PORT = process.env.YTM_PORT || 26538;
const YTM_TARGET = `http://${YTM_HOST}:${YTM_PORT}`;

const app = express();

app.use(express.static(path.join(__dirname, 'public')));

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
