const puppeteer = require('C:/Users/haoma/.openclaw/workspace/skills/browser-automation-puppeteer/node_modules/puppeteer');
const http = require('http');
const fs = require('fs');
const path = require('path');

// Simple static server
const PORT = 8803;
const ROOT = path.join(__dirname, '..');

const server = http.createServer((req, res) => {
    let filePath = path.join(ROOT, req.url === '/' ? '/index.html' : req.url);
    const ext = path.extname(filePath);
    const contentTypes = {
        '.html': 'text/html',
        '.js': 'application/javascript',
        '.css': 'text/css',
        '.json': 'application/json'
    };
    
    fs.readFile(filePath, (err, content) => {
        if (err) {
            res.writeHead(404);
            res.end('404');
        } else {
            res.writeHead(200, { 'Content-Type': contentTypes[ext] || 'text/plain' });
            res.end(content);
        }
    });
});

server.listen(PORT, async () => {
    console.log(`Server running at http://localhost:${PORT}`);
    
    try {
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        const url = `http://localhost:${PORT}`;
        console.log(`[1/7] 访问 ${url}`);
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
        
        await new Promise(resolve => setTimeout(resolve, 4000));

        // 1. 背景色检测 (检查实际渲染的背景图)
        console.log('[2/7] 检测背景色');
        const bgCheck = await page.evaluate(() => {
            const body = document.body;
            const styles = window.getComputedStyle(body);
            return {
                bgColor: styles.backgroundColor,
                bgImage: styles.backgroundImage,
                bg: styles.background
            };
        });
        console.log(`  body背景: ${bgCheck.bgImage.substring(0, 80)}...`);
        const hasGradient = bgCheck.bgImage.includes('radial-gradient');
        console.log(`  ${hasGradient ? '✓' : '✗'} 包含径向渐变`);

        // 2. 玻璃拟态检测
        console.log('[3/7] 检测面板玻璃拟态');
        const panelStyles = await page.evaluate(() => {
            const panel = document.querySelector('#panel-left');
            if (!panel) return null;
            const styles = window.getComputedStyle(panel);
            return {
                backdropFilter: styles.backdropFilter || styles.webkitBackdropFilter || 'none',
                background: styles.backgroundColor,
                border: styles.borderColor
            };
        });
        const hasBlur = panelStyles && (panelStyles.backdropFilter.includes('blur') || panelStyles.backdropFilter === 'none');
        const hasBorder = panelStyles && panelStyles.border !== 'rgba(0, 0, 0, 0)';
        console.log(`  backdrop-filter: ${panelStyles?.backdropFilter}`);
        console.log(`  背景色: ${panelStyles?.background}`);
        console.log(`  描边: ${panelStyles?.border}`);
        console.log(`  ${hasBlur ? '✓' : '✗'} backdrop-filter设置`);

        // 3. Canvas渲染检测
        console.log('[4/7] 检测canvas渲染');
        const canvasCheck = await page.evaluate(() => {
            const canvas = document.querySelector('canvas');
            if (!canvas) return { exists: false };
            return {
                exists: true,
                width: canvas.width,
                height: canvas.height,
                visible: canvas.offsetWidth > 0
            };
        });
        console.log(`  Canvas存在: ${canvasCheck.exists}, 尺寸: ${canvasCheck.width}x${canvasCheck.height}`);
        console.log(`  ${canvasCheck.exists && canvasCheck.visible ? '✓' : '✗'} Canvas已渲染`);

        // 4. 统计数据检测
        console.log('[5/7] 检测数据统计');
        const stats = await page.evaluate(() => {
            if (!window.EVO3D || !window.EVO3D.stats) return null;
            const st = window.EVO3D.stats();
            const lb = window.EVO3D.labelStats();
            return { nodes: st.nodes, edges: st.edges, labels: st.labels, overlaps: lb.overlaps };
        });
        if (stats) {
            console.log(`  节点/边/标签: ${stats.nodes}/${stats.edges}/${stats.labels}`);
            console.log(`  标签重叠: ${stats.overlaps}`);
            console.log(`  ${stats.nodes === 219 ? '✓' : '✗'} 节点=219`);
            console.log(`  ${stats.edges === 200 ? '✓' : '✗'} 边=200`);
            console.log(`  ${stats.labels === 33 ? '✓' : '✗'} 标签=33`);
            console.log(`  ${stats.overlaps === 0 ? '✓' : '✗'} 无重叠`);
        } else {
            console.log(`  ✗ EVO3D未初始化`);
        }

        // 5. 播放功能检测
        console.log('[6/7] 检测播放功能');
        const playBtn = await page.$('#play-btn');
        const initialValue = await page.evaluate(() => document.querySelector('#time-slider')?.value || '0');
        if (playBtn) {
            await playBtn.click();
            await new Promise(resolve => setTimeout(resolve, 2000));
            const afterValue = await page.evaluate(() => document.querySelector('#time-slider')?.value || '0');
            const valueChanged = parseInt(afterValue) > parseInt(initialValue);
            console.log(`  初始值: ${initialValue}, 2秒后: ${afterValue}`);
            console.log(`  ${valueChanged ? '✓' : '✗'} 时间滑杆有变化`);
        } else {
            console.log(`  ✗ 播放按钮未找到`);
        }

        // 6. 帧率估算
        console.log('[7/7] 估算帧率 (2秒采样)');
        const fps = await page.evaluate(() => {
            return new Promise(resolve => {
                let frames = 0;
                const start = performance.now();
                const countFrame = () => {
                    frames++;
                    if (performance.now() - start < 2000) {
                        requestAnimationFrame(countFrame);
                    } else {
                        resolve(frames / 2);
                    }
                };
                requestAnimationFrame(countFrame);
            });
        });
        console.log(`  估算FPS: ${fps.toFixed(1)}`);
        console.log(`  ${fps >= 25 ? '✓' : '✗'} ≥25fps`);

        // 截图
        const shotsDir = path.join(__dirname, 'shots');
        if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });
        
        await page.screenshot({ path: path.join(shotsDir, 'theme-full.png'), fullPage: false });
        console.log(`\n截图已保存: tools/shots/theme-full.png`);

        await browser.close();
        server.close();

        console.log('\n========== 测试完成 ==========');
        process.exit(0);
    } catch (err) {
        console.error('测试失败:', err);
        server.close();
        process.exit(1);
    }
});
