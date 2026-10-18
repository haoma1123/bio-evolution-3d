const puppeteer = require('C:/Users/haoma/.openclaw/workspace/skills/browser-automation-puppeteer/node_modules/puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

// 简单的静态文件服务器
function startServer(port, rootDir) {
    const server = http.createServer((req, res) => {
        // Strip query string
        let urlPath = req.url.split('?')[0];
        let filePath = path.join(rootDir, urlPath === '/' ? 'index.html' : urlPath);
        
        console.log('Request:', req.url, '-> File:', filePath);
        
        const ext = path.extname(filePath);
        const contentTypes = {
            '.html': 'text/html',
            '.js': 'text/javascript',
            '.css': 'text/css',
            '.json': 'application/json',
            '.png': 'image/png',
            '.jpg': 'image/jpeg'
        };
        
        fs.readFile(filePath, (err, data) => {
            if (err) {
                console.error('File not found:', filePath);
                res.writeHead(404);
                res.end('Not found');
                return;
            }
            // Disable caching
            res.writeHead(200, { 
                'Content-Type': contentTypes[ext] || 'text/plain',
                'Cache-Control': 'no-cache, no-store, must-revalidate',
                'Pragma': 'no-cache',
                'Expires': '0'
            });
            res.end(data);
        });
    });
    
    server.listen(port);
    return server;
}

async function testUILayout() {
    const projectDir = 'G:\\生物演化-3d';
    const server = startServer(8801, projectDir);
    
    console.log('启动测试服务器: http://localhost:8801');
    
    const browser = await puppeteer.launch({ headless: true });
    const page = await browser.newPage();
    await page.setCacheEnabled(false);
    await page.setViewport({ width: 1920, height: 1080 });
    
    try {
        await page.goto('http://localhost:8801', { waitUntil: 'load' });
        
        // 等待控制面板加载完成
        await page.waitForSelector('#panel-left', { timeout: 5000 });
        await page.waitForSelector('#play-btn', { timeout: 5000 });
        
        // 等待 CSS 完全加载和应用（关键！）
        await new Promise(resolve => setTimeout(resolve, 3000));
        
        console.log('\n✓ 页面加载完成\n');
        
        // Debug: Check if CSS is actually applied
        const cssDebug = await page.evaluate(() => {
            const playBtn = document.getElementById('play-btn');
            const computed = window.getComputedStyle(playBtn);
            
            // Check all stylesheets
            let btnPrimaryFound = false;
            let totalSheets = document.styleSheets.length;
            for (let sheet of document.styleSheets) {
                try {
                    for (let rule of sheet.cssRules) {
                        if (rule.selectorText === '.btn-primary') {
                            btnPrimaryFound = true;
                        }
                    }
                } catch (e) {}
            }
            
            return {
                className: playBtn.className,
                computedHeight: computed.height,
                computedPadding: computed.padding,
                computedDisplay: computed.display,
                totalStyleSheets: totalSheets,
                btnPrimaryRuleFound: btnPrimaryFound
            };
        });
        console.log('CSS Debug:', cssDebug);
        console.log('');
        
        // 获取所有按钮的位置和尺寸
        const buttons = await page.evaluate(() => {
            const ids = ['play-btn', 'reset-time-btn', 'speed-1x', 'speed-4x', 'speed-16x'];
            const panel = document.getElementById('panel-left');
            const panelRect = panel.getBoundingClientRect();
            
            return ids.map(id => {
                const el = document.getElementById(id);
                const rect = el.getBoundingClientRect();
                const style = window.getComputedStyle(el);
                
                return {
                    id,
                    rect: {
                        x: Math.round(rect.x),
                        y: Math.round(rect.y),
                        width: Math.round(rect.width),
                        height: Math.round(rect.height),
                        right: Math.round(rect.right)
                    },
                    textNoWrap: el.scrollWidth <= el.clientWidth + 1 && el.scrollHeight <= el.clientHeight + 1,
                    panelRight: Math.round(panelRect.right)
                };
            });
        });
        
        // 打印结果
        console.log('=== 按钮尺寸与位置 ===\n');
        let allPass = true;
        
        buttons.forEach(btn => {
            console.log(`${btn.id}:`);
            console.log(`  位置: (${btn.rect.x}, ${btn.rect.y})`);
            console.log(`  尺寸: ${btn.rect.width} × ${btn.rect.height} px`);
            
            // 检查高度
            const heightPass = btn.rect.height >= 36;
            console.log(`  高度检查: ${heightPass ? '✓' : '✗'} (${btn.rect.height}px >= 36px)`);
            if (!heightPass) allPass = false;
            
            // 检查文字不换行
            console.log(`  文字换行检查: ${btn.textNoWrap ? '✓' : '✗'}`);
            if (!btn.textNoWrap) allPass = false;
            
            // 检查不溢出面板
            const overflowPass = btn.rect.right <= btn.panelRight - 8;
            console.log(`  溢出检查: ${overflowPass ? '✓' : '✗'} (right=${btn.rect.right}, panel-right=${btn.panelRight}, margin=8px)`);
            if (!overflowPass) allPass = false;
            
            console.log('');
        });
        
        // 截图
        const shotsDir = path.join(projectDir, 'tools', 'shots');
        if (!fs.existsSync(shotsDir)) {
            fs.mkdirSync(shotsDir, { recursive: true });
        }
        
        // 控制面板截图
        const panelClip = await page.evaluate(() => {
            const panel = document.getElementById('panel-left');
            const rect = panel.getBoundingClientRect();
            return {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height
            };
        });
        await page.screenshot({ 
            path: path.join(shotsDir, 'ui-controls.png'),
            clip: panelClip
        });
        
        // 整页截图
        await page.screenshot({ 
            path: path.join(shotsDir, 'ui-full.png'),
            fullPage: true
        });
        
        console.log('=== 截图已保存 ===');
        console.log(`  控制面板: ${path.join(shotsDir, 'ui-controls.png')}`);
        console.log(`  整页: ${path.join(shotsDir, 'ui-full.png')}\n`);
        
        console.log(`=== 测试结果: ${allPass ? '✓ 全部通过' : '✗ 有失败项'} ===\n`);
        
        process.exit(allPass ? 0 : 1);
        
    } catch (error) {
        console.error('测试失败:', error);
        process.exit(1);
    } finally {
        await browser.close();
        server.close();
    }
}

testUILayout();
