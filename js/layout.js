// layout.js - 坐标布局与时间映射（塔式分层布局）
// 纯函数模块，导出 window.EVO3D_LAYOUT

(function() {
    'use strict';

    // ========== 常量区 ==========
    const TIME_MIN = 0, TIME_MAX = 4200;

    // 实际数据的11个大类（按节点数分配扇区）
    const CLADE_NAMES = ['生命起源', '细菌', '古菌', '原核生物', '真核生物', '动物', '真菌', '植物', '脊索动物', '脊椎动物', '哺乳动物'];

    // 地质年代表（Ma）- 15层
    const GEO_TIMESCALE = [
        { name: '冥古宙', start: 4600, end: 4000 },
        { name: '太古宙', start: 4000, end: 2500 },
        { name: '元古宙', start: 2500, end: 541 },
        { name: '寒武纪', start: 541, end: 485 },
        { name: '奥陶纪', start: 485, end: 444 },
        { name: '志留纪', start: 444, end: 419 },
        { name: '泥盆纪', start: 419, end: 359 },
        { name: '石炭纪', start: 359, end: 299 },
        { name: '二叠纪', start: 299, end: 252 },
        { name: '三叠纪', start: 252, end: 201 },
        { name: '侏罗纪', start: 201, end: 145 },
        { name: '白垩纪', start: 145, end: 66 },
        { name: '古近纪', start: 66, end: 23 },
        { name: '新近纪', start: 23, end: 2.6 },
        { name: '第四纪', start: 2.6, end: 0 }
    ];

    // 大类颜色（深色主题 & 浅色主题）
    const CLADE_COLORS_DARK = {
        '生命起源': '#ffffff',
        '细菌': '#4fc3f7',
        '古菌': '#ff6e40',
        '原核生物': '#26c6da',
        '真核生物': '#ab47bc',
        '动物': '#ef5350',
        '真菌': '#ffa726',
        '植物': '#66bb6a',
        '脊索动物': '#f06292',
        '脊椎动物': '#ec407a',
        '哺乳动物': '#e91e63'
    };

    const CLADE_COLORS_LIGHT = {
        '生命起源': '#212121',
        '细菌': '#0277bd',
        '古菌': '#d84315',
        '原核生物': '#00838f',
        '真核生物': '#6a1b9a',
        '动物': '#c62828',
        '真菌': '#e65100',
        '植物': '#2e7d32',
        '脊索动物': '#ad1457',
        '脊椎动物': '#880e4f',
        '哺乳动物': '#b71c1c'
    };

    // ========== 塔式布局参数 ==========
    const BASE_RADIUS = 420;
    const RADIUS_EXPONENT = 0.65;
    const INNER_RATIO = 0.10;
    const SECTOR_FILL = 0.84;
    const SECTOR_FILL_TARGET = 0.42;
    const SECTOR_UNIT_AREA = Math.PI * (1 - INNER_RATIO * INNER_RATIO);
    const GEOM_RADIUS = 15;
    
    const importanceScaleTable = [1.35, 1.20, 1.08, 1.00, 0.93]; // 1档到5档（差距1.45倍，全部可辨）

    // 全局状态：布局结果缓存
    let cachedLayerY = null;
    let cachedEraRadii = null;
    let cachedTowerHeight = null;
    let cachedImportance = null;
    let cachedBaseRadius = null;

    // ========== 时间映射函数（保留旧接口，用于 app.js 中非布局相关的时间查询）==========
    let currentMode = 'segment';
    const TIME_SEGMENTS = [
        { start: 4200, end: 600, yStart: -2000, yEnd: -600 },
        { start: 600, end: 0, yStart: -600, yEnd: 1000 }
    ];
    const Y_RANGE_EVEN = { min: -2000, max: 500 };

    function maToY(ma, mode) {
        mode = mode || currentMode;
        if (mode === 'even') {
            const t = (ma - TIME_MIN) / (TIME_MAX - TIME_MIN);
            return Y_RANGE_EVEN.min + t * (Y_RANGE_EVEN.max - Y_RANGE_EVEN.min);
        }
        for (let seg of TIME_SEGMENTS) {
            if (ma >= seg.end && ma <= seg.start) {
                const t = (ma - seg.end) / (seg.start - seg.end);
                return seg.yEnd + t * (seg.yStart - seg.yEnd);
            }
        }
        if (ma > TIME_MAX) return TIME_SEGMENTS[0].yStart;
        if (ma < TIME_MIN) return TIME_SEGMENTS[TIME_SEGMENTS.length - 1].yEnd;
        return 0;
    }

    function yToMa(y, mode) {
        mode = mode || currentMode;
        if (mode === 'even') {
            const t = (y - Y_RANGE_EVEN.min) / (Y_RANGE_EVEN.max - Y_RANGE_EVEN.min);
            return TIME_MIN + t * (TIME_MAX - TIME_MIN);
        }
        for (let seg of TIME_SEGMENTS) {
            const yMin = Math.min(seg.yStart, seg.yEnd);
            const yMax = Math.max(seg.yStart, seg.yEnd);
            if (y >= yMin && y <= yMax) {
                const t = (y - seg.yEnd) / (seg.yStart - seg.yEnd);
                return seg.end + t * (seg.start - seg.end);
            }
        }
        if (y < Math.min(TIME_SEGMENTS[0].yStart, TIME_SEGMENTS[0].yEnd)) return TIME_MAX;
        if (y > Math.max(TIME_SEGMENTS[TIME_SEGMENTS.length - 1].yStart, TIME_SEGMENTS[TIME_SEGMENTS.length - 1].yEnd)) return TIME_MIN;
        return 0;
    }

    function setTimeMode(mode) {
        currentMode = mode;
    }

    // ========== 辅助函数 ==========
    function hash(s) {
        let h = 0;
        for (let i = 0; i < s.length; i++) {
            h = ((h << 5) - h) + s.charCodeAt(i);
            h = h & h;
        }
        return Math.abs(h);
    }

    function mulberry32(seed) {
        return function() {
            seed |= 0;
            seed = (seed + 0x6d2b79f5) | 0;
            let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function cladeColor(clade, theme = 'dark') {
        const colors = theme === 'dark' ? CLADE_COLORS_DARK : CLADE_COLORS_LIGHT;
        return colors[clade] || '#888888';
    }

    function clades(nodes) {
        nodes = nodes || (window.EVO_DATA && window.EVO_DATA.nodes) || [];
        const counts = {};
        nodes.forEach(n => {
            counts[n.clade] = (counts[n.clade] || 0) + 1;
        });
        return Object.keys(counts)
            .sort((a, b) => counts[b] - counts[a])
            .map(c => ({ name: c, count: counts[c] }));
    }

    function timeBand(ma) {
        for (let band of GEO_TIMESCALE) {
            if (ma >= band.end && ma <= band.start) {
                return { name: band.name, start: band.start, end: band.end };
            }
        }
        return { name: '未知年代', start: ma, end: ma };
    }

    function verifyLayout(layout) {
        const positions = Object.values(layout);
        let minDist = Infinity;
        const overlaps = [];
        
        for (let i = 0; i < positions.length; i++) {
            for (let j = i + 1; j < positions.length; j++) {
                const dx = positions[i].x - positions[j].x;
                const dz = positions[i].z - positions[j].z;
                const dist = Math.sqrt(dx * dx + dz * dz);
                if (dist < minDist) minDist = dist;
                if (dist < 12) overlaps.push({ i, j, dist });
            }
        }
        return { minDist, overlaps };
    }

    // ========== 塔式布局核心算法 ==========
    function computeLayout(nodes) {
        const layout = {};
        const rand = mulberry32(9917);
        
        // 计算各节点的重要度（按后代数量排名分位）
        const D = window.EVO_DATA || { edges: [] };
        const descendantMap = new Map();
        
        // 统计后代数量
        const children = new Map();
        nodes.forEach(n => children.set(n.id, []));
        (D.edges || []).forEach(e => {
            if (e.type === 'descent' && children.has(e.from)) {
                children.get(e.from).push(e.to);
            }
        });
        
        function countDescendants(id) {
            if (descendantMap.has(id)) return descendantMap.get(id);
            const kids = children.get(id) || [];
            let count = kids.length;
            kids.forEach(kid => count += countDescendants(kid));
            descendantMap.set(id, count);
            return count;
        }
        
        nodes.forEach(n => countDescendants(n.id));
        
        // 按后代数量排名分5档重要度
        const rankedIds = Array.from(descendantMap.entries())
            .sort((a, b) => b[1] - a[1])
            .map(e => e[0]);
        const totalRanked = rankedIds.length;
        const importance = new Map();
        const baseRadius = new Map();
        
        rankedIds.forEach((id, i) => {
            const rank = i + 1;
            const node = nodes.find(n => n.id === id);
            let imp;
            if (node && node.rank === 'clade') {
                imp = 1; // 大类节点强制1档
            } else if (rank <= totalRanked * 0.08) {
                imp = 1;
            } else if (rank <= totalRanked * 0.25) {
                imp = 2;
            } else if (rank <= totalRanked * 0.50) {
                imp = 3;
            } else if (rank <= totalRanked * 0.78) {
                imp = 4;
            } else {
                imp = 5;
            }
            importance.set(id, imp);
            const geomR = GEOM_RADIUS; // 各档统一基半径，大小全靠 importanceScale 控制
            baseRadius.set(id, geomR);
        });
        
        // 缓存供导出函数使用
        cachedImportance = importance;
        cachedBaseRadius = baseRadius;
        
        // 1) 统计各层节点数
        const ERA_COUNT = GEO_TIMESCALE.length;
        const CATEGORY_COUNT = CLADE_NAMES.length;
        const counts = new Array(ERA_COUNT).fill(0);
        const eraIndex = new Map();
        
        nodes.forEach(n => {
            const ma = n.ma;
            for (let i = 0; i < GEO_TIMESCALE.length; i++) {
                const band = GEO_TIMESCALE[i];
                if (ma >= band.end && ma <= band.start) {
                    counts[i]++;
                    eraIndex.set(n.id, i);
                    break;
                }
            }
        });
        
        const avgCount = nodes.length / ERA_COUNT;
        
        // 2) 按 (era, category) 分桶
        const buckets = new Map();
        const cladeIndex = new Map();
        CLADE_NAMES.forEach((c, i) => cladeIndex.set(c, i));
        
        nodes.forEach(n => {
            const era = eraIndex.get(n.id);
            const cat = cladeIndex.get(n.clade);
            if (era === undefined || cat === undefined) return;
            const key = `${era}:${cat}`;
            if (!buckets.has(key)) buckets.set(key, []);
            buckets.get(key).push(n);
        });
        
        // 3) 计算扇区角度比例
        const sectorSlices = [];
        for (let era = 0; era < ERA_COUNT; era++) {
            const slice = new Array(CATEGORY_COUNT).fill(0);
            for (let cat = 0; cat < CATEGORY_COUNT; cat++) {
                const key = `${era}:${cat}`;
                const list = buckets.get(key) || [];
                slice[cat] = counts[era] ? list.length / counts[era] : 0;
            }
            sectorSlices.push(slice);
        }
        
        // 4) 计算层半径：**层半径由该层节点数决定**（面积≈数量），密集层把节点等比缩小
        //    轮廓本身就在表达“这一时代新增了多少类群”
        const MIN_LAYER_R = 320;    // 层半径下限（早期只有几十个类群，就该聚在中心，不能甩到外圈铺满背景）
        const MAX_LAYER_R = 2700;   // 层半径上限（晚期层拉开到铺满画面）
        const MIN_SHRINK = 0.72;    // 密集层节点最小缩放（再小就看不清了）
        const COUNT_RADIUS_K = 2000; // 数量→半径系数
        const areaReq = [];
        for (let era = 0; era < ERA_COUNT; era++) {
            let peak = 0;
            for (let cat = 0; cat < CATEGORY_COUNT; cat++) {
                const slice = sectorSlices[era][cat];
                if (slice <= 0) continue;
                let demand = 0;
                const key = `${era}:${cat}`;
                const list = buckets.get(key) || [];
                list.forEach(n => {
                    const imp = importance.get(n.id) || 5;
                    const geomR = baseRadius.get(n.id) || GEOM_RADIUS;
                    const scale0 = importanceScaleTable[imp - 1];
                    const r = geomR * scale0;
                    demand += Math.PI * (r * 1.15) * (r * 1.15);
                });
                peak = Math.max(peak, demand / (slice * SECTOR_FILL));
            }
            areaReq.push(Math.sqrt(peak / (SECTOR_UNIT_AREA * SECTOR_FILL_TARGET)));
        }
        // 半径由「时代序号」驱动（锥形）：早期层小、晚期层大。
        // 不能用数量驱动：3.5–4 Ga 那一层堆了 360 个细菌类群，按数量算会把早期层直接撑成満屏大圆盘，
        // 漫游到 2.9 Ga 时背景里就全是散落的多面体。
        const countRadii = counts.map((c, era) => {
            const k = ERA_COUNT > 1 ? era / (ERA_COUNT - 1) : 1;
            return MIN_LAYER_R + (MAX_LAYER_R - MIN_LAYER_R) * Math.pow(k, 1.35);
        });
        const layerShrink = new Array(ERA_COUNT).fill(1);
        const eraRadii = counts.map((c, era) => {
            const req = areaReq[era] || 0;
            const target = countRadii[era];
            if (req <= target) return target;
            const f = Math.max(MIN_SHRINK, target / req);
            layerShrink[era] = f;
            return Math.max(target, req * f);
        });
        
        // 5) 计算层间距与层高：**层间距也由该层节点数决定**（√数量），
        //    这样竖向高度也在表达“这个时代新增了多少”，同时把总高压到约 2200，取景不再是一根细柱
        const eraGaps = counts.map(c => 140 + 5.5 * Math.sqrt(c));
        const eraY = [];
        let acc = 0;
        for (let e = 0; e < ERA_COUNT; e++) {
            eraY.push(acc);
            acc += eraGaps[e];
        }
        const towerHeight = eraY[ERA_COUNT - 1];
        
        // 缓存供导出函数使用
        cachedLayerY = eraY;
        cachedEraRadii = eraRadii;
        cachedTowerHeight = towerHeight;
        
        // 6) 层内布点
        const layerNodes = Array.from({ length: ERA_COUNT }, () => []);
        
        for (let era = 0; era < ERA_COUNT; era++) {
            const outerR = eraRadii[era];
            const innerR = Math.max(outerR * INNER_RATIO, 5);
            const y = eraY[era];
            const spread = 1 + counts[era] / 500;
            
            let cum = 0;
            for (let cat = 0; cat < CATEGORY_COUNT; cat++) {
                const key = `${era}:${cat}`;
                const list = buckets.get(key) || [];
                const slice = sectorSlices[era][cat] * Math.PI * 2;
                const sectorStart = cum + slice * 0.08;
                const sectorWidth = slice * SECTOR_FILL;
                cum += slice;
                
                list.forEach(n => {
                    const r = innerR + (outerR - innerR) * Math.sqrt(rand());
                    const theta = sectorStart + sectorWidth * rand();
                    const imp = importance.get(n.id) || 5;
                    const scale = importanceScaleTable[imp - 1] * layerShrink[era];
                    
                    const pos = {
                        x: Math.cos(theta) * r,
                        y: y,
                        z: Math.sin(theta) * r,
                        scale: scale
                    };
                    layout[n.id] = pos;
                    layerNodes[era].push({ id: n.id, pos: pos, imp: imp });
                });
            }
        }
        
        // 7) 同层松弛
        for (let era = 0; era < ERA_COUNT; era++) {
            const arr = layerNodes[era];
            const spread = 1 + counts[era] / 500;
            
            for (let iter = 0; iter < 16; iter++) {
                for (let i = 0; i < arr.length; i++) {
                    for (let j = i + 1; j < arr.length; j++) {
                        const a = arr[i], b = arr[j];
                        const dx = b.pos.x - a.pos.x;
                        const dz = b.pos.z - a.pos.z;
                        const dist = Math.sqrt(dx * dx + dz * dz);
                        
                        const geomA = baseRadius.get(a.id) || GEOM_RADIUS;
                        const geomB = baseRadius.get(b.id) || GEOM_RADIUS;
                        const minDist = ((geomA * a.pos.scale + geomB * b.pos.scale) * 1.15 + 0.4) * spread;
                        
                        if (dist < minDist && dist > 1e-4) {
                            const push = (minDist - dist) / 2;
                            const nx = dx / dist, nz = dz / dist;
                            a.pos.x -= nx * push;
                            a.pos.z -= nz * push;
                            b.pos.x += nx * push;
                            b.pos.z += nz * push;
                        } else if (dist <= 1e-4) {
                            a.pos.x += (rand() - 0.5) * 0.5;
                            a.pos.z += (rand() - 0.5) * 0.5;
                        }
                    }
                }
            }
        }
        
        // 8) 整体平移使重心为原点
        let cx = 0, cz = 0, cnt = 0;
        nodes.forEach(n => {
            const p = layout[n.id];
            if (p && isFinite(p.x) && isFinite(p.z)) {
                cx += p.x;
                cz += p.z;
                cnt++;
            }
        });
        if (cnt > 0) {
            cx /= cnt;
            cz /= cnt;
            if (isFinite(cx) && isFinite(cz)) {
                nodes.forEach(n => {
                    const p = layout[n.id];
                    if (p) {
                        p.x -= cx;
                        p.z -= cz;
                    }
                });
            }
        }
        
        return layout;
    }

    // ========== 导出函数 ==========
    // 塔式布局的 Y → 年代（Ma）反算。
    // 层高 eraY 是「层间距累加」，与旧布局的分段非线性 maToY 完全不同，
    // 所以不能用 yToMa 反推，否则底层会算成几百 Ma、上层一律 0 Ma。
    // 规则：层 i 对应 GEO_TIMESCALE[i]，层内取带中值，层间线性插值。
    function towerYToMa(y) {
        const Y = cachedLayerY;
        if (!Y || !Y.length) return yToMa(y);
        const T = GEO_TIMESCALE;
        if (Y.length === 1) return (T[0].start + T[0].end) / 2;
        const last = Math.min(Y.length, T.length) - 1;
        const mid = (i) => (T[i].start + T[i].end) / 2;
        if (!isFinite(y)) return mid(0);
        if (y <= Y[0]) return mid(0);
        if (y >= Y[last]) return mid(last);
        let i = 0;
        while (i < last && y > Y[i + 1]) i++;
        const span = Y[i + 1] - Y[i];
        const t = span > 1e-6 ? (y - Y[i]) / span : 0;
        return mid(i) + (mid(i + 1) - mid(i)) * t;
    }

    function importanceOf(id) {
        return cachedImportance ? (cachedImportance.get(id) || 5) : 5;
    }

    function baseRadiusOf(id) {
        return cachedBaseRadius ? (cachedBaseRadius.get(id) || GEOM_RADIUS) : GEOM_RADIUS;
    }

    // ========== 导出 ==========
    window.EVO3D_LAYOUT = {
        maToY,
        yToMa,
        towerYToMa,
        computeLayout,
        cladeColor,
        clades,
        timeBand,
        setTimeMode,
        verifyLayout,
        CLADE_NAMES,
        TIME_MIN,
        TIME_MAX,
        GEO_TIMESCALE,
        // 新增导出
        get layerY() { return cachedLayerY; },
        get eraRadii() { return cachedEraRadii; },
        get towerHeight() { return cachedTowerHeight; },
        importanceOf,
        baseRadiusOf
    };

})();
