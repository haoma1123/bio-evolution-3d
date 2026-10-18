const puppeteer = require('C:/Users/haoma/.openclaw/workspace/skills/browser-automation-puppeteer/node_modules/puppeteer');
const path = require('path');
const fs = require('fs');

(async () => {
    try {
        const browser = await puppeteer.launch({ headless: true });
        const page = await browser.newPage();
        await page.setViewport({ width: 1920, height: 1080 });

        const url = 'http://localhost:8803';
        console.log(`[1/7] 访问 ${url}`);
        await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
        
        await new Promise(resolve => setTimeout(resolve, 4000));

        // 1. 背景检测
        console.log('[2/7] 检测背景样式');
        const bgCheck = await page.evaluate(() => {
            const body = document.body;
            const styles = window.getComputedStyle(body);
            return {
                bgImage: styles.backgroundImage,
                fontFamily: styles.fontFamily
            };
        });
        const hasGradient = bgCheck.bgImage && bgCheck.bgImage.includes('radial-gradient');
        const hasMonospace = bgCheck.fontFamily && (bgCheck.fontFamily.includes('monospace') || bgCheck.fontFamily.includes('Consolas'));
        console.log(`  ${hasGradient ? '✓' : '✗'} 径向渐变背景`);
        console.log(`  ${hasMonospace ? '✓' : '✗'} 等宽字体`);

        // 2. 面板检测
        console.log('[3/7] 检测面板样式');
        const panelStyles = await page.evaluate(() => {
            const panel = document.querySelector('#panel-left');
            if (!panel) return null;
            const styles = window.getComputedStyle(panel);
            return {
                backdropFilter: styles.backdropFilter || styles.webkitBackdropFilter,
                bgColor: styles.backgroundColor,
                borderRadius: styles.borderRadius
            };
        });
        const hasBlur = panelStyles && panelStyles.backdropFilter && panelStyles.backdropFilter.includes('blur');
        const hasAlpha = panelStyles && panelStyles.bgColor && panelStyles.bgColor.includes('rgba');
        console.log(`  ${hasBlur ? '✓' : '✗'} backdrop-filter blur`);
        console.log(`  ${hasAlpha ? '✓' : '✗'} 半透明背景`);

        // 3. Canvas检测
        console.log('[4/7] 检测3D场景');
        const sceneCheck = await page.evaluate(() => {
            const canvas = document.querySelector('canvas');
            const hasEVO3D = window.EVO3D && typeof window.EVO3D.stats === 'function';
            return {
                canvasExists: !!canvas,
                canvasSize: canvas ? `${canvas.width}x${canvas.height}` : 'none',
                evo3dReady: hasEVO3D
            };
        });
        console.log(`  ${sceneCheck.canvasExists ? '✓' : '✗'} Canvas存在 (${sceneCheck.canvasSize})`);
        console.log(`  ${sceneCheck.evo3dReady ? '✓' : '✗'} EVO3D已初始化`);

        // 4. 数据统计
        console.log('[5/7] 检测数据统计');
        let stats = null;
        if (sceneCheck.evo3dReady) {
            stats = await page.evaluate(() => {
                const st = window.EVO3D.stats();
                const lb = window.EVO3D.labelStats();
                return { 
                    nodes: st.nodes, 
                    edges: st.edges, 
                    labels: st.labels, 
                    overlaps: lb.overlaps 
                };
            });
            console.log(`  节点=${stats.nodes}, 边=${stats.edges}, 标签=${stats.labels}, 重叠=${stats.overlaps}`);
            console.log(`  ${stats.nodes === 219 && stats.edges === 200 && stats.labels === 33 && stats.overlaps === 0 ? '✓' : '✗'} 数据完整`);
        } else {
            console.log(`  ✗ 无法获取统计`);
        }

        // 5. 播放功能
        console.log('[6/7] 检测播放功能');
        let playWorks = false;
        const playBtn = await page.$('#play-btn');
        if (playBtn) {
            const initialValue = await page.evaluate(() => document.querySelector('#time-slider').value);
            await playBtn.click();
            await new Promise(resolve => setTimeout(resolve, 2000));
            const afterValue = await page.evaluate(() => document.querySelector('#time-slider').value);
            playWorks = parseInt(afterValue) > parseInt(initialValue);
            console.log(`  初始=${initialValue}, 2秒后=${afterValue}`);
            console.log(`  ${playWorks ? '✓' : '✗'} 时间滑杆变化`);
        } else {
            console.log(`  ✗ 播放按钮未找到`);
        }

        // 6. 帧率
        console.log('[7/7] 估算帧率');
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
        console.log(`  FPS=${fps.toFixed(1)}`);
        console.log(`  ${fps >= 25 ? '✓' : '✗'} ≥25fps`);

        // 截图
        const shotsDir = path.join(__dirname, 'shots');
        if (!fs.existsSync(shotsDir)) fs.mkdirSync(shotsDir, { recursive: true });
        
        await page.screenshot({ path: path.join(shotsDir, 'theme-full.png'), fullPage: false });
        console.log(`\n截图: tools/shots/theme-full.png`);

        await browser.close();

        // 汇总
        console.log('\n========== 测试汇总 ==========');
        const allChecks = {
            '背景渐变': hasGradient,
            '等宽字体': hasMonospace,
            '玻璃拟态': hasBlur && hasAlpha,
            '3D场景': sceneCheck.canvasExists && sceneCheck.evo3dReady,
            '数据完整': stats && stats.nodes === 219 && stats.edges === 200 && stats.labels === 33 && stats.overlaps === 0,
            '播放功能': playWorks,
            '帧率合格': fps >= 25
        };
        
        for (const [key, val] of Object.entries(allChecks)) {
            console.log(`${val ? 'PASS' : 'FAIL'} - ${key}`);
        }
        
        const allPass = Object.values(allChecks).every(v => v);
        process.exit(allPass ? 0 : 1);
    } catch (err) {
        console.error('测试失败:', err.message);
        process.exit(1);
    }
})();
