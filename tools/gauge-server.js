// Simple dev server to update data/risk-data.json gaugeValue field
// Usage: node tools\gauge-server.js
const http = require('http');
const fs = require('fs');
const path = require('path');
const DATA_PATH = path.join(__dirname, '..', 'data', 'risk-data.json');
const PORT = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  // Basic CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }

  if (req.method === 'POST' && req.url === '/updateGauge') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const payload = JSON.parse(body || '{}');
        if (typeof payload.gaugeValue === 'undefined') {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          return res.end(JSON.stringify({ ok: false, error: 'missing gaugeValue' }));
        }
        // Read file
        const raw = fs.readFileSync(DATA_PATH, 'utf8');
        const data = JSON.parse(raw || '{}');
        // Update only the gauge fields (SRT and gaugeValue) if present in payload
        const gv = payload.gaugeValue;
        // Accept numeric or percent string
        let num = gv;
        if (typeof gv === 'string') {
          const cleaned = gv.replace('%','').trim();
          const n = Number(cleaned);
          if (isFinite(n)) num = cleaned + '%';
          else num = gv;
        } else if (typeof gv === 'number') {
          num = String(gv) + '%';
        }
        // Write back compact JSON with 2-space indent to keep repo tidy
        data.gaugeValue = num;
        data.SRT = num;
        fs.writeFileSync(DATA_PATH, JSON.stringify(data, null, 2), 'utf8');
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: true, gaugeValue: num }));
      } catch (e) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ ok: false, error: String(e) }));
      }
    });
    return;
  }

  // Not found
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ ok: false, error: 'not found' }));
});

server.listen(PORT, () => console.log(`Gauge update server listening on http://localhost:${PORT}`));
