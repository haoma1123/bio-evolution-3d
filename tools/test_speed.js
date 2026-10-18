const http = require('http');
const fs = require('fs');
const path = require('path');
const puppeteer = require('C:/Users/haoma/.openclaw/workspace/skills/browser-automation-puppeteer/node_modules/puppeteer');

const ROOT = 'G:/生物演化-3d';
const PORT = 8798;

const MIME = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p === '/') p = '/index.html';
  const file = path.join(ROOT, p);
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('404'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
    res.end(data);
  });
});

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--use-gl=swiftshader', '--enable-unsafe-swiftshader'] });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERROR:', e.message));
  await page.goto(`http://127.0.0.1:${PORT}/index.html`, { waitUntil: 'load', timeout: 60000 });

  await page.waitForFunction('window.EVO3D && window.EVO3D.ready === true', { timeout: 60000 });
  await sleep(500);

  const readMa = () => page.$eval('#time-slider', el => parseFloat(el.value));

  // step 1: slider 4200, 1x, play, 2s
  await page.$eval('#time-slider', el => { el.value = 4200; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.click('#speed-1x');
  await page.click('#play-btn');
  const a1 = await readMa();
  await sleep(2000);
  const b1 = await readMa();
  const d1 = a1 - b1;

  // step 2: switch to 4x mid-play, 2s
  await page.click('#speed-4x');
  const a4 = await readMa();
  await sleep(2000);
  const b4 = await readMa();
  const d4 = a4 - b4;

  const ratio = d4 / d1;
  console.log('a1=' + a1 + ' b1=' + b1 + ' d1=' + d1.toFixed(2));
  console.log('a4=' + a4 + ' b4=' + b4 + ' d4=' + d4.toFixed(2));
  console.log('ratio d4/d1 = ' + ratio.toFixed(3));

  const ok = ratio >= 3.2 && ratio <= 4.8;
  console.log(ok ? 'RESULT: PASS' : 'RESULT: FAIL');

  await browser.close();
  server.close();
  process.exit(ok ? 0 : 1);
})().catch(e => { console.error('ERROR:', e); process.exit(2); });
