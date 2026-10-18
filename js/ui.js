// ui.js - 交互界面与事件处理（块8）
// 依赖：EVO3D（app.js 暴露的 API）、EVO3D_LAYOUT、EVO_DATA
// 实现：点击节点、搜索、大类筛选、时间游标/播放、预设视角、自动旋转、悬停 tooltip、图例、状态条

(function() {
    'use strict';

    // ========== 状态管理 ==========
    let currentNodeId = null;
    let timePlayback = { playing: false, interval: null, speed: 1 };
    let tooltipElement = null;
    let tourHudElement = null;
    // 年代 HUD 的插值展示值（null = 未初始化/已重置），每帧朝真实年代收敛，避免数字跳变
    let hudMaDisplay = null;

    // ========== 初始化 ==========
    function init() {
        try {
            if (!window.EVO3D || !window.EVO3D_LAYOUT || !window.EVO_DATA) {
                throw new Error('缺少必要依赖');
            }

            // 等待场景就绪
            const checkReady = setInterval(() => {
                if (window.EVO3D.ready) {
                    clearInterval(checkReady);
                    setupUI();
                }
            }, 100);

        } catch (error) {
            console.error('[UI] 初始化失败:', error);
        }
    }

    function setupUI() {
        try {
            // 初始化各模块
            initClickHandler();
            initSearch();
            initTimeControls();
            initTimeModeToggle();
            initViewControls();
            initAutoRotate();
            initTooltip();
            initLegend();
            initTourControls();
            initLabelBudget();
            updateStats();

            console.log('[UI] 界面初始化完成');
        } catch (error) {
            console.error('[UI] 设置失败:', error);
        }
    }

    // ========== 点击节点高亮 ==========
    function initClickHandler() {
        const canvas = document.querySelector('#scene3d canvas');
        if (!canvas) return;

        canvas.addEventListener('click', (e) => {
            try {
                // 漫游中点击画面退出漫游，不触发节点拾取
                if (window.EVO3D.tourActive) {
                    window.EVO3D.stopTour();
                    hidePanels(false);
                    updateTourButton();
                    return;
                }
                
                const nodeId = window.EVO3D.pickAt(e.clientX, e.clientY);
                if (nodeId) {
                    selectNode(nodeId);
                } else {
                    clearSelection();
                }
            } catch (error) {
                console.error('[UI] 点击处理失败:', error);
            }
        });
    }

    function selectNode(nodeId) {
        try {
            currentNodeId = nodeId;
            window.EVO3D.highlightNode(nodeId);
            showNodeInfo(nodeId);
            updateStats();
        } catch (error) {
            console.error('[UI] 选择节点失败:', error);
        }
    }

    function clearSelection() {
        try {
            currentNodeId = null;
            window.EVO3D.clearHighlight();
            hideNodeInfo();
            updateStats();
        } catch (error) {
            console.error('[UI] 清除选择失败:', error);
        }
    }

    function showNodeInfo(nodeId) {
        const node = window.EVO_DATA.nodes.find(n => n.id === nodeId);
        if (!node) return;

        const infoPanel = document.getElementById('node-info');
        if (!infoPanel) return;

        // 计算祖先和后代
        const ancestors = getAncestors(nodeId);
        const descendants = getDescendants(nodeId);

        // 时间信息
        const timeBand = window.EVO3D_LAYOUT.timeBand(node.ma);
        const timeStr = node.ma >= 1000 
            ? (node.ma / 1000).toFixed(1) + ' 十亿年前' 
            : node.ma.toFixed(1) + ' 百万年前';
        const timeRange = node.maRange 
            ? `(${node.maRange[0]} - ${node.maRange[1] || '现在'} Ma)` 
            : '';

        // 祖先列表
        const ancestorLinks = ancestors.slice(0, 5).map(aId => {
            const aNode = window.EVO_DATA.nodes.find(n => n.id === aId);
            return aNode ? `<button class="link-btn" data-id="${aId}">${aNode.zh}</button>` : '';
        }).join(' → ');

        // 后代列表
        const descendantLinks = descendants.slice(0, 8).map(dId => {
            const dNode = window.EVO_DATA.nodes.find(n => n.id === dId);
            return dNode ? `<button class="link-btn" data-id="${dId}">${dNode.zh}</button>` : '';
        }).join(', ');

        // 关键特征列表
        const keyFeatures = (node.key && node.key.length > 0)
            ? '<ul>' + node.key.map(k => '<li>' + k + '</li>').join('') + '</ul>'
            : '<p>无记录</p>';

        // 音译标记（没有权威中文名的冷门类群）
        const _tlMap = (window.EVO_DATA && window.EVO_DATA.nameTl) || {};
        const _isTl = !!_tlMap[node.id];
        infoPanel.innerHTML = `
            <div class="node-name-cn">${node.zh} ${_isTl ? '<span class="name-tl">音译</span>' : ''} ${node.emoji || ''}</div>
            <div class="node-name-lat">${node.latin}</div>
            
            <div class="node-detail"><strong>时间：</strong>${timeStr} ${timeRange}</div>
            <div class="node-detail"><strong>年代：</strong>${timeBand.name} (${timeBand.start}–${timeBand.end} Ma)</div>
            <div class="node-detail"><strong>大类：</strong>${node.clade} ${node.group ? '/ ' + node.group : ''}</div>
            <div class="node-detail"><strong>状态：</strong>${node.extinct ? '已灭绝' : '现存'}</div>
            
            <div class="node-detail">
                <strong>关键特征：</strong>
                ${keyFeatures}
            </div>
            
            ${node.blurb ? '<div class="node-detail"><strong>简介：</strong>' + node.blurb + '</div>' : ''}
            ${node.note ? '<div class="node-detail" style="color:#ff6e40;"><strong>说明：</strong>' + node.note + '</div>' : ''}
            
            ${ancestors.length > 0 ? '<div class="node-detail"><strong>祖先链（最近5代）：</strong><div class="link-chain">' + ancestorLinks + (ancestors.length > 5 ? ' …' : '') + '</div></div>' : ''}
            ${descendants.length > 0 ? '<div class="node-detail"><strong>演化后代（前8个）：</strong><div class="link-chain">' + descendantLinks + (descendants.length > 8 ? ' …' : '') + '</div></div>' : ''}
            
            <button id="clear-selection-btn" style="margin-top:12px;width:100%;padding:8px;background:#333;border:1px solid #555;border-radius:4px;color:#e0e0e0;cursor:pointer;">回到全景</button>
        `;

        // 绑定关系链接点击
        infoPanel.querySelectorAll('.link-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                const targetId = btn.getAttribute('data-id');
                if (targetId) {
                    selectNode(targetId);
                    window.EVO3D.focusNode(targetId);
                }
            });
        });

        // 绑定"回到全景"按钮
        const clearBtn = document.getElementById('clear-selection-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', clearSelection);
        }
    }

    function hideNodeInfo() {
        const infoPanel = document.getElementById('node-info');
        if (infoPanel) {
            infoPanel.innerHTML = '<p class="placeholder">点击节点查看详情</p>';
        }
    }

    function getAncestors(nodeId) {
        const ancestors = [];
        const edges = window.EVO_DATA.edges.filter(e => e.type === 'descent');
        
        function traverse(id) {
            edges.forEach(e => {
                if (e.to === id && !ancestors.includes(e.from)) {
                    ancestors.push(e.from);
                    traverse(e.from);
                }
            });
        }
        
        traverse(nodeId);
        return ancestors;
    }

    function getDescendants(nodeId) {
        const descendants = [];
        const edges = window.EVO_DATA.edges.filter(e => e.type === 'descent');
        
        function traverse(id) {
            edges.forEach(e => {
                if (e.from === id && !descendants.includes(e.to)) {
                    descendants.push(e.to);
                    traverse(e.to);
                }
            });
        }
        
        traverse(nodeId);
        return descendants;
    }

    // ========== 搜索框 ==========
    function initSearch() {
        const searchInput = document.getElementById('search-input');
        const searchResults = document.getElementById('search-results');
        if (!searchInput || !searchResults) return;

        searchInput.addEventListener('input', (e) => {
            try {
                const query = e.target.value.trim().toLowerCase();
                if (query.length === 0) {
                    searchResults.innerHTML = '';
                    return;
                }

                const matches = window.EVO_DATA.nodes.filter(node => {
                    return node.zh.toLowerCase().includes(query) || 
                           node.latin.toLowerCase().includes(query);
                }).slice(0, 8);

                if (matches.length === 0) {
                    searchResults.innerHTML = '<div style="padding:4px;color:#888;">无匹配结果</div>';
                    return;
                }

                searchResults.innerHTML = matches.map(node => 
                    `<div class="search-result-item" data-id="${node.id}">
                        <span style="font-weight:600;">${node.zh}</span>
                        <span style="font-style:italic;color:#b0b0b0;margin-left:4px;">${node.latin}</span>
                        <span style="color:#888;margin-left:8px;">${node.clade}</span>
                    </div>`
                ).join('');

                // 绑定点击事件
                searchResults.querySelectorAll('.search-result-item').forEach(item => {
                    item.addEventListener('click', () => {
                        const nodeId = item.getAttribute('data-id');
                        if (nodeId) {
                            selectNode(nodeId);
                            window.EVO3D.focusNode(nodeId);
                            searchInput.value = '';
                            searchResults.innerHTML = '';
                        }
                    });
                });
            } catch (error) {
                console.error('[UI] 搜索失败:', error);
            }
        });

        // 回车选择第一条
        searchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                const firstItem = searchResults.querySelector('.search-result-item');
                if (firstItem) {
                    firstItem.click();
                }
            }
        });
    }

    // ========== 时间控制 ==========
    function initTimeControls() {
        const slider = document.getElementById('time-slider');
        const display = document.getElementById('time-display');
        const playBtn = document.getElementById('play-btn');
        const resetBtn = document.getElementById('reset-time-btn');
        const speed1x = document.getElementById('speed-1x');
        const speed4x = document.getElementById('speed-4x');
        const speed16x = document.getElementById('speed-16x');
        const followCheckbox = document.getElementById('time-follow-checkbox');
        
        if (!slider || !display || !playBtn || !resetBtn) return;
        
        // 跟随开关
        if (followCheckbox) {
            followCheckbox.checked = true; // 默认勾选
            followCheckbox.addEventListener('change', (e) => {
                try {
                    window.EVO3D.setTimeFollow(e.target.checked);
                } catch (error) {
                    console.error('[UI] 跟随开关失败:', error);
                }
            });
        }
        
        // 速度按钮
        const speedBtns = [speed1x, speed4x, speed16x].filter(b => b);
        const speeds = [1, 4, 16];
        speedBtns.forEach((btn, i) => {
            btn.addEventListener('click', () => {
                try {
                    timePlayback.speed = speeds[i];
                    speedBtns.forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                } catch (error) {
                    console.error('[UI] 速度切换失败:', error);
                }
            });
        });
        if (speed1x) speed1x.classList.add('active');

        // 滑杆拖动
        slider.addEventListener('input', (e) => {
            try {
                const ma = parseFloat(e.target.value);
                updateTimeDisplay(ma);
                window.EVO3D.setTimeCutoff(ma);
            } catch (error) {
                console.error('[UI] 时间滑杆失败:', error);
            }
        });

        // 播放按钮
        playBtn.addEventListener('click', () => {
            try {
                if (timePlayback.playing) {
                    stopTimePlayback();
                    playBtn.textContent = '▶ 播放';
                } else {
                    startTimePlayback();
                    playBtn.textContent = '⏸ 暂停';
                }
            } catch (error) {
                console.error('[UI] 播放控制失败:', error);
            }
        });

        // 重置按钮
        resetBtn.addEventListener('click', () => {
            try {
                stopTimePlayback();
                slider.value = '0';
                updateTimeDisplay(0);
                window.EVO3D.clearTimeCutoff();
                playBtn.textContent = '▶ 播放';
            } catch (error) {
                console.error('[UI] 重置失败:', error);
            }
        });
    }

    function updateTimeDisplay(ma) {
        const display = document.getElementById('time-display');
        if (!display) return;

        const timeBand = window.EVO3D_LAYOUT.timeBand(ma);
        let text;
        
        if (ma >= 1000) {
            text = (ma / 1000).toFixed(2) + ' 十亿年前';
        } else {
            text = ma.toFixed(1) + ' 百万年前';
        }
        
        display.textContent = text + ' (' + timeBand.name + ')';
    }

    function startTimePlayback() {
        const slider = document.getElementById('time-slider');
        if (!slider) return;

        timePlayback.playing = true;
        let currentMa = parseFloat(slider.value);
        
        // 如果已在终点(0)，从头(4200)开始
        if (currentMa === 0) {
            currentMa = 4200;
            slider.value = currentMa;
            updateTimeDisplay(currentMa);
            window.EVO3D.setTimeCutoff(currentMa);
        }
        
        // 60秒走完4200，每50ms tick：4200/(60*1000/50) = 3.5（4×≈15秒，16×≈4秒）
        timePlayback.interval = setInterval(() => {
            const step = timePlayback.speed * 3.5;
            currentMa -= step;
            if (currentMa <= 0) {
                currentMa = 0;
                stopTimePlayback();
                slider.value = 0;
                updateTimeDisplay(0);
                window.EVO3D.setTimeCutoff(0);
                const playBtn = document.getElementById('play-btn');
                if (playBtn) playBtn.textContent = '🔁 重播';
                return;
            }

            slider.value = currentMa;
            updateTimeDisplay(currentMa);
            window.EVO3D.setTimeCutoff(currentMa);
        }, 50);
    }

    function stopTimePlayback() {
        timePlayback.playing = false;
        if (timePlayback.interval) {
            clearInterval(timePlayback.interval);
            timePlayback.interval = null;
        }
    }

    // ========== 时间轴模式切换 ==========
    function initTimeModeToggle() {
        const toggle = document.getElementById('time-mode-toggle');
        if (!toggle) return;

        toggle.addEventListener('change', (e) => {
            try {
                const mode = e.target.checked ? 'even' : 'segment';
                window.EVO3D.setTimeMode(mode);
            } catch (error) {
                console.error('[UI] 时间模式切换失败:', error);
            }
        });
    }

    // ========== 预设视角 ==========
    function initViewControls() {
        const viewBtns = document.querySelectorAll('.view-btn');
        
        viewBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                try {
                    const view = btn.getAttribute('data-view');
                    if (view === 'overview') {
                        window.EVO3D.setPresetView('iso');
                    } else {
                        window.EVO3D.setPresetView(view);
                    }
                } catch (error) {
                    console.error('[UI] 视角切换失败:', error);
                }
            });
        });
    }

    // ========== 自动旋转 ==========
    function initAutoRotate() {
        const toggle = document.getElementById('auto-rotate-toggle');
        if (!toggle) return;

        toggle.addEventListener('change', (e) => {
            try {
                window.EVO3D.autoRotate(e.target.checked);
            } catch (error) {
                console.error('[UI] 自动旋转失败:', error);
            }
        });
    }

    // ========== 悬停 Tooltip ==========
    function initTooltip() {
        const canvas = document.querySelector('#scene3d canvas');
        if (!canvas) return;

        // 创建 tooltip 元素
        tooltipElement = document.createElement('div');
        tooltipElement.id = 'node-tooltip';
        tooltipElement.style.cssText = `
            position: fixed;
            background: rgba(10, 10, 10, 0.95);
            color: #e0e0e0;
            padding: 8px 12px;
            border-radius: 6px;
            border: 1px solid #333;
            font-size: 0.85rem;
            pointer-events: none;
            z-index: 1000;
            display: none;
            max-width: 250px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.5);
        `;
        document.body.appendChild(tooltipElement);

        canvas.addEventListener('mousemove', (e) => {
            try {
                const nodeId = window.EVO3D.pickAt(e.clientX, e.clientY);
                
                if (nodeId) {
                    const node = window.EVO_DATA.nodes.find(n => n.id === nodeId);
                    if (node) {
                        const timeStr = node.ma >= 1000 
                            ? (node.ma / 1000).toFixed(1) + ' 十亿年前' 
                            : node.ma.toFixed(1) + ' 百万年前';
                        
                        tooltipElement.innerHTML = `
                            <div style="font-weight:600;">${node.zh} ${node.emoji || ''}</div>
                            <div style="font-style:italic;color:#b0b0b0;font-size:0.8rem;">${node.latin}</div>
                            <div style="color:#888;margin-top:4px;">${timeStr}</div>
                        `;
                        tooltipElement.style.display = 'block';
                        tooltipElement.style.left = (e.clientX + 15) + 'px';
                        tooltipElement.style.top = (e.clientY + 15) + 'px';
                    }
                } else {
                    tooltipElement.style.display = 'none';
                }
            } catch (error) {
                console.error('[UI] Tooltip 失败:', error);
            }
        });

        canvas.addEventListener('mouseleave', () => {
            tooltipElement.style.display = 'none';
        });
    }

    // ========== 图例生成 ==========
    function initLegend() {
        const container = document.getElementById('clade-legend');
        if (!container) return;
        
        const clades = window.EVO3D_LAYOUT.clades();
        if (!clades || clades.length === 0) return;
        
        container.innerHTML = '';
        clades.forEach(clade => {
            const color = window.EVO3D_LAYOUT.cladeColor(clade.name);
            const item = document.createElement('div');
            item.style.cssText = 'display:flex;align-items:center;margin:6px 0;';
            item.innerHTML = `
                <div style="width:14px;height:14px;border-radius:2px;background:${color};margin-right:8px;flex-shrink:0;"></div>
                <span style="font-size:0.85rem;color:#ddd;">${clade.name}</span>
            `;
            container.appendChild(item);
        });
    }

    // ========== 状态条更新 ==========
    function updateStats() {
        const statsEl = document.getElementById('stats');
        if (!statsEl) return;

        try {
            const stats = window.EVO3D.stats();
            let statusText = `节点: <strong>${stats.nodes}</strong> | 边: <strong>${stats.edges}</strong>`;
            
            if (stats.networkEdges > 0) {
                statusText += ` | 网状边: <strong>${stats.networkEdges}</strong>`;
            }

            if (currentNodeId) {
                const node = window.EVO_DATA.nodes.find(n => n.id === currentNodeId);
                if (node) {
                    statusText += ` | 已选中: <strong>${node.zh}</strong>`;
                }
            }

            statsEl.innerHTML = statusText;
        } catch (error) {
            console.error('[UI] 状态更新失败:', error);
        }
    }

    // ========== 漫游控制 ==========
    function initTourControls() {
        const tourBtn = document.getElementById('tour-btn');
        if (!tourBtn) return;

        // 漫游镜头旋转开关（默认关：画面不旋转）
        const rollBox = document.getElementById('tour-roll-checkbox');
        if (rollBox) {
            const saved = localStorage.getItem('evo3d_tour_roll') === '1';
            rollBox.checked = saved;
            if (window.EVO3D && window.EVO3D.setTourRoll) window.EVO3D.setTourRoll(saved);
            rollBox.addEventListener('change', () => {
                const on = !!rollBox.checked;
                localStorage.setItem('evo3d_tour_roll', on ? '1' : '0');
                if (window.EVO3D && window.EVO3D.setTourRoll) window.EVO3D.setTourRoll(on);
            });
        }

        tourBtn.addEventListener('click', () => {
            try {
                if (window.EVO3D.tourActive) {
                    window.EVO3D.stopTour();
                    hidePanels(false);
                } else {
                    window.EVO3D.startTour();
                    hidePanels(true);
                }
                updateTourButton();
            } catch (error) {
                console.error('[UI] 漫游控制失败:', error);
            }
        });

        // Esc 键退出漫游
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && window.EVO3D.tourActive) {
                window.EVO3D.stopTour();
                hidePanels(false);
                updateTourButton();
            }
        });

        // 创建年代 HUD（三行：年代数字 / 时代名+起止 / 段内位置进度条）
        tourHudElement = document.createElement('div');
        tourHudElement.id = 'tour-hud';
        tourHudElement.style.cssText = 'position:fixed;left:50%;bottom:28px;transform:translateX(-50%);z-index:200;display:none;';

        const hudMa = document.createElement('div');
        hudMa.id = 'tour-hud-ma';
        hudMa.textContent = '—';
        tourHudElement.appendChild(hudMa);

        const hudBand = document.createElement('div');
        hudBand.id = 'tour-hud-band';
        hudBand.textContent = '—';
        tourHudElement.appendChild(hudBand);

        const hudBarRow = document.createElement('div');
        hudBarRow.id = 'tour-hud-bar-row';
        const hudBar = document.createElement('div');
        hudBar.id = 'tour-hud-bar';
        const hudBarFill = document.createElement('div');
        hudBarFill.id = 'tour-hud-bar-fill';
        hudBar.appendChild(hudBarFill);
        const hudBarPct = document.createElement('span');
        hudBarPct.id = 'tour-hud-bar-pct';
        hudBarPct.textContent = '0%';
        hudBarRow.appendChild(hudBar);
        hudBarRow.appendChild(hudBarPct);
        tourHudElement.appendChild(hudBarRow);

        document.body.appendChild(tourHudElement);
    }

    function updateTourButton() {
        const tourBtn = document.getElementById('tour-btn');
        if (!tourBtn) return;
        
        if (window.EVO3D.tourActive) {
            tourBtn.textContent = '■ 退出漫游';
        } else {
            tourBtn.textContent = '▶ 漫游';
        }
    }

    function hidePanels(hide) {
        const panelLeft = document.getElementById('panel-left');
        const panelRight = document.getElementById('panel-right');
        const legend = document.getElementById('legend');
        const header = document.getElementById('header');
        const statusBar = document.getElementById('status-bar');
        
        if (panelLeft) panelLeft.style.display = hide ? 'none' : '';
        if (panelRight) panelRight.style.display = hide ? 'none' : '';
        if (legend) legend.style.display = hide ? 'none' : '';
        // 漫游时连顶栏、右下状态条一起隐藏：顶栏底边有 1px 浅色描边，横贯全屏，
        // 就是漫游画面里看到的那条白线；退出时置空字符串恢复 CSS 默认显示
        if (header) header.style.display = hide ? 'none' : '';
        if (statusBar) statusBar.style.display = hide ? 'none' : '';
        
        if (tourHudElement) {
            tourHudElement.style.display = hide ? 'block' : 'none';
            // 退出漫游时清掉插值状态，下次进入从当前真实年代起步，不留旧数值
            if (!hide) hudMaDisplay = null;
        }
    }

    // 第一行：年代数字（≥1000 Ma 用 Ga 保留 1 位小数）
    function formatHudMa(v) {
        if (v >= 1000) return (v / 1000).toFixed(1) + ' Ga';
        return Math.round(v) + ' Ma';
    }

    // 第二行里的起止范围：两端单位统一（都 Ga 或都 Ma），末段结束显示「今」
    function formatBandRange(band) {
        const endTxt = (band.end <= 0) ? '今' : null;
        if (band.start >= 1000) {
            const s = (band.start / 1000).toFixed(1);
            const e = (band.end >= 1000) ? (band.end / 1000).toFixed(1) + ' Ga'
                      : (endTxt || (Math.round(band.end) + ' Ma'));
            return s + ' Ga – ' + e;
        }
        const s = Math.round(band.start);
        const e = endTxt || (Math.round(band.end) + ' Ma');
        return s + ' – ' + e + (endTxt ? '' : ' Ma');
    }

    // 在动画循环中更新年代 HUD（三个值分别写入子元素，不再整块 textContent）
    function updateTourHud() {
        if (!window.EVO3D || !window.EVO3D.tourActive || !tourHudElement) return;

        try {
            // 优先用漫游当前轨道高度（相机高度含 TOUR_LEAD 偏移，反推会得到错误的年代）
            const trackY = window.EVO3D.tourTrackY;
            const camera = window.__EVO_DEBUG?.camera;
            const hasTrack = (trackY !== null && trackY !== undefined);
            if (!window.EVO3D_LAYOUT || (!hasTrack && !camera)) return;

            const y = hasTrack ? trackY : camera.position.y;
            // 塔式布局必须用 towerYToMa；旧 yToMa 只适用于旧布局，会算出错误年代
            const ma = (window.EVO3D_LAYOUT.towerYToMa || window.EVO3D_LAYOUT.yToMa)(y);
            if (!isFinite(ma)) return;

            // 一阶低通插值：数字平滑滚动
            if (hudMaDisplay === null || !isFinite(hudMaDisplay)) {
                hudMaDisplay = ma;
            } else {
                hudMaDisplay += (ma - hudMaDisplay) * 0.18;
                if (Math.abs(ma - hudMaDisplay) < 0.05) hudMaDisplay = ma;
            }
            const shown = hudMaDisplay;

            const band = window.EVO3D_LAYOUT.timeBand(shown);

            const maEl = document.getElementById('tour-hud-ma');
            if (maEl) maEl.textContent = formatHudMa(shown);

            const bandEl = document.getElementById('tour-hud-band');
            if (bandEl) {
                bandEl.textContent = band.name + ' · ' + formatBandRange(band);
            }

            // 第三行：当前年代在该时代段内的位置
            const start = band.start;
            const end = (band.end <= 0) ? 0 : band.end;
            const span = start - end;
            let pct = span > 1e-9 ? (start - shown) / span : 0;
            if (!isFinite(pct)) pct = 0;
            pct = Math.min(1, Math.max(0, pct));

            const fillEl = document.getElementById('tour-hud-bar-fill');
            if (fillEl) fillEl.style.width = (pct * 100).toFixed(1) + '%';

            const pctEl = document.getElementById('tour-hud-bar-pct');
            if (pctEl) pctEl.textContent = Math.round(pct * 100) + '%';
        } catch (error) {
            console.error('[UI] 年代 HUD 更新失败:', error);
        }
    }

    // 启动 HUD 更新循环
    setInterval(updateTourHud, 100);

    // ========== 名称数量滑块 ==========
    function initLabelBudget() {
        const slider = document.getElementById('label-budget-slider');
        const display = document.getElementById('label-budget-display');
        if (!slider || !display) return;

        slider.addEventListener('input', (e) => {
            try {
                const value = parseInt(e.target.value, 10);
                display.textContent = value;
                window.EVO3D.setLabelBudget(value);
            } catch (error) {
                console.error('[UI] 名称数量滑块失败:', error);
            }
        });
    }

    // ========== CSS 注入（补充样式） ==========
    const style = document.createElement('style');
    style.textContent = `
        .search-result-item {
            padding: 6px 10px;
            margin: 4px 0;
            background: rgba(255,255,255,0.05);
            border-radius: 4px;
            cursor: pointer;
            transition: background 0.2s;
            font-size: 0.85rem;
        }
        .search-result-item:hover {
            background: rgba(79, 195, 247, 0.3);
        }
        .link-btn {
            display: inline-block;
            margin: 2px;
            padding: 2px 6px;
            background: rgba(79, 195, 247, 0.2);
            border: 1px solid rgba(79, 195, 247, 0.4);
            border-radius: 3px;
            color: #4fc3f7;
            font-size: 0.8rem;
            cursor: pointer;
            transition: all 0.2s;
        }
        .link-btn:hover {
            background: rgba(79, 195, 247, 0.4);
            transform: translateY(-1px);
        }
        .link-chain {
            margin-top: 6px;
            line-height: 1.8;
        }
        .node-info-content ul {
            margin: 4px 0 4px 20px;
            padding: 0;
        }
        .node-info-content li {
            margin: 2px 0;
            color: #b0b0b0;
        }
    `;
    document.head.appendChild(style);

    // ========== 启动 ==========
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
