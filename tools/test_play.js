const puppeteer = require('C:/Users/haoma/.openclaw/workspace/skills/browser-automation-puppeteer/node_modules/puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = 8796;
const ROOT = 'G:\\生物演化-3d';

const server = http.createServer((req, res) => {
    let filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url);
    const ext = path.extname(filePath);
    const mimeTypes = {
        '.html': 'text/html',
        '.js': 'text/javascript',
        '.css': 'text/css',
        '.json': 'application/json'
    };
    
    fs.readFile(filePath, (err, data) => {
        if (err) {
            res.writeHead(404);
            res.end('Not Found');
            return;
        }
        res.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'text/plain' });
        res.end(data);
    });
});

(async () => {
    server.listen(PORT);
    console.log(`Server on http://localhost:${PORT}`);
    
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    
    const errors = [];
    page.on('console', msg => {
        if (msg.type() === 'error') errors.push(msg.text());
    });
    
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'networkidle2' });
    await page.waitForSelector('#play-btn', { timeout: 5000 });
    
    // Set slider to 4200 first
    await page.$eval('#time-slider', el => el.value = '4200');
    await page.$eval('#time-slider', el => el.dispatchEvent(new Event('input', { bubbles: true })));
    await new Promise(r => setTimeout(r, 200));
    
    // Test 1: Play advances ma (should decrease)
    const ma0 = await page.evaluate(() => parseFloat(document.getElementById('time-slider').value));
    await page.click('#play-btn');
    await new Promise(r => setTimeout(r, 3000));
    const ma1 = await page.evaluate(() => parseFloat(document.getElementById('time-slider').value));
    const changed = (ma0 - ma1) > 500; // Should decrease by ~630 in 3s at 1x
    console.log(`[1] ma changed: ${ma0} -> ${ma1}, delta=${ma0-ma1} (${changed ? 'PASS' : 'FAIL'})`);
    
    // Test 2: Play to end
    await page.click('#reset-time-btn');
    await new Promise(r => setTimeout(r, 200));
    await page.click('#play-btn');
    await new Promise(r => setTimeout(r, 21000));
    const maFinal = await page.evaluate(() => parseFloat(document.getElementById('time-slider').value));
    const btnText = await page.$eval('#play-btn', el => el.textContent);
    const reachedEnd = maFinal === 0 && btnText.includes('重播');
    console.log(`[2] End: ma=${maFinal}, btn="${btnText}" (${reachedEnd ? 'PASS' : 'FAIL'})`);
    
    // Test 3: Speed 4x
    await page.$eval('#time-slider', el => el.value = '4200');
    await page.$eval('#time-slider', el => el.dispatchEvent(new Event('input')));
    await new Promise(r => setTimeout(r, 100));
    await page.click('#play-btn');
    await new Promise(r => setTimeout(r, 2000));
    const delta1x = 4200 - await page.evaluate(() => parseFloat(document.getElementById('time-slider').value));
    await page.click('#play-btn'); // pause
    
    await page.$eval('#time-slider', el => el.value = '4200');
    await page.$eval('#time-slider', el => el.dispatchEvent(new Event('input')));
    await page.click('#speed-4x');
    await new Promise(r => setTimeout(r, 100));
    await page.click('#play-btn');
    await new Promise(r => setTimeout(r, 2000));
    const delta4x = 4200 - await page.evaluate(() => parseFloat(document.getElementById('time-slider').value));
    const ratio = delta4x / delta1x;
    const speedOk = ratio > 2.4 && ratio < 5.6; // 4x ± 40%
    console.log(`[3] Speed: 1x=${delta1x.toFixed(0)}, 4x=${delta4x.toFixed(0)}, ratio=${ratio.toFixed(2)} (${speedOk ? 'PASS' : 'FAIL'})`);
    
    // Test 4: No errors
    const noErrors = errors.length === 0;
    console.log(`[4] Console: ${errors.length} errors (${noErrors ? 'PASS' : 'FAIL'})`);
    if (!noErrors) console.log(errors);
    
    const allPass = changed && reachedEnd && speedOk && noErrors;
    console.log(`\n==> ${allPass ? 'ALL PASS' : 'FAILED'}`);
    
    await browser.close();
    server.close();
    process.exit(allPass ? 0 : 1);
})();
