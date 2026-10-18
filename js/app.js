// app.js - Three.js 场景与渲染（块7b - 视觉清晰度修复）
// 依赖：THREE（r128 UMD）、EVO3D_LAYOUT、EVO_DATA
// 暴露：window.EVO3D API

(function() {
    'use strict';

    // ========== 全局状态 ==========
    let scene, camera, renderer, labelRenderer, controls;
    let nodeObjects = {}, edgeObjects = [], networkEdgeObjects = [];
    // 节点批渲染：{ meshes:[5 个 InstancedMesh], items:[5 桶记录], index: Map(nodeId -> {lv,i}), tmp, bg }
    let nodeBatch = null;
    // 标签改挂 scene 之后用查表（nodeId -> CSS2DObject），不再 scene.traverse 找
    const nodeLabels = {};
    const _nodeColorTmp = new THREE.Color();
    let layout = {};
    let currentHighlight = null;
    let currentTimeFilter = null;
    let animationId = null;
    let visibleLabels = []; // 当前帧可见标签
    const clock = new THREE.Clock();
    // 真实时间累加器：漫游时钟与节点自转都跟着墙上时钟走（不用 clock.getDelta，
    // 因为同帧内 getElapsedTime() 会先把 delta 消费掉，导致 dt 接近 0、漫游慢几十倍）
    let _lastFrameMs = 0;
    let _elapsedReal = 0;
    
    // 相机跟随状态
    let timeFollowEnabled = true;
    let timeFollowTarget = null;
    
    // 漫游状态
    let tourMode = false;
    let tourTime = 0;
    let tourPlan = null;
    let tourStartPos = new THREE.Vector3();
    let tourStartTarget = new THREE.Vector3();
    // 漫游：相机水平位置跟随“已显现节点”的 (x,z) 重心（平滑插值）
    let tourFollowX = 0;
    let tourFollowZ = 0;
    let tourFollowReady = false;
    let _tourTmpV = new THREE.Vector3(); // 漫游居中投影用临时向量
    var _tourRX = new Float64Array(1024); // 已显现节点世界 x（每帧复用，避免分配）
    var _tourRZ = new Float64Array(1024); // 已显现节点世界 z（每帧复用）
    // 漫游相机自适应：按“当前已显现节点的实际范围”反推镜头高度与 FOV
    let tourAdaptRadius = 200;              // 当前已显现节点的实际水平半径
    let tourAdaptAbove = 300;               // 自适应镜头高度 camAbove
    let tourAdaptFov = 50;                  // 平滑后的 FOV
    let tourAdaptHomeFov = 50;              // 进入漫游前的 fov（退出时恢复）
    const TOUR_LEAD_MIN = 300;               // camAbove 下限                                        
    const TOUR_LEAD_MAX = 3200;              // camAbove 上限
    const TOUR_ADAPT_RADIUS_FLOOR = 120;    // 单点/极小簇半径下限（防退化）
    const TOUR_ADAPT_RADIUS_FALLBACK = 200; // R 为空时的兜底半径
    const TOUR_ADAPT_MARGIN = 1.15;         // FOV 取景余量
    const TOUR_ADAPT_FOV_MIN = 22;
    const TOUR_ADAPT_FOV_MAX = 110;
    const TOUR_BLEND = 2;
    const TOUR_OUTRO = 5;
    const TOUR_MIN_DUR = 6;
    const TOUR_MAX_DUR = 15;
    const TOUR_SPEED_SCALE = 0.49;  // 整体节奏系数（0.49 = 0.7×0.7，即再放慢 0.7 倍，时长除 0.49）
    // 录制用：?tourspeed=0.098 可以临时把漫游放慢（不动上面默认值），录完再用 5 倍速还原成 60fps
    const TOUR_SPEED_OVERRIDE = (function () {
        try {
            const m = /[?&]tourspeed=([0-9.]+)/.exec(location.search);
            const v = m ? parseFloat(m[1]) : 0;
            return (v > 0 && v <= 5) ? v : 0;
        } catch (e) { return 0; }
    })();
    const TOUR_SPEED = TOUR_SPEED_OVERRIDE || TOUR_SPEED_SCALE;
    const TOUR_LAST_RATE = 8.5;     // 最后一层单独慢慢放（个/秒）
    const TOUR_LAST_MAX = 90;       // 最后一层时长封顶
    const TOUR_ROLL = 0.03;
    const TOUR_LEAD = 2760;
    const TOUR_FOV_MARGIN = 1.1;
    const TOUR_FOV_MIN = 45;
    const TOUR_FOV_MAX = 125;
    const TOUR_START_ANGLE = Math.PI * 0.25;
// 漫游显示规则（2026-10-18 用户定）：当前层与其之前的所有层都显示，之后的层全部隐藏。
// 不做密度自适应、不做滑动窗口。
    // 漫游镜头旋转（滚转）开关：默认关，画面保持正向不转
    let tourRollOn = false;
    // 节点亮度补偿：改实例色后整体比原来的独立 Mesh 暗约 20%
    const NODE_BRIGHT_BOOST = 1.2;
    const _boostTmp = new THREE.Color();
    // 灭绝节点白描边壳的相对尺寸
    const OUTLINE_SCALE = 1.18;
    
    // 块B动效参数
    const FLASH_DURATION = 0.5;       // 弹入+闪白时长
    const FLASH_PEAK_SCALE = 2.5;     // 弹入峰值
    const NAME_LIFE = 2.0;            // 名字停留时长
    const NAME_FADE_IN = 0.15;        // 名字淡入
    const NAME_FADE_OUT = 0.35;       // 名字淡出
    const EDGE_CRAWL_TIME = 0.15;     // 边爬行时长（几乎与目标节点同步出现）
    const MAX_FORCED_NAMES = 12;      // 名字窗口内“强制显示”名的同屏上限（超出挤掉最旧的、保留最新的）
    const FORCED_GRACE_MS = 400;      // 刚出现 400ms 内的强制名：即使重叠也保留
    const MAX_CRAWLING_EDGES = 56;    // 同时爬行边数上限
    
    // 块B状态追踪
    const nodeFlashState = new Map();  // nodeId -> {revealedAt}（颜色/尺寸已改由批渲染重算）
    const forcedNames = new Map();    // nodeId -> {label, startMs} 名字窗口内的强制名（唯一的标签 opacity 写入者）
    const edgeCrawlState = new Map();  // edgeId -> {startTime, segments, line}

    const NODE_GROUPS = {
        species: { radius: 14, opacity: 1 },
        genus: { radius: 12, opacity: 0.9 },
        clade: { radius: 22, opacity: 0.8 },
        event: { radius: 10, opacity: 0.7 }
    };

    const NETWORK_EDGE_COLORS = {
        endosymbiosis: 0xff6e40,
        hgt: 0x9c27b0,
        hybrid: 0x66bb6a,
        ring: 0xffa726,
        symbiosis: 0xef5350
    };

    let MAX_VISIBLE_LABELS = 15; // 同屏标签上限（可由滑块调整，默认 15）

    // ========== 谱系边分级参数（按子节点后代数量分档，可调）==========
    const PHYLO_TIERS = [
        { min: 25, color: 0x7fe3ff, opacity: 0.90 }, // 主干
        { min: 8,  color: 0x7fe3ff, opacity: 0.62 }, // 中干
        { min: 3,  color: 0x5599aa, opacity: 0.42 }, // 细枝
        { min: 0,  color: 0x3f7488, opacity: 0.28 }  // 末梢
    ];

    function phyloTier(desc) {
        for (let i = 0; i < PHYLO_TIERS.length; i++) {
            if (desc >= PHYLO_TIERS[i].min) return PHYLO_TIERS[i];
        }
        return PHYLO_TIERS[PHYLO_TIERS.length - 1];
    }

    let descendantCounts = null; // Map<nodeId, 后代总数>

    // ========== 连线批处理（合并成一个 LineSegments / 一个箭头 Mesh）==========
    // 旧实现每条边一个 THREE.Line + 一个箭头 Mesh（1399*2 = 2798 个对象，draw call 数千）。
    // 现在：所有谱系边合并为一个 LineSegments、所有箭头合并为一个 Mesh（几何已烘焙）、
    // 网状边合并为一个 LineSegments；生长/淡出/裁剪切线统一写每顶点 aAlpha 属性，
    // 由自定义 ShaderMaterial 的 uOpacity 做整体不透明度。
    // 对外仍保留 edgeObjects / networkEdgeObjects，元素改为轻量记录对象。
    const EDGE_SEG = 8;             // 每条谱系边的折线段数
    const EDGE_LINE_OPACITY = 0.3;  // 谱系线基准不透明度（shader uniform）
    const EDGE_TIER_NORM = 0.9;     // 分级不透明度归一化基准（tier.opacity / 0.9）
    const NET_SEG = 12;             // 网状边分段数（隔段留空模拟虚线）

    const EDGE_VERT_SHADER = [
        'attribute vec3 aColor;',
        'attribute float aAlpha;',
        'varying vec3 vColor;',
        'varying float vAlpha;',
        'void main() {',
        '    vColor = aColor;',
        '    vAlpha = aAlpha;',
        '    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
        '}'
    ].join('\n');

    const EDGE_FRAG_SHADER = [
        'uniform float uOpacity;',
        'varying vec3 vColor;',
        'varying float vAlpha;',
        'void main() {',
        '    float a = vAlpha * uOpacity;',
        '    if (a <= 0.001) discard;',
        '    gl_FragColor = vec4(vColor, a);',
        '}'
    ].join('\n');

    function makeEdgeMaterial(opacity, blending) {
        return new THREE.ShaderMaterial({
            uniforms: { uOpacity: { value: opacity } },
            vertexShader: EDGE_VERT_SHADER,
            fragmentShader: EDGE_FRAG_SHADER,
            transparent: true,
            depthWrite: false,
            blending: blending === undefined ? THREE.AdditiveBlending : blending
        });
    }

    // 合并后的场景对象（各 1 个）
    let edgeLine = null;     // 谱系边 LineSegments
    let edgeArrow = null;    // 箭头（顶点已按每条边烘焙好位置）
    let networkLine = null;  // 网状边 LineSegments

    // 顶点属性缓冲与逐边状态数组
    let edgeAlpha = null, edgeAlphaAttr = null;        // 谱系线每顶点 alpha
    let arrowAlpha = null, arrowAlphaAttr = null;      // 箭头每顶点 alpha
    let networkAlpha = null, networkAlphaAttr = null;  // 网状线每顶点 alpha
    let networkPattern = null;                         // 网状虚线图案（0/1）
    let edgeVis = null;      // 可见性（时间裁剪 / 漫游显现）0 或 1
    let edgeGrowth = null;   // 爬行进度 0..1（逐段显现）
    let edgeFactor = null;   // 高亮系数（1 或 FADE_FACTOR）
    let networkVis = null;   // 网状边可见性
    let edgeRecords = [];    // 谱系边记录
    let networkRecords = []; // 网状边记录
    const edgesByTo = new Map(); // nodeId -> 该节点入边的记录下标数组

    // ========== 初始化 ==========
    function init() {
        try {
            if (!window.THREE || !window.EVO_DATA || !window.EVO3D_LAYOUT) {
                throw new Error('缺少必要依赖：THREE / EVO_DATA / EVO3D_LAYOUT');
            }

            const container = document.getElementById('scene3d');
            const labelContainer = document.getElementById('labels');
            if (!container || !labelContainer) {
                throw new Error('未找到容器 #scene3d 或 #labels');
            }

            // 场景
            scene = new THREE.Scene();
            scene.background = new THREE.Color(0x070b14);
            scene.fog = new THREE.Fog(0x050810, 4000, 8000);

            // 相机（初始位置稍后自动调整）
            const aspect = window.innerWidth / window.innerHeight;
            camera = new THREE.PerspectiveCamera(50, aspect, 10, 12000);
            camera.position.set(2000, 500, 2000);

            // WebGL 渲染器
            renderer = new THREE.WebGLRenderer({ antialias: true });
            renderer.setSize(window.innerWidth, window.innerHeight - 60);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
            container.appendChild(renderer.domElement);

            // CSS2D 标签渲染器
            labelRenderer = new THREE.CSS2DRenderer();
            labelRenderer.setSize(window.innerWidth, window.innerHeight - 60);
            labelRenderer.domElement.style.position = 'absolute';
            labelRenderer.domElement.style.top = '0';
            labelRenderer.domElement.style.pointerEvents = 'none';
            labelContainer.appendChild(labelRenderer.domElement);

            // 控制器
            controls = new THREE.OrbitControls(camera, renderer.domElement);
            controls.enableDamping = true;
            controls.dampingFactor = 0.05;
            controls.minDistance = 300;
            controls.maxDistance = 7000;
            controls.maxPolarAngle = Math.PI;

            // 灯光
            const ambientLight = new THREE.AmbientLight(0x4ed8ff, 0.4);
            scene.add(ambientLight);
            const directionalLight = new THREE.DirectionalLight(0x6ec6ff, 0.6);
            directionalLight.position.set(1000, 2000, 1000);
            scene.add(directionalLight);
            const backLight = new THREE.DirectionalLight(0xa78bfa, 0.3);
            backLight.position.set(-800, -1000, -800);
            scene.add(backLight);

            // 构建场景内容
            buildScene();

            // 初始取景自动 fit
            autoFitCamera();

            // 初始化标签可见性
            updateLabelVisibility();

            // 启动渲染循环
            animate();

            // 窗口 resize
            window.addEventListener('resize', onWindowResize);

            // 标记就绪
            window.EVO3D.ready = true;

            // 录制便利：URL 带 ?autotour=1 时自动开始漫游（录屏用，不用手动点）
            if (/[?&]autotour=1/.test(location.search)) {
                setTimeout(function () {
                    const b = document.getElementById('tour-btn');
                    if (b) b.click();
                }, 1500);
            }

        } catch (error) {
            console.error('[EVO3D] 初始化失败:', error);
            const labelContainer = document.getElementById('labels');
            if (labelContainer) {
                labelContainer.innerHTML = '<div style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);color:#ff6e40;font-size:1.2rem;text-align:center;background:rgba(0,0,0,0.8);padding:20px;border-radius:8px;">场景初始化失败：' + error.message + '</div>';
            }
        }
    }

    // ========== 构建场景 ==========
    function buildScene() {
        const nodes = window.EVO_DATA.nodes;
        const edges = window.EVO_DATA.edges;

        if (!nodes || nodes.length === 0) {
            throw new Error('数据为空或格式错误');
        }

        // 计算布局
        layout = window.EVO3D_LAYOUT.computeLayout(nodes);

        // 统计各节点后代总数（供谱系边分级使用，只算一次）
        computeDescendantCounts();

        // 创建节点
        createNodes(nodes);

        // 创建谱系边
        createPhylogeneticEdges(edges.filter(e => e.type === 'descent'));

        // 创建网状边
        createNetworkEdges(edges.filter(e => e.type !== 'descent'));


        console.log('[EVO3D] 场景构建完成:', {
            nodes: nodes.length,
            phyloEdges: edges.filter(e => e.type === 'descent').length,
            networkEdges: edges.filter(e => e.type !== 'descent').length
        });
    }

    function createNodes(nodes) {
        // 柏拉图立体几何（5档共享）
        const polyGeometries = [
            new THREE.IcosahedronGeometry(15),      // 1档 基石 20面（与 layout.GEOM_RADIUS 一致，大小由 importanceScale 控制）
            new THREE.DodecahedronGeometry(15),     // 2档 12面
            new THREE.OctahedronGeometry(15),       // 3档 8面
            new THREE.BoxGeometry(17.3, 17.3, 17.3), // 4档 6面 (15*2/√3)
            new THREE.TetrahedronGeometry(15)       // 5档 4面
        ];
        
        // 按后代数量排名分位分5档重要度（名次法，保证每档都有节点）
        const rankedIds = Array.from(descendantCounts.entries())
            .sort((a, b) => b[1] - a[1])
            .map(e => e[0]);
        const totalRanked = rankedIds.length;
        const rankOf = new Map();
        rankedIds.forEach((id, i) => rankOf.set(id, i + 1));
        const rankBound1 = Math.floor(totalRanked * 0.08);  // 前8% → 1档
        const rankBound2 = Math.floor(totalRanked * 0.25);  // 8–25% → 2档
        const rankBound3 = Math.floor(totalRanked * 0.50);  // 25–50% → 3档
        const rankBound4 = Math.floor(totalRanked * 0.78);  // 50–78% → 4档
        
        function importanceOf(node) {
            const r = rankOf.get(node.id);
            if (r === undefined) {
                // 理论不会发生；兜底不落1档
                return node.rank === 'clade' ? 4 : 5;
            }
            if (r <= rankBound1) return 1;
            if (r <= rankBound2) return 2;
            if (r <= rankBound3) return 3;
            if (r <= rankBound4) return 4;
            // clade 不允许落5档
            if (node.rank === 'clade') return 4;
            return 5;
        }
        
        // 统计分档分布（供简报）
        const tierCounts = [0, 0, 0, 0, 0];
        // 5 个重要度桶：每桶一个 InstancedMesh，桶内索引 = 实例编号（拾取靠它还原 node id）
        const buckets = [[], [], [], [], []];
        const labelList = [];

        nodes.forEach(node => {
            const pos = layout[node.id];
            if (!pos) {
                console.warn('[EVO3D] 节点无布局:', node.id);
                return;
            }

            const importance = importanceOf(node);
            tierCounts[importance - 1]++;

            // 颜色：按大类恢复配色；灭绝物种靠 baseOpacity=0.5 压暗（写色时向背景色插值）
            const color = new THREE.Color(window.EVO3D_LAYOUT.cladeColor(node.clade));
            let opacity = 1;
            if (node.extinct) opacity *= 0.5;

            // 自转参数（每节点不同）
            const seed = hashString(node.id);
            const spinAxis = new THREE.Vector3(
                (seed % 100) / 100 - 0.5,
                (seed / 100 % 100) / 100 - 0.5,
                (seed / 10000 % 100) / 100 - 0.5
            ).normalize();
            const spinSpeed = 0.05 + (seed % 10) / 100; // 0.05~0.15
            const phase = (seed % 360) * Math.PI / 180;

            // baseRadius 从 layout 取，回退到 15
            const bRadius = (window.EVO3D_LAYOUT.baseRadiusOf && window.EVO3D_LAYOUT.baseRadiusOf(node.id)) || 15;
            const baseScale = (pos && pos.scale) || 1;

            // 轻量节点记录（替代原来的独立 THREE.Mesh）：
            // position/scale/visible 是每帧写 instance matrix 的输入；
            // scale 是带 setScalar 的桩对象，只改记录值，不牵动几何体
            const rec = {
                nodeId: node.id,
                position: new THREE.Vector3(pos.x, pos.y, pos.z),
                visible: true,
                scale: makeScaleStub(baseScale),
                userData: {
                    nodeId: node.id,
                    type: 'node',
                    clade: node.clade,
                    baseOpacity: opacity,
                    baseRadius: bRadius,
                    depthFactor: 1,
                    importance: importance,
                    importanceScale: baseScale,
                    baseScale: baseScale,
                    spinAxis: spinAxis,
                    spinSpeed: spinSpeed,
                    phase: phase,
                    baseColor: color,
                    extinct: !!node.extinct,
                    __lastColor: -1
                }
            };

            buckets[importance - 1].push(rec);
            nodeObjects[node.id] = rec;
            labelList.push({ node: node, pos: pos });
        });

        // 建 5 个 InstancedMesh（实例数 = 各桶节点数；节点部分 draw call ≤ 5）
        nodeBatch = {
            meshes: [],
            outlines: [],             // 灭绝节点的白描边壳（每档一个 InstancedMesh）
            items: buckets,
            index: new Map(),          // nodeId -> {lv, i}
            tmp: new THREE.Object3D(),
            bg: new THREE.Color(0x070a14)   // 远处淡出 = 向这个背景色插值
        };
        for (let lv = 0; lv < 5; lv++) {
            const items = buckets[lv];
            const mat = new THREE.MeshStandardMaterial({ metalness: 0.15, roughness: 0.55 });
            const im = new THREE.InstancedMesh(polyGeometries[lv], mat, Math.max(1, items.length));
            im.count = items.length;
            im.frustumCulled = false;   // 实例分布全塔，禁用剔除避免误裁
            im.userData = { type: 'node_instanced', level: lv + 1, count: items.length };
            if (im.instanceMatrix) im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            items.forEach((rec, i) => {
                _boostTmp.copy(rec.userData.baseColor);
                _boostTmp.r = Math.min(1, _boostTmp.r * NODE_BRIGHT_BOOST);
                _boostTmp.g = Math.min(1, _boostTmp.g * NODE_BRIGHT_BOOST);
                _boostTmp.b = Math.min(1, _boostTmp.b * NODE_BRIGHT_BOOST);
                im.setColorAt(i, _boostTmp);
                nodeBatch.index.set(rec.nodeId, { lv: lv, i: i });
            });
            if (im.instanceColor) im.instanceColor.needsUpdate = true;
            scene.add(im);
            nodeBatch.meshes.push(im);
        }

        // 灭绝节点白描边：每档一个背面壳（只给 extinct 节点写非零矩阵）
        const outlineMat = new THREE.MeshBasicMaterial({
            color: 0xffffff,
            side: THREE.BackSide,
            transparent: true,
            opacity: 0.5,
            depthWrite: false
        });
        for (let lv = 0; lv < 5; lv++) {
            const items = buckets[lv];
            const om = new THREE.InstancedMesh(polyGeometries[lv], outlineMat, Math.max(1, items.length));
            om.count = items.length;
            om.frustumCulled = false;
            om.renderOrder = 2;
            om.userData = { type: 'node_outline', level: lv + 1, count: items.length };
            if (om.instanceMatrix) om.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
            scene.add(om);
            nodeBatch.outlines.push(om);
        }

        // 标签：节点已无独立 mesh，标签挂 scene，位置直接用 layout 坐标
        // 分帧创建：1400 个 CSS2D 标签一次性建会卡住首帧，改成每帧一批
        scheduleLabelCreation(labelList);

        // 首帧先摆好矩阵（之后每帧由 writeNodeInstances 更新自转/尺寸）
        writeNodeInstances(0);
        
        console.log('[EVO3D] 多面体分档:', tierCounts, '名次边界:', [rankBound1, rankBound2, rankBound3, rankBound4],
            '实例数:', buckets.map(b => b.length));
    }

    // ========== 节点批渲染（InstancedMesh）==========
    // scale 桩：只记数值，真正的缩放每帧写进 instance matrix
    function makeScaleStub(v) {
        return {
            x: v, y: v, z: v,
            set: function (x, y, z) { this.x = x; this.y = y; this.z = z; return this; },
            setScalar: function (s) { this.x = s; this.y = s; this.z = s; return this; }
        };
    }

    // 每帧把 位置 / 自转 / 尺寸 写进 5 个 InstancedMesh 的矩阵缓冲
    function writeNodeInstances(time) {
        if (!nodeBatch) return;
        const tmp = nodeBatch.tmp;
        // 屏幕尺寸保底：远处的节点不能小到看不见（只兜底，不抹掉大小差异）
        const MIN_PX = 11.5;           // 最小屏幕直径（px）
        const NODE_GEOM_R = 15;        // 各档基半径（与 layout.GEOM_RADIUS 一致）
        const _H = (renderer.domElement && renderer.domElement.clientHeight) || 800;
        const _tanHalf = Math.tan((camera.fov * Math.PI / 180) / 2);
        const _camPos = camera.position;
        for (let lv = 0; lv < nodeBatch.meshes.length; lv++) {
            const mesh = nodeBatch.meshes[lv];
            const om = nodeBatch.outlines && nodeBatch.outlines[lv];
            const items = nodeBatch.items[lv];
            if (!items.length) continue;
            for (let i = 0; i < items.length; i++) {
                const rec = items[i];
                const ud = rec.userData;
                tmp.position.copy(rec.position);
                if (ud.spinAxis) tmp.quaternion.setFromAxisAngle(ud.spinAxis, ud.phase + time * ud.spinSpeed);
                else tmp.quaternion.set(0, 0, 0, 1);
                // 被时间游标裁掉 / 漫游未显现的节点：scale=0（不占位，也不挡后面的节点）
                let s = rec.visible ? Math.max(0, rec.scale.x) : 0;
                if (s > 0) {
                    const dist = _camPos.distanceTo(rec.position);
                    const pxPerUnit = _H / (2 * _tanHalf * Math.max(1, dist));
                    const pxDia = 2 * NODE_GEOM_R * s * pxPerUnit;
                    if (pxDia < MIN_PX) s = s * (MIN_PX / pxDia);
                }
                tmp.scale.setScalar(s);
                tmp.updateMatrix();
                mesh.setMatrixAt(i, tmp.matrix);
                // 灭绝节点白描边：同一变换放大 OUTLINE_SCALE 倍写进背面壳；非灭绝写零矩阵
                if (om) {
                    tmp.scale.setScalar((ud.extinct && s > 0) ? s * OUTLINE_SCALE : 0);
                    tmp.updateMatrix();
                    om.setMatrixAt(i, tmp.matrix);
                }
            }
            mesh.instanceMatrix.needsUpdate = true;
            if (om) om.instanceMatrix.needsUpdate = true;
        }
    }
    
    function hashString(str) {
        let hash = 0;
        for (let i = 0; i < str.length; i++) {
            hash = ((hash << 5) - hash) + str.charCodeAt(i);
            hash = hash & hash;
        }
        return Math.abs(hash);
    }

    // 块B辅助函数：找标签
    function findLabelForNode(nodeId) {
        // 标签改挂 scene 后直接用查表（原来每帧 scene.traverse 找，漫游里是 O(n²)）
        return nodeLabels[nodeId] || null;
    }
    
    // 块B辅助函数：触发边爬行（写 aAlpha，逐段显现；不再改 drawRange）
    function triggerEdgeCrawl(nodeId) {
        const list = edgesByTo.get(nodeId);
        if (!list || !list.length) return;
        let dirty = false;
        for (let k = 0; k < list.length; k++) {
            const i = list[k];
            const rec = edgeRecords[i];
            if (!rec) continue;
            const edgeId = rec.from + '-' + rec.to;
            // 只有目标节点显现 + 源节点已显现 + 爬行名额未满时才触发
            if (edgeCrawlState.has(edgeId)) continue;
            if (!nodeFlashState.has(rec.from)) continue;
            if (edgeCrawlState.size >= MAX_CRAWLING_EDGES) continue;
            edgeCrawlState.set(edgeId, { startTime: tourTime, index: i, segs: rec.segs, done: false });
            edgeGrowth[i] = 0; // 从 0 起笔
            writeEdgeAlpha(i);
            dirty = true;
        }
        if (dirty && edgeAlphaAttr) edgeAlphaAttr.needsUpdate = true;
    }
    
    // 分帧创建标签：1400 个 CSS2D 元素一次性创建会堵住首帧，改成每帧一批
    function scheduleLabelCreation(list) {
        let i = 0;
        const CHUNK = 140;
        function step() {
            const end = Math.min(list.length, i + CHUNK);
            for (; i < end; i++) {
                try {
                    createNodeLabel(list[i].node, list[i].pos);
                } catch (err) {
                    console.warn('[EVO3D] 标签创建失败:', list[i] && list[i].node && list[i].node.id, err);
                }
            }
            if (i < list.length) {
                if (window.requestIdleCallback) window.requestIdleCallback(step, { timeout: 120 });
                else setTimeout(step, 16);
            }
        }
        step();
    }

    function createNodeLabel(node, pos) {
        const importance = getNodeImportance(node);
        
        const labelDiv = document.createElement('div');
        labelDiv.className = 'node-label';
        labelDiv.style.background = 'rgba(8, 12, 20, 0.55)';
        labelDiv.style.border = '1px solid rgba(255, 255, 255, 0.18)';
        labelDiv.style.borderRadius = '4px';
        labelDiv.style.padding = '4px 8px';
        labelDiv.style.fontSize = '13px';
        // CSS2DRenderer 每帧覆写 style.transform，位移只能用 margin
        // 点在最左，名称向右展开（不遮挡节点）
        labelDiv.style.marginLeft = '14px';
        labelDiv.style.marginTop = '-7px';
        const tlMap = (window.EVO_DATA && window.EVO_DATA.nameTl) || null;
        const isTl = !!(tlMap && tlMap[node.id]);
        labelDiv.innerHTML = '<span class="label-cn' + (isTl ? ' label-tl' : '') + '"' +
                            (isTl ? ' title="音译，非正式中文名"' : '') + '>' + (node.zh || '') + '</span>' +
                            '<span class="label-lat">' + node.latin + '</span>';
        
        const label = new THREE.CSS2DObject(labelDiv);
        // 节点已批渲染（没有独立 mesh 可挂），标签挂 scene，位置 = 节点 layout 坐标
        label.position.set(pos.x, pos.y, pos.z);
        label.userData = { 
            importance: importance, 
            nodeId: node.id,
            rank: node.rank,
            clade: node.clade
        };
        scene.add(label);
        nodeLabels[node.id] = label;
    }

    function getNodeImportance(node) {
        let score = 0;
        if (node.rank === 'clade') score += 5;
        if (node.rank === 'event') score += 4;
        if (node.id === 'luca' || node.id === 'homo_sapiens') score += 10;
        if (['智人', '黑猩猩', '尼安德特人', '真核生物', '细菌', '古菌'].includes(node.zh)) score += 3;
        if (!node.extinct) score += 1;
        if (node.rank === 'species') score += 2;
        return score;
    }

    // 自底向上统计每个节点的后代总数（含间接后代，记忆化 + 防环）
    function computeDescendantCounts() {
        const allEdges = window.EVO_DATA.edges;
        const children = new Map();
        window.EVO_DATA.nodes.forEach(n => children.set(n.id, []));
        allEdges.forEach(e => {
            if (e.type !== 'descent') return;
            if (children.has(e.from)) children.get(e.from).push(e.to);
        });

        const counts = new Map();
        const visiting = new Set();
        function count(id) {
            if (counts.has(id)) return counts.get(id);
            if (visiting.has(id)) return 0; // 防环
            visiting.add(id);
            let total = 0;
            const ch = children.get(id) || [];
            for (let i = 0; i < ch.length; i++) total += 1 + count(ch[i]);
            visiting.delete(id);
            counts.set(id, total);
            return total;
        }
        window.EVO_DATA.nodes.forEach(n => count(n.id));
        descendantCounts = counts;
    }

    // 二次贝塞尔求值（控制点向塔轴内收，照 ref/edges.ts）
    function quadBezier(out, p0, c, p1, t) {
        const it = 1 - t;
        const w0 = it * it, w1 = 2 * it * t, w2 = t * t;
        out.set(
            w0 * p0.x + w1 * c.x + w2 * p1.x,
            w0 * p0.y + w1 * c.y + w2 * p1.y,
            w0 * p0.z + w1 * c.z + w2 * p1.z
        );
        return out;
    }

    function cladeColorOf(nodeId) {
        const n = getNodeIndex()[nodeId];
        return n ? window.EVO3D_LAYOUT.cladeColor(n.clade) : 0x6ec6ff;
    }

    // 把第 i 条谱系边的 aAlpha 按当前 可见性/爬行进度/高亮系数 重新算一遍
    function writeEdgeAlpha(i) {
        const rec = edgeRecords[i];
        if (!rec || !edgeAlpha) return;
        const vis = edgeVis[i];
        const f = edgeFactor[i];
        const base = rec.base;
        const n = rec.segs * 2;
        if (vis <= 0 || f <= 0) {
            for (let k = 0; k < n; k++) edgeAlpha[base + k] = 0;
            rec.visible = false;
            return;
        }
        rec.visible = true;
        const lim = edgeGrowth[i] * rec.segs;
        const mul = rec.tierNorm * vis * f;
        for (let k = 0; k < rec.segs; k++) {
            let v = lim - k;
            if (v > 1) v = 1; else if (v < 0) v = 0;
            const val = v * mul;
            edgeAlpha[base + k * 2] = val;
            edgeAlpha[base + k * 2 + 1] = val;
        }
    }

    // 箭头 alpha：漫游中旧实现是整段 drawRange=0（不可见），这里沿用
    function writeArrowAlpha(i) {
        const rec = edgeRecords[i];
        if (!rec || !rec.arrowCount || !arrowAlpha) return;
        const v = (tourMode ? 0 : 1) * edgeVis[i] * edgeFactor[i] * rec.tierNorm * 0.95;
        const base = rec.arrowBase;
        for (let k = 0; k < rec.arrowCount; k++) arrowAlpha[base + k] = v;
    }

    function writeNetworkAlpha(i) {
        const rec = networkRecords[i];
        if (!rec || !networkAlpha) return;
        const mul = networkVis[i] * rec.baseAlpha;
        const base = rec.base;
        for (let k = 0; k < rec.segs * 2; k++) {
            networkAlpha[base + k] = networkPattern[base + k] * mul;
        }
    }

    function disposeBatch(obj) {
        if (!obj) return;
        if (scene) scene.remove(obj);
        if (obj.geometry) obj.geometry.dispose();
        if (obj.material) obj.material.dispose();
    }

    // 重建前清掉合并对象与所有记录（setTimeMode / 销毁用）
    function clearEdgeBatches() {
        disposeBatch(edgeLine);
        disposeBatch(edgeArrow);
        disposeBatch(networkLine);
        edgeLine = null; edgeArrow = null; networkLine = null;
        edgeAlpha = null; edgeAlphaAttr = null;
        arrowAlpha = null; arrowAlphaAttr = null;
        networkAlpha = null; networkAlphaAttr = null; networkPattern = null;
        edgeVis = null; edgeGrowth = null; edgeFactor = null; networkVis = null;
        edgeRecords = []; networkRecords = [];
        edgesByTo.clear();
        edgeObjects = [];
        networkEdgeObjects = [];
        edgeCrawlState.clear();
    }

    // 谱系边：合并成 1 个 LineSegments + 1 个箭头 Mesh（draw call = 2）
    function createPhylogeneticEdges(edges) {
        const positions = [], colors = [];
        const arrowPositions = [], arrowColors = [];

        // 箭头几何（ConeGeometry(5,15,8)）先展开成非索引顶点，之后逐条边做变换后拼起来
        const coneSrc = new THREE.ConeGeometry(5, 15, 8).toNonIndexed();
        const conePos = coneSrc.attributes.position.array;
        const coneVertsPer = conePos.length / 3;

        const upAxis = new THREE.Vector3(0, 1, 0);
        const dir = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const tmpV = new THREE.Vector3();
        const p0 = new THREE.Vector3(), p1 = new THREE.Vector3();
        const mid = new THREE.Vector3(), ctrl = new THREE.Vector3(), axisPt = new THREE.Vector3();
        const a = new THREE.Vector3(), b = new THREE.Vector3();

        edgesByTo.clear();

        edges.forEach(edge => {
            const fromPos = layout[edge.from];
            const toPos = layout[edge.to];
            if (!fromPos || !toPos) return;

            p0.set(fromPos.x, fromPos.y, fromPos.z);
            p1.set(toPos.x, toPos.y, toPos.z);

            // 弧线控制点：中点向塔轴（x=z=0）内收（照 ref/edges.ts，内收量很小）
            mid.addVectors(p0, p1).multiplyScalar(0.5);
            axisPt.set(0, mid.y, 0);
            ctrl.copy(axisPt).sub(mid);
            if (ctrl.lengthSq() > 1e-6) {
                const bend = Math.min(8, p0.distanceTo(p1) * 0.12);
                ctrl.normalize().multiplyScalar(bend).add(mid);
            } else {
                ctrl.copy(mid);
            }

            // 分级：按子节点（edge.to）的后代总数分四档，颜色取目标节点大类色 × 0.5
            const desc = (descendantCounts && descendantCounts.get(edge.to)) || 0;
            const tier = phyloTier(desc);
            const col = new THREE.Color(cladeColorOf(edge.to)).multiplyScalar(0.5);
            const tierNorm = Math.min(1, tier.opacity / EDGE_TIER_NORM);

            const base = positions.length / 3;
            for (let s = 0; s < EDGE_SEG; s++) {
                quadBezier(a, p0, ctrl, p1, s / EDGE_SEG);
                quadBezier(b, p0, ctrl, p1, (s + 1) / EDGE_SEG);
                positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
                colors.push(col.r, col.g, col.b, col.r, col.g, col.b);
            }

            // 箭头：终点处朝向下一点，尺寸/朝向沿用原逻辑
            dir.subVectors(p1, p0).normalize();
            quat.setFromUnitVectors(upAxis, dir);
            const arrowBase = arrowPositions.length / 3;
            for (let vi = 0; vi < coneVertsPer; vi++) {
                tmpV.set(conePos[vi * 3], conePos[vi * 3 + 1], conePos[vi * 3 + 2]);
                tmpV.applyQuaternion(quat).add(p1);
                arrowPositions.push(tmpV.x, tmpV.y, tmpV.z);
                arrowColors.push(col.r, col.g, col.b);
            }

            const rec = {
                type: 'phylo_edge',
                from: edge.from,
                to: edge.to,
                color: col.getHex(),
                baseIndex: base,
                segCount: EDGE_SEG,
                base: base,
                segs: EDGE_SEG,
                arrowBase: arrowBase,
                arrowCount: coneVertsPer,
                tierNorm: tierNorm,
                desc: desc,
                baseOpacity: tier.opacity,
                tierOpacity: tier.opacity,
                visible: true
            };
            // 兼容层：仍暴露旧版 userData 字段（外部验收脚本可能读它）
            rec.userData = {
                type: 'phylo_edge', from: edge.from, to: edge.to,
                baseOpacity: tier.opacity, desc: desc, tierOpacity: tier.opacity, color: col.getHex()
            };
            const recIndex = edgeRecords.length;
            edgeRecords.push(rec);
            edgeObjects.push(rec);
            if (!edgesByTo.has(edge.to)) edgesByTo.set(edge.to, []);
            edgesByTo.get(edge.to).push(recIndex);
        });

        coneSrc.dispose();

        // --- 谱系线（一个 LineSegments）---
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
        edgeAlpha = new Float32Array(positions.length / 3);
        edgeAlphaAttr = new THREE.BufferAttribute(edgeAlpha, 1);
        geo.setAttribute('aAlpha', edgeAlphaAttr);
        edgeLine = new THREE.LineSegments(geo, makeEdgeMaterial(EDGE_LINE_OPACITY));
        edgeLine.frustumCulled = false;
        edgeLine.userData = { type: 'phylo_edges_batched', count: edgeRecords.length };
        scene.add(edgeLine);

        // --- 箭头（一个 Mesh）---
        const aGeo = new THREE.BufferGeometry();
        aGeo.setAttribute('position', new THREE.Float32BufferAttribute(arrowPositions, 3));
        aGeo.setAttribute('aColor', new THREE.Float32BufferAttribute(arrowColors, 3));
        arrowAlpha = new Float32Array(arrowPositions.length / 3);
        arrowAlphaAttr = new THREE.BufferAttribute(arrowAlpha, 1);
        aGeo.setAttribute('aAlpha', arrowAlphaAttr);
        edgeArrow = new THREE.Mesh(aGeo, makeEdgeMaterial(1.0, THREE.NormalBlending));
        edgeArrow.frustumCulled = false;
        edgeArrow.userData = { type: 'arrows_batched', count: edgeRecords.length };
        scene.add(edgeArrow);

        // --- 逐边状态初始化（全部可见、已完全生长）---
        const n = edgeRecords.length;
        edgeVis = new Float32Array(n).fill(1);
        edgeGrowth = new Float32Array(n).fill(1);
        edgeFactor = new Float32Array(n).fill(1);
        for (let i = 0; i < n; i++) {
            writeEdgeAlpha(i);
            writeArrowAlpha(i);
        }
        edgeAlphaAttr.needsUpdate = true;
        arrowAlphaAttr.needsUpdate = true;
    }

    // 网状边：合并成 1 个 LineSegments（隔段留空模拟原虚线材质）
    function createNetworkEdges(edges) {
        const positions = [], colors = [];

        edges.forEach(edge => {
            const fromPos = layout[edge.from];
            const toPos = layout[edge.to];
            if (!fromPos || !toPos) return;

            const baseColor = NETWORK_EDGE_COLORS[edge.type] || 0xffff00;
            // 网状边整体降饱和，保持可辨但不抢眼
            const color = new THREE.Color(baseColor).multiplyScalar(0.75);
            const base = positions.length / 3;

            for (let s = 0; s < NET_SEG; s++) {
                const t0 = s / NET_SEG, t1 = (s + 1) / NET_SEG;
                positions.push(
                    fromPos.x + (toPos.x - fromPos.x) * t0,
                    fromPos.y + (toPos.y - fromPos.y) * t0,
                    fromPos.z + (toPos.z - fromPos.z) * t0,
                    fromPos.x + (toPos.x - fromPos.x) * t1,
                    fromPos.y + (toPos.y - fromPos.y) * t1,
                    fromPos.z + (toPos.z - fromPos.z) * t1
                );
                colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
            }

            const rec = {
                type: 'network_edge',
                edgeType: edge.type,
                from: edge.from,
                to: edge.to,
                color: color.getHex(),
                baseIndex: base,
                segCount: NET_SEG,
                base: base,
                segs: NET_SEG,
                baseAlpha: 0.45,
                baseOpacity: 0.45,
                visible: true
            };
            rec.userData = { type: 'network_edge', edgeType: edge.type, from: edge.from, to: edge.to, baseOpacity: 0.45 };
            networkRecords.push(rec);
            networkEdgeObjects.push(rec);
        });

        // 虚线图案：偶数段实、奇数段空
        networkPattern = new Float32Array(positions.length / 3);
        for (let i = 0; i < networkRecords.length; i++) {
            const rec = networkRecords[i];
            for (let s = 0; s < NET_SEG; s++) {
                const dash = (s % 2 === 0) ? 1 : 0;
                networkPattern[rec.base + s * 2] = dash;
                networkPattern[rec.base + s * 2 + 1] = dash;
            }
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
        geo.setAttribute('aColor', new THREE.Float32BufferAttribute(colors, 3));
        networkAlpha = new Float32Array(positions.length / 3);
        networkAlphaAttr = new THREE.BufferAttribute(networkAlpha, 1);
        geo.setAttribute('aAlpha', networkAlphaAttr);
        networkLine = new THREE.LineSegments(geo, makeEdgeMaterial(1.0));
        networkLine.frustumCulled = false;
        networkLine.userData = { type: 'network_edges_batched', count: networkRecords.length };
        scene.add(networkLine);

        networkVis = new Float32Array(networkRecords.length).fill(1);
        for (let i = 0; i < networkRecords.length; i++) writeNetworkAlpha(i);
        networkAlphaAttr.needsUpdate = true;
    }


    // ========== 初始取景自动 fit ==========
    function autoFitCamera() {
        const bbox = new THREE.Box3();
        const nodePoints = [];
        Object.values(nodeObjects).forEach(mesh => {
            nodePoints.push(new THREE.Vector3().copy(mesh.position));
            bbox.expandByPoint(mesh.position);
        });

        // 扩展到包含时间轴范围
        bbox.expandByPoint(new THREE.Vector3(0, -2000, 0));
        bbox.expandByPoint(new THREE.Vector3(0, 1000, 0));

        const center = new THREE.Vector3();
        const size = new THREE.Vector3();
        bbox.getCenter(center);
        bbox.getSize(size);

        // 计算需要的相机距离（初值：目标纵向占屏幕 90%）
        const maxDim = Math.max(size.x, size.y, size.z);
        const fov = camera.fov * (Math.PI / 180);
        const tanHalf = Math.tan(fov / 2);
        let cameraDistance = maxDim / (2 * tanHalf) / 0.9;

        // 等角视图方向：俯角约 24°。
        // 俯角太陡时圆盘纵向投影被放大，16:9 画面横向只能占一半，看着就是「挤在中间」；
        // 淋一些才能让盘子横向铺满
        const direction = new THREE.Vector3(1, 1.1, 1).normalize();
        const _dirTmp = new THREE.Vector3();
        const _proj = new THREE.Vector3();
        const _right = new THREE.Vector3();
        const _up = new THREE.Vector3();

        const placeCamera = () => {
            camera.position.copy(center).add(_dirTmp.copy(direction).multiplyScalar(cameraDistance));
            camera.lookAt(center);
        };

        // 设置相机位置（等角视图）
        placeCamera();

        // === 闭环取景：按「节点云屏幕投影包围盒」实测占比收紧距离 ===
        // 目标：主导方向 >= 92%（验收要求 >= 90%），另一方向 <= 97%（留 >= 3% 边距），
        // 且任何节点不得跑出画面（含节点自身屏幕半径 PAD_PX）
        if (nodePoints.length > 0) {
            const FIT_TARGET = 0.92;
            const FIT_MAX = 0.97;
            const PAD_PX = 12;   // 节点屏幕半径约 10px + 2px 余量
            const W = (renderer.domElement && renderer.domElement.clientWidth) || window.innerWidth;
            const H = (renderer.domElement && renderer.domElement.clientHeight) || window.innerHeight;

            const projectBounds = () => {
                placeCamera();
                camera.updateMatrixWorld();
                camera.updateProjectionMatrix();
                camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
                _right.setFromMatrixColumn(camera.matrixWorld, 0);
                _up.setFromMatrixColumn(camera.matrixWorld, 1);
                let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
                nodePoints.forEach(p => {
                    _proj.copy(p).project(camera);
                    const px = (_proj.x * 0.5 + 0.5) * W;
                    const py = (-_proj.y * 0.5 + 0.5) * H;
                    if (px < minX) minX = px;
                    if (px > maxX) maxX = px;
                    if (py < minY) minY = py;
                    if (py > maxY) maxY = py;
                });
                return { minX: minX, maxX: maxX, minY: minY, maxY: maxY };
            };

            for (let i = 0; i < 24; i++) {
                // 1) 把投影包围盒的中心拉回画面中心（口径：偏心就修正 target）
                const b0 = projectBounds();
                const cx0 = (b0.minX + b0.maxX) / 2;
                const cy0 = (b0.minY + b0.maxY) / 2;
                const wpp = (2 * cameraDistance * tanHalf) / H;
                if (Math.abs(cx0 - W / 2) > 1 || Math.abs(cy0 - H / 2) > 1) {
                    center.addScaledVector(_right, (cx0 - W / 2) * wpp);
                    center.addScaledVector(_up, -(cy0 - H / 2) * wpp);
                }
                // 2) 按实测占比比例调整相机距离（px 尺寸 ≈ 1/dist）
                const b = projectBounds();
                const fx = ((b.maxX - b.minX) + 2 * PAD_PX) / W;
                const fy = ((b.maxY - b.minY) + 2 * PAD_PX) / H;
                const m = Math.max(fx, fy);
                if (m < 0.0001) break;
                const nextDist = cameraDistance * (m / FIT_TARGET);
                if (Math.abs(nextDist - cameraDistance) < cameraDistance * 0.004) { cameraDistance = nextDist; break; }
                cameraDistance = nextDist;
            }

            placeCamera();
        }

        controls.target.copy(center);
        controls.update();

        console.log('[EVO3D] 自动取景完成，包围盒中心:', center, '相机距离:', cameraDistance);
    }

    // ========== 节点按相机距离自适应缩放（按各自半径换算，目标屏幕直径 ~10px）==========
    // 透视投影下，半径 r 的球在距离 dist 处的屏幕直径 px = r * s * H / (dist * tanHalf)，
    // 令其恒等于 TARGET_PX 反解出 s = TARGET_PX * dist * tanHalf / (H * r)
    // （上游给的公式里多乘了 2，会把直径翻倍到 20px，这里按验收标准去掉）
    // ========== 节点配色按大类 ==========
    const NODE_HILITE_SELF = 0xffffff;  // 选中的点偏白
    const NODE_HILITE_REL = 0x9fe8ff;   // 高亮到的相关节点用亮青

    const TARGET_PX = 20;
    // 节点首次进入可见状态时的淡入时长（毫秒）
    const FADE_IN_MS = 400;

    // 节点淡入：统一由 applyNodeStyles() 一处写入（fadeStart + FADE_IN_MS），
    // 这里不再保留第二处 opacity 写入者（两处目标值不同会逐帧互相覆盖 → 播放时闪烁）

    function updateNodeScales() {
        const ids = Object.keys(nodeObjects);
        if (ids.length === 0) return;

        // 第一遍：算缩放 + 平均距离（尺寸 = 重要度档位，世界尺寸固定，远处自然变小）
        let distSum = 0;
        const recs = [];
        for (let k = 0; k < ids.length; k++) {
            const id = ids[k];
            const rec = nodeObjects[id];
            if (!rec) continue;
            const dist = camera.position.distanceTo(rec.position);
            const s = rec.userData.baseScale || 1;
            let want = s;
            // 漫游期间：把弹入缩放乘回去（否则会把 pop 动效覆盖掉）
            if (tourMode && nodeFlashState.size > 0) {
                const st = nodeFlashState.get(id);
                if (st) {
                    const kk = Math.min(1, Math.max(0, (tourTime - st.revealedAt) / FLASH_DURATION));
                    if (kk < 1) {
                        const grow = Math.min(1, kk / 0.22);
                        want = s * grow * (1 + 1.6 * Math.pow(1 - kk, 1.6));
                    }
                }
            }
            // 只改记录值；真正的 scale 每帧在 writeNodeInstances 里写进 instance matrix
            if (Math.abs(rec.scale.x - want) > 0.001) rec.scale.setScalar(want);
            distSum += dist;
            recs.push({ rec: rec, dist: dist });
        }
        if (!recs.length) return;

        // 第二遍：纵深淡出（远处节点压到 80%）
        // InstancedMesh 不能逐实例改 opacity，改把 depthFactor 交给 applyNodeStyles 做
        // 「本色 → 背景色」插值；滞回阈值 + 逐帧 lerp 保持原样，避免阈值附近来回跳变闪烁
        const avg = distSum / recs.length;
        const FAR_ON = avg * 1.43;
        const FAR_OFF = avg * 1.17;
        let depthChanged = false;
        for (let i = 0; i < recs.length; i++) {
            const ud = recs[i].rec.userData;
            const dist = recs[i].dist;
            let target = (typeof ud.depthTarget === 'number') ? ud.depthTarget : 1;
            if (ud._isFar) {
                if (dist < FAR_OFF) { ud._isFar = false; target = 1; }
            } else if (dist > FAR_ON) {
                ud._isFar = true; target = 0.8;
            }
            ud.depthTarget = target;
            let cur = (typeof ud.depthFactor === 'number') ? ud.depthFactor : 1;
            if (cur !== target) {
                cur += (target - cur) * 0.08;          // 每帧平滑 8%，单帧最大跳变 0.016
                if (Math.abs(target - cur) < 0.002) cur = target;
                ud.depthFactor = cur;
                depthChanged = true;
            }
        }
        if (depthChanged && typeof applyNodeStyles === 'function') applyNodeStyles();
    }

    // ========== 渲染循环 ==========
    let _perfAccum = 0, _perfFrames = 0;
    const _targetPR = Math.min((window.devicePixelRatio || 1), 1.5);
    function animate() {
        animationId = requestAnimationFrame(animate);
        
        const _tNow = performance.now();
        const dtReal = _lastFrameMs ? Math.min(0.25, (_tNow - _lastFrameMs) / 1000) : 0.016;
        _lastFrameMs = _tNow;
        _elapsedReal += dtReal;
        const elapsed = _elapsedReal;
        
        // 节点自转：已改为 InstancedMesh，每帧由下方 writeNodeInstances(elapsed) 统一写矩阵
        
        // 漫游模式优先
        if (tourMode) {
            updateTour(dtReal);
        } else if (timeFollowEnabled && timeFollowTarget !== null) {
            // 相机跟随时间（整机平移，保持相对偏移）
            const targetY = window.EVO3D_LAYOUT.maToY(timeFollowTarget) + 100;
            const dy = (targetY - controls.target.y) * 0.15;
            controls.target.y += dy;
            camera.position.y += dy;
        }
        
        // 漫游模式：相机由 applyTourPose 直接控制，绝不能让 OrbitControls 再插一手（否则每帧被拽回旧 target）
        if (!tourMode) {
            controls.update();
        } else {
            camera.updateMatrixWorld();
        }
        const _camMoved = _lastCamPos.distanceTo(camera.position) > 0.5 || _lastCamQ.angleTo(camera.quaternion) > 0.002;
        const _now = performance.now();
        if (_camMoved || _now - _lastNodeScaleUpdate > 100) {
            _lastNodeScaleUpdate = _now;
            updateNodeScales();
        }
        // 名字窗口内有强制名时必须每帧刷新（否则播放模式相机不动时会被 400ms 节流挡住）
        _labelFrameTick = (_labelFrameTick + 1) % 2;
        if (forcedNames.size > 0 ? true : ((_camMoved && _labelFrameTick === 0) || _now - _lastLabelUpdate > 400)) {
            _lastCamPos.copy(camera.position);
            _lastCamQ.copy(camera.quaternion);
            _lastLabelUpdate = _now;
            updateLabelVisibility();
        }

        // 唯一的不透明度写入者：每帧统一重算（淡入进度按 performance.now() 线性推进）
        if (typeof applyNodeStyles === 'function') applyNodeStyles();
        writeNodeInstances(elapsed);
        renderer.render(scene, camera);
        labelRenderer.render(scene, camera);

        // 自适应画质：一段时间的平均帧时偏高 → 自动降像素比（弱显卡机器直接受益）；恢复后升回
        _perfAccum += dtReal; _perfFrames++;
        if (_perfFrames >= 90) {
            const avg = _perfAccum / _perfFrames;
            const pr = renderer.getPixelRatio();
            if (avg > 0.028 && pr > 0.66) {
                renderer.setPixelRatio(Math.max(0.66, pr - 0.25));
                renderer.setSize(window.innerWidth, window.innerHeight - 60);
                labelRenderer.setSize(window.innerWidth, window.innerHeight - 60);
            } else if (avg < 0.015 && pr < _targetPR) {
                renderer.setPixelRatio(Math.min(_targetPR, pr + 0.25));
                renderer.setSize(window.innerWidth, window.innerHeight - 60);
                labelRenderer.setSize(window.innerWidth, window.innerHeight - 60);
            }
            _perfAccum = 0; _perfFrames = 0;
        }
    }

    // ========== 标签可见性控制 ==========
    // 说明：真正的实现是下方的"上游补丁"（数学投影 + 尺寸缓存，无逐帧 DOM 读取）。
    // 这里的声明只作占位（下方会对其重新赋值），并保留渲染循环需要的节流计数器。
    let _labelFrameTick = 0;
    function updateLabelVisibility() { /* 由下方上游补丁覆盖 */ }
    function _invalidateLabelCaches() { }

    function rectsOverlap(r1, r2, margin) {
        margin = margin || 0;
        return !(r1.right + margin < r2.left ||
                 r1.left - margin > r2.right ||
                 r1.bottom + margin < r2.top ||
                 r1.top - margin > r2.bottom);
    }

    function onWindowResize() {
        const width = window.innerWidth;
        const height = window.innerHeight - 60;
        
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
        
        renderer.setSize(width, height);
        labelRenderer.setSize(width, height);
    }

    // ========== 样式统一重算（唯一写 opacity / visible 的地方）==========
    // 规则：所有节点/边的 opacity 都从创建时记录的 baseOpacity 重新算出，
    // 绝不使用 "*=" 累乘，因此任意次数、任意顺序的高亮/时间裁剪都不会越点越暗。
    const FADE_FACTOR = 0.08;

    let _nodeIndex = null;
    function getNodeIndex() {
        if (!_nodeIndex) {
            _nodeIndex = {};
            window.EVO_DATA.nodes.forEach(n => { _nodeIndex[n.id] = n; });
        }
        return _nodeIndex;
    }

    function baseOpacityOf(obj) {
        if (obj.userData && typeof obj.userData.baseOpacity === 'number') {
            return obj.userData.baseOpacity;
        }
        return obj.material ? obj.material.opacity : 1;
    }

    function applyNodeStyles() {
        const idx = getNodeIndex();

        // 漫游当前处于第几层（滑动窗口用）：每帧算一次，只有 15 个窗口
        let currentTourLayer = -1;
        if (tourMode && tourPlan && tourPlan.windows) {
            for (let wi = 0; wi < tourPlan.windows.length; wi++) {
                const w = tourPlan.windows[wi];
                if (w.dur <= 0) continue;
                if (tourTime >= w.start && tourTime < w.start + w.dur) { currentTourLayer = wi; break; }
            }
            // 尾段（outro）：不再限制，让整棵树一起出现在画面里
            if (currentTourLayer < 0 && tourTime >= tourPlan.lastWindowEnd) {
                currentTourLayer = tourPlan.windows.length - 1;
            }
            // 显示规则：当前层及其之前的层都显示，之后的层隐藏（由上方 revealAt 控制），不做滑动窗口。
        }
        const relatedIds = currentHighlight ? currentHighlight.relatedIds : null;
        const hasTime = (currentTimeFilter !== null && currentTimeFilter !== undefined);

        // 节点：高亮外的节点淡化；时间裁剪外的节点隐藏
        // InstancedMesh 不能逐实例改透明度：不透明度统一折算成「本色 → 背景色」插值，
        // 颜色只在变化时写实例色缓冲（1400 个每帧全写太贵）
        const b = nodeBatch;
        Object.keys(nodeObjects).forEach(id => {
            const rec = nodeObjects[id];
            const node = idx[id];
            if (!rec || !node) return;
            const ud = rec.userData;

            let factor = 1;
            if (relatedIds && !relatedIds.has(id)) factor = Math.min(factor, FADE_FACTOR);

            let visible = true;
            if (hasTime && node.ma < currentTimeFilter) visible = false;
            // 漫游模式：显隐完全由 revealAt 决定（否则 updateNodeScales→applyNodeStyles 每帧
            // 会把节点全部置为可见，导致 219 个节点一开始就全出现）
            if (tourMode && tourPlan) {
                const revealAt = tourPlan.revealAt[id];
                if (revealAt === undefined || tourTime < revealAt) visible = false;
                else if (currentTourLayer >= 0 && tourPlan.layerIndex) {
                    // 规则（2026-10-18 用户定）：当前层及其之前的所有层都显示，之后的层隐藏（由上麪 revealAt 处理）。
                    // 不做密度自适应/清空前史层——已经讲过的层保留在画面里。
                }
            }

            // 只改记录值；scale=0 由 writeNodeInstances 写进矩阵
            rec.visible = visible;

            // 可见状态发生变化时（含首次进入时间窗）触发一次 0.4s 淡入；持续可见期间不重复淡入
            if (visible !== ud._visState) {
                if (visible) {
                    ud.fadeStart = performance.now();
                    // 时间裁剪/漫游导致的“首次显现”：同一帧登记名字窗口
                    // （加载时的初始全显现不登记，避免一开场就刷 12 个强制名）
                    if (tourMode || hasTime) registerForcedName(id);
                }
                ud._visState = visible;
            }

            // 颜色：大类本色 → 选中（白）/相关（亮青） → 按不透明度向背景色插值
            const col = _nodeColorTmp.copy(ud.baseColor);
            const isSelf = !!(relatedIds && currentHighlight && currentHighlight.nodeId === id);
            if (relatedIds && relatedIds.has(id)) {
                if (isSelf) col.set(NODE_HILITE_SELF);
                else col.set(NODE_HILITE_REL);
            } else {
                // 亮度补偿（高亮色不参与，避免过曝）
                col.r = Math.min(1, col.r * NODE_BRIGHT_BOOST);
                col.g = Math.min(1, col.g * NODE_BRIGHT_BOOST);
                col.b = Math.min(1, col.b * NODE_BRIGHT_BOOST);
            }
            // 漫游中按「离当前层多远」压暗：当前层全亮，历史层逐级变暗（不再硬隐藏，但不会抢镜头）
            if (tourMode && tourPlan && tourPlan.layerIndex && currentTourLayer >= 0) {
                const li = tourPlan.layerIndex[id];
                if (li !== undefined && li < currentTourLayer) {
                    const dd = currentTourLayer - li;
                    const df = dd === 1 ? 0.55 : (dd === 2 ? 0.35 : (dd === 3 ? 0.24 : 0.18));
                    col.multiplyScalar(df);
                }
            }
            // 漫游闪白：显现后 FLASH_DURATION 内冲亮（照源码 color*(1+flash*12)）
            if (tourMode && nodeFlashState.size) {
                const st = nodeFlashState.get(id);
                if (st) {
                    const fk = Math.min(1, Math.max(0, (tourTime - st.revealedAt) / FLASH_DURATION));
                    if (fk < 1) col.multiplyScalar(1 + (1 - fk) * 12);
                }
            }

            // 不透明度（baseOpacity 已含灭绝 0.5）× 高亮系数 × 纵深 × 淡入进度 → 压向背景色
            const depthFactor = (typeof ud.depthFactor === 'number') ? ud.depthFactor : 1;
            const target = (typeof ud.baseOpacity === 'number' ? ud.baseOpacity : 1) * factor * depthFactor;
            let op = target;
            if (ud.fadeStart !== undefined) {
                const p = Math.min(1, (performance.now() - ud.fadeStart) / FADE_IN_MS);
                op = target * p;
            }
            ud.targetOpacity = target;
            const mix = Math.min(1, Math.max(0, 1 - op));
            if (mix > 0.0005 && b) col.lerp(b.bg, mix);

            const hex = col.getHex();
            if (hex !== ud.__lastColor) {
                const slot = b && b.index.get(id);
                if (slot) {
                    const im = b.meshes[slot.lv];
                    im.setColorAt(slot.i, col);
                    if (im.instanceColor) im.instanceColor.needsUpdate = true;
                }
                ud.__lastColor = hex;
            }
        });

        // 谱系边 / 箭头（已合并：统一写每顶点 aAlpha，不再逐个对象改 material.opacity）
        if (edgeRecords.length) {
            let edgeDirty = false, arrowDirty = false;
            for (let i = 0; i < edgeRecords.length; i++) {
                const rec = edgeRecords[i];
                const from = idx[rec.from];
                const to = idx[rec.to];

                let factor = 1;
                if (relatedIds && (!relatedIds.has(rec.from) || !relatedIds.has(rec.to))) {
                    factor = Math.min(factor, FADE_FACTOR);
                }

                let visible = 1;
                if (hasTime && !(from && to && from.ma >= currentTimeFilter && to.ma >= currentTimeFilter)) visible = 0;
                // 漫游中：显隐由 revealAt 决定（两端都显现才画）
                if (tourMode && tourPlan) {
                    const ra1 = tourPlan.revealAt[rec.from];
                    const ra2 = tourPlan.revealAt[rec.to];
                    if (ra1 === undefined || ra2 === undefined || tourTime < ra1 || tourTime < ra2) visible = 0;
                    // 滑动窗口：端点被窗口甩在后面时连线一起隐掉
                    // 连线同样不做窗口限制：两端都已显现就画
                }

                if (edgeFactor[i] !== factor || edgeVis[i] !== visible) {
                    edgeFactor[i] = factor;
                    edgeVis[i] = visible;
                    writeEdgeAlpha(i);
                    writeArrowAlpha(i);
                    edgeDirty = true;
                    arrowDirty = true;
                }
            }
            if (edgeDirty && edgeAlphaAttr) edgeAlphaAttr.needsUpdate = true;
            if (arrowDirty && arrowAlphaAttr) arrowAlphaAttr.needsUpdate = true;
        }

        // 网状边：仅跟随时间裁剪
        if (networkRecords.length) {
            let netDirty = false;
            for (let i = 0; i < networkRecords.length; i++) {
                const rec = networkRecords[i];
                const from = idx[rec.from];
                const to = idx[rec.to];
                let visible = 1;
                if (hasTime && !(from && to && from.ma >= currentTimeFilter && to.ma >= currentTimeFilter)) visible = 0;
                if (networkVis[i] !== visible) {
                    networkVis[i] = visible;
                    rec.visible = visible > 0;
                    writeNetworkAlpha(i);
                    netDirty = true;
                }
            }
            if (netDirty && networkAlphaAttr) networkAlphaAttr.needsUpdate = true;
        }
    }

    // ========== 高亮功能 ==========
    function highlightNode(nodeId) {
        clearHighlight();

        const ancestors = getAncestors(nodeId);
        const descendants = getDescendants(nodeId);
        const relatedIds = new Set([nodeId, ...ancestors, ...descendants]);

        currentHighlight = { nodeId, relatedIds };
        applyNodeStyles();
    }

    function clearHighlight() {
        if (!currentHighlight) return;
        currentHighlight = null;
        applyNodeStyles();
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

    // ========== 时间过滤 ==========
    function setTimeCutoff(ma) {
        currentTimeFilter = ma;
        applyNodeStyles();
        
        // 更新跟随目标
        if (timeFollowEnabled) {
            timeFollowTarget = ma;
        }
    }

    function clearTimeCutoff() {
        currentTimeFilter = null;
        applyNodeStyles();
        
        // 停止跟随
        timeFollowTarget = null;
    }

    // ========== 相机控制 ==========
    function focusNode(nodeId) {
        const mesh = nodeObjects[nodeId];
        if (!mesh) return;

        const targetPos = mesh.position.clone();
        const currentPos = camera.position.clone();
        const distance = 400;

        const direction = currentPos.clone().sub(targetPos).normalize();
        const newPos = targetPos.clone().add(direction.multiplyScalar(distance));

        const steps = 60;
        let step = 0;

        function animateCamera() {
            if (step >= steps) return;
            
            camera.position.lerpVectors(currentPos, newPos, step / steps);
            controls.target.lerpVectors(controls.target, targetPos, step / steps);
            controls.update();
            
            step++;
            requestAnimationFrame(animateCamera);
        }

        animateCamera();
    }

    function setPresetView(view) {
        const bbox = new THREE.Box3();
        Object.values(nodeObjects).forEach(mesh => {
            bbox.expandByPoint(mesh.position);
        });
        const center = new THREE.Vector3();
        bbox.getCenter(center);

        let newPos;
        const distance = 3000;

        switch (view) {
            case 'top':
                newPos = new THREE.Vector3(center.x, center.y + distance, center.z);
                break;
            case 'side':
                newPos = new THREE.Vector3(center.x + distance, center.y, center.z);
                break;
            case 'front':
                newPos = new THREE.Vector3(center.x, center.y, center.z + distance);
                break;
            case 'iso':
            default:
                newPos = new THREE.Vector3(center.x + distance * 0.7, center.y + distance * 0.5, center.z + distance * 0.7);
        }

        camera.position.copy(newPos);
        controls.target.copy(center);
        controls.update();
        
        // 更新标签可见性
        updateLabelVisibility();
    }

    function autoRotate(enabled) {
        controls.autoRotate = enabled;
        controls.autoRotateSpeed = 1.0;
    }

    function setTimeMode(mode) {
        window.EVO3D_LAYOUT.setTimeMode(mode);
        
        layout = window.EVO3D_LAYOUT.computeLayout(window.EVO_DATA.nodes);
        
        Object.keys(nodeObjects).forEach(id => {
            const pos = layout[id];
            if (!pos) return;
            // 节点是轻量记录，位置写进记录即可（实例矩阵每帧按记录重写）
            nodeObjects[id].position.set(pos.x, pos.y, pos.z);
            // 标签挂 scene，换了布局要跟着挪，否则名字会留在旧位置
            const lbl = nodeLabels[id];
            if (lbl) lbl.position.set(pos.x, pos.y, pos.z);
        });

        // 连线需要按新布局重建：先清掉合并后的批处理对象，再重建
        clearEdgeBatches();

        const edges = window.EVO_DATA.edges;
        createPhylogeneticEdges(edges.filter(e => e.type === 'descent'));
        createNetworkEdges(edges.filter(e => e.type !== 'descent'));

        // 重建后按当前高亮/时间裁剪重新算一次 alpha
        applyNodeStyles();

    }

    // ========== 射线拾取 ==========
    function pickAt(clientX, clientY) {
        const raycaster = new THREE.Raycaster();
        const mouse = new THREE.Vector2();

        const rect = renderer.domElement.getBoundingClientRect();
        mouse.x = ((clientX - rect.left) / rect.width) * 2 - 1;
        mouse.y = -((clientY - rect.top) / rect.height) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);
        // 拾取：只对 5 个 InstancedMesh 做射线检测，再用 instanceId + 该桶索引表还原 node id
        const intersects = raycaster.intersectObjects(nodeBatch ? nodeBatch.meshes : []);
        for (let i = 0; i < intersects.length; i++) {
            const hit = intersects[i];
            if (hit.instanceId === undefined || hit.instanceId === null) continue;
            const lv = ((hit.object.userData && hit.object.userData.level) || 1) - 1;
            const rec = nodeBatch && nodeBatch.items[lv] && nodeBatch.items[lv][hit.instanceId];
            if (!rec) continue;
            // 被时间游标裁掉 / 漫游未显现的节点（scale=0）不可拾取
            if (!rec.visible || rec.scale.x <= 0.0001) continue;
            return rec.nodeId;
        }

        return null;
    }

    // ========== 统计 ==========
    function stats() {
        const edges = window.EVO_DATA.edges;
        return {
            nodes: window.EVO_DATA.nodes.length,
            edges: edges.filter(e => e.type === 'descent').length,
            networkEdges: edges.filter(e => e.type !== 'descent').length
        };
    }

    function labelStats() {
        const allLabels = [];
        scene.traverse(obj => {
            if (obj instanceof THREE.CSS2DObject && obj.userData.nodeId) {
                const elem = obj.element;
                // 使用 getComputedStyle 获取最终计算后的样式
                const computed = window.getComputedStyle(elem);
                if (computed.display !== 'none') {
                    allLabels.push(elem);
                }
            }
        });

        // 计算重叠数
        let overlaps = 0;
        for (let i = 0; i < allLabels.length; i++) {
            const r1 = allLabels[i].getBoundingClientRect();
            for (let j = i + 1; j < allLabels.length; j++) {
                const r2 = allLabels[j].getBoundingClientRect();
                if (rectsOverlap(r1, r2, 1)) {
                    overlaps++;
                }
            }
        }

        return {
            visible: allLabels.length,
            overlaps: overlaps,
            maxVisible: MAX_VISIBLE_LABELS
        };
    }

    // ========== 漫游模式 ==========
    function buildTourPlan() {
        const timescale = window.EVO3D_LAYOUT.GEO_TIMESCALE;
        const nodes = window.EVO_DATA.nodes;
        
        // 按层统计节点数和最大半径
        const layers = timescale.map(band => ({
            band: band,
            nodes: [],
            y: 0,
            maxRadius: 0
        }));
        
        nodes.forEach(node => {
            const pos = layout[node.id];
            if (!pos) return;
            
            const ma = node.ma;
            for (let i = 0; i < timescale.length; i++) {
                const band = timescale[i];
                if (ma >= band.end && ma <= band.start) {
                    layers[i].nodes.push({ node, pos });
                    const r = Math.sqrt(pos.x * pos.x + pos.z * pos.z);
                    layers[i].maxRadius = Math.max(layers[i].maxRadius, r);
                    break;
                }
            }
        });
        
        // 计算层高度：优先用 layerY，回退到 maToY
        layers.forEach((layer, li) => {
            const layY = window.EVO3D_LAYOUT.layerY;
            if (layY && layY.length > li && typeof layY[li] === 'number') {
                layer.y = layY[li];
            } else if (layer.nodes.length > 0) {
                const mas = layer.nodes.map(n => n.node.ma).sort((a, b) => a - b);
                const medianMa = mas[Math.floor(mas.length / 2)];
                layer.y = window.EVO3D_LAYOUT.maToY(medianMa);
            } else {
                layer.y = window.EVO3D_LAYOUT.maToY((layer.band.start + layer.band.end) / 2);
            }
        });
        
        // 按节点数分配时长
        const counts = layers.map(l => l.nodes.length);
        const present = counts.filter(c => c > 0);
        const nMin = present.length > 0 ? Math.min(...present) : 1;
        const nMax = present.length > 0 ? Math.max(...present) : 1;
        
        const windows = [];
        let cursor = TOUR_BLEND;
        
        layers.forEach((layer, i) => {
            const n = layer.nodes.length;
            // 其余层保持原来的 6–15 秒归一化节奏，再按 TOUR_SPEED_SCALE 降速
            let dur = n === 0 ? 0 :
                nMax === nMin ? TOUR_MIN_DUR :
                TOUR_MIN_DUR + (TOUR_MAX_DUR - TOUR_MIN_DUR) * (n - nMin) / (nMax - nMin);
            if (n > 0) dur = dur / TOUR_SPEED;

            // 最后一层例外：它塞了 600+ 个节点（含 464 个现存物种），单独按 TOUR_LAST_RATE 拉长
            const isLastLayer = (i === layers.length - 1);
            if (isLastLayer && n > 0) {
                dur = Math.max(dur, Math.min(TOUR_LAST_MAX, n / TOUR_LAST_RATE));
            }
            
            windows.push({
                start: cursor,
                dur: dur,
                y: layer.y,
                maxRadius: layer.maxRadius,
                layerIndex: i
            });
            
            cursor += dur;
        });
        
        const total = cursor + TOUR_OUTRO;
        
        // 计算每个节点的显现时刻（层内按 ma 降序）
        const revealAt = {};
        const layerIndex = {};
        layers.forEach((layer, i) => {
            const sorted = layer.nodes.slice().sort((a, b) => b.node.ma - a.node.ma);
            const win = windows[i];
            sorted.forEach((item, k) => {
                revealAt[item.node.id] = win.start + win.dur * (k + 0.5) / sorted.length;
                // 记录节点属于哪一层：漫游时要按“只保留当前层与上一层”做滑动窗口
                layerIndex[item.node.id] = i;
            });
        });
        const lastWindowEnd = windows.length ? (windows[windows.length - 1].start + windows[windows.length - 1].dur) : 0;
        const layerCounts = layers.map(l => l.nodes.length);
        
        return { windows, total, revealAt, layerIndex, lastWindowEnd, layerCounts, layers };
    }
    
    function smoothstep(x) {
        const t = Math.min(1, Math.max(0, x));
        return t * t * (3 - 2 * t);
    }
    
    function tourTrackY(t) {
        if (!tourPlan) return 0;
        
        const windows = tourPlan.windows;
        let layerIdx = 0;
        for (let i = 0; i < windows.length; i++) {
            if (t < windows[i].start + windows[i].dur) {
                layerIdx = i;
                break;
            }
        }
        
        const win = windows[layerIdx];
        const u = win.dur > 0 ? Math.min(1, Math.max(0, (t - win.start) / win.dur)) : 1;
        const nextIdx = Math.min(layerIdx + 1, windows.length - 1);
        const nextY = layerIdx < windows.length - 1 ? windows[nextIdx].y :
            windows[windows.length - 1].y + (windows[windows.length - 1].y - windows[Math.max(0, windows.length - 2)].y);
        
        return win.y + (nextY - win.y) * smoothstep(u);
    }
    
    function tourRadiusAtY(y) {
        if (!tourPlan) return 1000;
        
        const windows = tourPlan.windows;
        if (y <= windows[0].y) return windows[0].maxRadius;
        
        for (let i = 0; i < windows.length - 1; i++) {
            if (y <= windows[i + 1].y) {
                const f = (y - windows[i].y) / (windows[i + 1].y - windows[i].y);
                return windows[i].maxRadius + (windows[i + 1].maxRadius - windows[i].maxRadius) * f;
            }
        }
        
        return windows[windows.length - 1].maxRadius;
    }
    
    function tourFovAt(t) {
        const y = tourTrackY(t);
        const r = tourRadiusAtY(y);
        const deg = 2 * Math.atan(TOUR_FOV_MARGIN * r / TOUR_LEAD) * 180 / Math.PI;
        return Math.min(TOUR_FOV_MAX, Math.max(TOUR_FOV_MIN, deg));
    }
    
    function startTour() {
        if (tourMode) return;
        
        tourMode = true;
        tourTime = 0;
        tourPlan = buildTourPlan();
        
        tourStartPos.copy(camera.position);
        tourStartTarget.copy(controls.target);
        
        // 自适应镜头：记录进入漫游前的 fov；重置自适应状态（首帧即被实测半径替换）
        tourAdaptHomeFov = camera.fov;
        tourAdaptFov = camera.fov;
        tourAdaptRadius = TOUR_ADAPT_RADIUS_FALLBACK;
        tourAdaptAbove = TOUR_LEAD_MIN;
        
        controls.enabled = false;
        
        // 块B初始化：隐藏所有节点和边
        nodeFlashState.clear();
        forcedNames.clear();
        edgeCrawlState.clear();
        
        Object.values(nodeObjects).forEach(rec => {
            rec.scale.setScalar(0);
            rec.visible = false;
        });
        
        // 合并连线：全部隐去（爬行进度归零），等目标节点显现时逐条爬出
        if (edgeRecords.length) {
            for (let i = 0; i < edgeRecords.length; i++) {
                edgeGrowth[i] = 0;
                writeEdgeAlpha(i);
                writeArrowAlpha(i);
            }
            if (edgeAlphaAttr) edgeAlphaAttr.needsUpdate = true;
            if (arrowAlphaAttr) arrowAlphaAttr.needsUpdate = true;
        }
        if (networkRecords.length) {
            for (let i = 0; i < networkRecords.length; i++) {
                networkVis[i] = 0;
                writeNetworkAlpha(i);
            }
            if (networkAlphaAttr) networkAlphaAttr.needsUpdate = true;
        }
        scene.traverse(obj => {
            if (obj instanceof THREE.CSS2DObject && obj.userData.nodeId) {
                if (obj.element) obj.element.style.opacity = '0';
            }
        });
    }
    
    function stopTour() {
        if (!tourMode) return;
        
        tourMode = false;
        controls.enabled = true;
        
        // 清空漫游期间的相机水平跟随状态（下次漫游重新起算）
        tourFollowReady = false;
        tourFollowX = 0;
        tourFollowZ = 0;
        
        camera.up.set(0, 1, 0);
        // 恢复漫游前的 FOV（漫游中已按“已显现节点实际范围”自适应，退出后不能留下怪异的 fov）
        if (camera.fov !== tourAdaptHomeFov) {
            camera.fov = tourAdaptHomeFov;
            camera.updateProjectionMatrix();
        }
        controls.target.set(0, camera.position.y, 0);
        // 漫游主段相机在中轴线上（x=z=0），此时 target 与相机位置重合 → OrbitControls 球半径=0
        // （被夹到 minDistance）、朝向随机；相机矩阵/投影随之失真，标签碰撞剔除会把 219 个标签
        // 全部判为不可见（labelStats().visible===0）。这种情况下把注视点放到正下方，
        // 取景距离与漫游中一致（TOUR_LEAD），退出后看到的仍是那棵树。
        if (Math.hypot(camera.position.x, camera.position.z) < 1) {
            controls.target.set(0, camera.position.y - TOUR_LEAD, 0);
        }
        controls.update();
        
        // 块B恢复：所有节点、边、标签恢复正常
        Object.values(nodeObjects).forEach(rec => {
            rec.visible = true;
            rec.scale.setScalar(rec.userData.baseScale || 1);
            // 颜色统一由 applyNodeStyles 重算（清掉漫游闪白残留）
            rec.userData.__lastColor = -1;
        });
        
        // 合并连线恢复：全部长满（时间裁剪/高亮系数由 applyNodeStyles 重算）
        if (edgeRecords.length) {
            for (let i = 0; i < edgeRecords.length; i++) {
                edgeGrowth[i] = 1;
                edgeVis[i] = 1;
                edgeFactor[i] = 1;
                writeEdgeAlpha(i);
                writeArrowAlpha(i);
            }
            if (edgeAlphaAttr) edgeAlphaAttr.needsUpdate = true;
            if (arrowAlphaAttr) arrowAlphaAttr.needsUpdate = true;
        }
        if (networkRecords.length) {
            for (let i = 0; i < networkRecords.length; i++) {
                networkVis[i] = 1;
                writeNetworkAlpha(i);
            }
            if (networkAlphaAttr) networkAlphaAttr.needsUpdate = true;
        }
        // 按当前高亮 / 时间裁剪状态重算一次（stopTour 后 tourMode 已为 false）
        applyNodeStyles();
        // 标签复原：清掉漫游期间的接管状态（漫游名字淡入淡出写死的 opacity、
        // 标签碰撞剔除写死的 visible=false / display）
        scene.traverse(obj => {
            if (obj instanceof THREE.CSS2DObject && obj.userData.nodeId) {
                obj.visible = true;
                if (obj.element) {
                    obj.element.style.opacity = '';
                    obj.element.style.display = '';
                }
            }
        });
        
        forcedNames.clear();
        nodeFlashState.clear();
        edgeCrawlState.clear();
        
        // 立即按正常规则（距离/重要性 + 名称预算 + 防重叠）重算一次，不等下一帧的 400ms 节流
        _lastLabelUpdate = 0;
        _lastCamPos.set(1e9, 1e9, 1e9);
        camera.updateMatrixWorld();
        camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
        updateLabelVisibility();
        labelRenderer.render(scene, camera);
    }
    
    function updateTour(dt) {
        if (!tourMode || !tourPlan) return;
        
        tourTime += dt;
        
        if (tourTime >= tourPlan.total) {
            applyTourPose(tourPlan.total);
            stopTour();
            return;
        }
        
        applyTourPose(tourTime);
        
        // === 漫游居中：按“屏幕投影重心”反推相机水平位移（闭环）===
        // 俯视透视下 3D 均值的投影 ≠ 投影后的屏幕重心（离相机近的节点在画面上偏移更大），
        // 所以直接对屏幕空间闭环：把已显现节点的平均 NDC 偏差换算成相机平面内的世界位移，
        // 同时加到相机位置与 controls.target（二者在应用时都由 tourFollowX/Z 派生，故改它即可）。
        {
            camera.updateMatrixWorld();
            camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
            const _e = camera.matrixWorld.elements;
            const _rx = _e[0], _rz = _e[2];   // 相机世界右向量（本段与 y 无关）
            const _ux = _e[4], _uz = _e[6];   // 相机世界上向量（本段与 y 无关）
            let _nn = 0, _sxn = 0, _syn = 0, _sd = 0, _scx = 0, _scz = 0;
            for (const _id in nodeObjects) {
                const _ra = tourPlan.revealAt[_id];
                if (_ra === undefined || tourTime < _ra) continue;
                const _m = nodeObjects[_id];
                if (!_m.visible || _m.scale.x <= 0.05) continue;
                _tourTmpV.copy(_m.position);   // 节点是轻量记录，位置直接在 position 上
                const _wx = _tourTmpV.x, _wz = _tourTmpV.z;
                _scx += _wx; _scz += _wz;                       // 水平重心累加
                if (_nn < _tourRX.length) { _tourRX[_nn] = _wx; _tourRZ[_nn] = _wz; }
                _sd += Math.max(1, camera.position.y - _tourTmpV.y); // 相机前向(=下)深度
                _tourTmpV.project(camera);
                _sxn += _tourTmpV.x;
                _syn += _tourTmpV.y;
                _nn++;
            }
            // 实际范围：以已显现节点水平重心为圆心、到最远节点的距离（下限 120；R 为空用兜底 200）
            let _rn = TOUR_ADAPT_RADIUS_FALLBACK;
            if (_nn > 0) {
                const _cx = _scx / _nn, _cz = _scz / _nn;
                let _rmax = 0;
                const _cnt = Math.min(_nn, _tourRX.length);
                for (let _i = 0; _i < _cnt; _i++) {
                    const _dr = Math.hypot(_tourRX[_i] - _cx, _tourRZ[_i] - _cz);
                    if (_dr > _rmax) _rmax = _dr;
                }
                _rn = Math.max(TOUR_ADAPT_RADIUS_FLOOR, _rmax);
                
                const _dxn = _sxn / _nn, _dyn = _syn / _nn;        // NDC 偏差（中心=0）
                const _refD = _sd / _nn;                            // 参考距离 = 平均深度
                const _halfH = Math.tan(camera.fov * Math.PI / 360) * _refD;
                const _halfW = _halfH * camera.aspect;
                const _dwx = _rx * (_dxn * _halfW) + _ux * (_dyn * _halfH);
                const _dwz = _rz * (_dxn * _halfW) + _uz * (_dyn * _halfH);
                const _dtc0 = Math.max(0, Math.min(0.1, dt));
                const _k2 = 1 - Math.exp(-_dtc0 * 2.2);   // 居中平移降速（原来 6，镜头会跟着新节点抽动）
                tourFollowX += _dwx * _k2;
                tourFollowZ += _dwz * _k2;
            }
            // 半径改平滑跟随：新节点可能一下子把半径撑大，直接赋值会让镜头一跳一跳
            const _dtc = Math.max(0, Math.min(0.1, dt));
            const _kR = 1 - Math.exp(-_dtc * 2.0);
            tourAdaptRadius += (_rn - tourAdaptRadius) * _kR;
            
            const _k3 = 1 - Math.exp(-_dtc * 2.0);
            // 镜头高度自适应：camAbove = clamp(2.0 * 平滑后的半径, 260, 2600)，两个方向都平滑（变大略快防出画）
            const _above = Math.min(TOUR_LEAD_MAX, Math.max(TOUR_LEAD_MIN, 2.0 * tourAdaptRadius));
            const _kUp = 1 - Math.exp(-_dtc * 4.0);
            const _kDown = 1 - Math.exp(-_dtc * 1.0);
            tourAdaptAbove += (_above - tourAdaptAbove) * (_above > tourAdaptAbove ? _kUp : _kDown);
            
            // FOV 自适应：用平滑后的半径，避免每个新节点都把视场角抽一下
            const _fovT = Math.min(TOUR_ADAPT_FOV_MAX, Math.max(TOUR_ADAPT_FOV_MIN,
                2 * Math.atan(TOUR_ADAPT_MARGIN * tourAdaptRadius / tourAdaptAbove) * 180 / Math.PI));
            tourAdaptFov += (_fovT - tourAdaptFov) * _k3;
        }
        
        // === 块B：节点显现 + 弹入闪白 ===
        // 已改批渲染：这里只登记“已显现”，闪白由 applyNodeStyles 每帧按 nodeFlashState 冲亮，
        // 弹入缩放由 updateNodeScales 乘进 scale（不再写 material / mesh.scale）
        Object.keys(nodeObjects).forEach(nodeId => {
            const rec = nodeObjects[nodeId];
            const revealAt = tourPlan.revealAt[nodeId];
            if (revealAt === undefined) return;
            if (tourTime - revealAt < 0) return;
            if (nodeFlashState.has(nodeId)) return;
            rec.visible = true;
            nodeFlashState.set(nodeId, { revealedAt: tourTime });
            // 触发名字显示：与节点同帧立即出现（visible + display + opacity 从 0 淡入 0.15s）
            registerForcedName(nodeId);
            // 触发连线爬行
            triggerEdgeCrawl(nodeId);
        });
        
        // 名字停留/淡入淡出统一由 updateLabelVisibility() 的强制名逻辑写 opacity
        // （此处不再写 opacity，避免两处互相覆盖），NAME_LIFE/FADE_IN/FADE_OUT 仍在那里生效
        
        // === 块B：连线爬行（写 aAlpha，逐段显现；不再改 drawRange）===
        if (edgeCrawlState.size) {
            let crawlDirty = false;
            edgeCrawlState.forEach((state, edgeId) => {
                if (state.done) return;
                const elapsed = tourTime - state.startTime;
                const p = EDGE_CRAWL_TIME <= 0 ? 1 : Math.min(1, elapsed / EDGE_CRAWL_TIME);
                edgeGrowth[state.index] = p;
                writeEdgeAlpha(state.index);
                crawlDirty = true;
                if (p >= 1) {
                    state.done = true;
                    edgeCrawlState.delete(edgeId); // 爬完就释放名额
                }
            });
            if (crawlDirty && edgeAlphaAttr) edgeAlphaAttr.needsUpdate = true;
        }
        
        // === 漫游：任一端尚未显现的连线一律隐去（写 alpha，不再改 drawRange）===
        const revealed = (id) => {
            if (!id) return false;
            const ra = tourPlan.revealAt[id];
            return ra !== undefined && tourTime >= ra;
        };
        let visDirty = false, arrowVisDirty = false, netVisDirty = false;
        for (let i = 0; i < edgeRecords.length; i++) {
            const rec = edgeRecords[i];
            const v = (revealed(rec.from) && revealed(rec.to)) ? 1 : 0;
            if (edgeVis[i] !== v) {
                edgeVis[i] = v;
                writeEdgeAlpha(i);
                writeArrowAlpha(i);
                visDirty = true;
                arrowVisDirty = true;
            }
        }
        for (let i = 0; i < networkRecords.length; i++) {
            const rec = networkRecords[i];
            const v = (revealed(rec.from) && revealed(rec.to)) ? 1 : 0;
            if (networkVis[i] !== v) {
                networkVis[i] = v;
                writeNetworkAlpha(i);
                netVisDirty = true;
            }
        }
        if (visDirty && edgeAlphaAttr) edgeAlphaAttr.needsUpdate = true;
        if (arrowVisDirty && arrowAlphaAttr) arrowAlphaAttr.needsUpdate = true;
        if (netVisDirty && networkAlphaAttr) networkAlphaAttr.needsUpdate = true;
    }
    
    function applyTourPose(t) {
        if (!tourPlan) return;
        
        const trackY = tourTrackY(t);
        const y = trackY + tourAdaptAbove;
        const topWindow = tourPlan.windows[tourPlan.windows.length - 1];
        const endMainTour = topWindow.start + topWindow.dur;
        
        let pos = new THREE.Vector3();
        let target = new THREE.Vector3();
        let up = new THREE.Vector3();
        
        if (t <= endMainTour) {
            // 主漫游：垂直上升 + 水平跟随已显现节点重心（当前盘面居中在画面中央）
            pos.set(tourFollowX, y, tourFollowZ);
            target.set(tourFollowX, y - 100, tourFollowZ);
        } else {
            // 收尾：后撤到全景位
            const s = smoothstep((t - endMainTour) / TOUR_OUTRO);
            const maxY = tourPlan.layers[tourPlan.layers.length - 1].y;
            const d = 2000; // 简化的全景距离
            
            pos.set(
                THREE.MathUtils.lerp(tourFollowX, d, s),
                THREE.MathUtils.lerp(y, maxY * 0.68, s),
                THREE.MathUtils.lerp(tourFollowZ, d, s)
            );
            
            const lookY = maxY * 0.5;
            target.set(tourFollowX, y - 100, tourFollowZ).lerp(new THREE.Vector3(0, lookY, 0), s);
        }
        
        // 滚转 up 向量（tourRollOn 关闭时角度固定 → 画面不旋转）
        const a = TOUR_START_ANGLE + (tourRollOn ? t * TOUR_ROLL : 0);
        up.set(Math.cos(a), 0, Math.sin(a));
        
        if (t > endMainTour) {
            up.lerp(new THREE.Vector3(0, 1, 0), smoothstep((t - endMainTour) / TOUR_OUTRO)).normalize();
        }
        
        // 开场融入
        if (t < TOUR_BLEND) {
            const k = t / TOUR_BLEND;
            const s = smoothstep(k);
            pos.lerpVectors(tourStartPos, pos, s);
            target.lerpVectors(tourStartTarget, target, s);
            up.lerpVectors(new THREE.Vector3(0, 1, 0), up, s);
        }
        
        camera.position.copy(pos);
        camera.up.copy(up);
        camera.lookAt(target);
        camera.fov = tourAdaptFov;
        camera.updateProjectionMatrix();
        // 同步 OrbitControls 的内部状态，避免退出漫游时或后续 update() 发生跳变
        if (controls && controls.target) controls.target.copy(target);
    }

    // ===== 上游修复补丁（重要）=====
    // CSS2DRenderer 每帧都会用 object.visible 覆写 element.style.display，
    // 旧实现直接改 element.style.display 会被立刻覆盖 → 219 个标签全显示、糊成一片。
    // 正确做法：用 object.visible 控制显隐，并用“投影坐标 + 缓存尺寸”做屏幕空间碰撞剔除。
    // CSS2DRenderer 用 translate(-50%,-50%) 居中，随后 CSS 的 margin-left:14px / margin-top:-7px
    // 把元素整体右移 14px、上移 7px。碰撞矩形必须用同一个中心点，否则每个标签都偏 14px →
    // 真实 DOM 会重叠而算法却判定“不重叠”（这是标签仍交叠的根因）
    var LABEL_DX = 14;
    var LABEL_DY = -7;
    var LABEL_MARGIN = 10;   // 防重叠间距（px）

    // 名字窗口内的“强制名”注册：节点显现的同一帧调用
    // 立即把标签设为可见并从 opacity 0 开始淡入；窗口（NAME_LIFE）内由 updateLabelVisibility 无条件保留
    function registerForcedName(nodeId, labelObj) {
        var label = labelObj || findLabelForNode(nodeId);
        if (!label) return;
        forcedNames.set(nodeId, {
            label: label,
            startMs: (typeof performance !== 'undefined' ? performance.now() : Date.now())
        });
        label.visible = true;
        if (label.element) {
            label.element.style.display = 'block';
            label.element.style.opacity = '0';
        }
    }

    var _labelSizeCache = null;
    var _lastVisibleCount = 0;
    var _lastCamPos = new THREE.Vector3(1e9, 1e9, 1e9);
    var _lastCamQ = new THREE.Quaternion();
    var _lastLabelUpdate = 0;
    var _lastNodeScaleUpdate = 0;

    function _measureLabelSizes(allLabels) {
        allLabels.forEach(function (o) { o.visible = true; });
        try { labelRenderer.render(scene, camera); } catch (e) { }
        _labelSizeCache = {};
        allLabels.forEach(function (o) {
            var el = o.element, w = el.offsetWidth || 0, h = el.offsetHeight || 0;
            if (!w || !h) {
                var r = el.getBoundingClientRect();
                w = Math.round(r.width) || 0;
                h = Math.round(r.height) || 0;
            }
            if (!w) w = 120;
            if (!h) h = 20;
            _labelSizeCache[o.userData.nodeId] = { w: w, h: h };
        });
    }

    updateLabelVisibility = function () {
        var allLabels = [];
        scene.traverse(function (obj) {
            if (obj instanceof THREE.CSS2DObject && obj.userData.nodeId) allLabels.push(obj);
        });
        if (!allLabels.length) return;
        if (!_labelSizeCache) _measureLabelSizes(allLabels);

        var W = (renderer.domElement && renderer.domElement.clientWidth) || window.innerWidth;
        var H = (renderer.domElement && renderer.domElement.clientHeight) || (window.innerHeight - 60);
        var v = new THREE.Vector3();
        var candidates = [];

        allLabels.forEach(function (obj) {
            // 节点尚未显现（时间裁剪外/漫游未到）：标签不参与常规剔除
            var candMesh = nodeObjects[obj.userData.nodeId];
            if (candMesh && !candMesh.visible) return;
            obj.getWorldPosition(v);
            var dist = camera.position.distanceTo(v);
            var p = v.clone().project(camera);
            if (p.z < -1 || p.z > 1) return; // 相机背后/超出裁剪
            var size = _labelSizeCache[obj.userData.nodeId] || { w: 120, h: 20 };
            var x = (p.x * 0.5 + 0.5) * W + LABEL_DX;
            var y = (-p.y * 0.5 + 0.5) * H + LABEL_DY;
            if (x < -size.w || x > W + size.w || y < -size.h || y > H + size.h) return; // 屏幕外
            candidates.push({
                obj: obj,
                dist: dist,
                importance: obj.userData.importance || 0,
                rect: { left: x - size.w / 2, top: y - size.h / 2, right: x + size.w / 2, bottom: y + size.h / 2 }
            });
        });

        // 重要性优先、同重要性看距离（离相机近的优先）
        // 按距离取最近 N 个（label budget），再在其中按重要性+防重叠剔除
        candidates.sort(function (a, b) { return a.dist - b.dist; });
        var budget = candidates.slice(0, MAX_VISIBLE_LABELS);
        budget.sort(function (a, b) {
            if (b.importance !== a.importance) return b.importance - a.importance;
            return a.dist - b.dist;
        });
        candidates = budget;

        allLabels.forEach(function (o) { o.visible = false; });

        // ===== 强制优先：名字窗口内的标签无条件显示（不参与同屏名称数量预算）=====
        // 规则：① 窗口内无条件显示；② 同屏超 MAX_FORCED_NAMES 时挤掉最旧的、保留最新的；
        //       ③ 碰撞只用来隐藏“确实重叠的次要名”（出现超 FORCED_GRACE_MS 的），刚出现的一律保留。
        var nowMs = performance.now();
        var forcedList = [];
        forcedNames.forEach(function (fo, fid) {
            var age = nowMs - fo.startMs;
            if (age < 0 || age > NAME_LIFE * 1000) { forcedNames.delete(fid); return; }
            if (!fo.label) return;
            // 节点已被时间裁剪/退出漫游而隐藏时，标签一并收起（窗口不残留）
            var fnode = nodeObjects[fid];
            if (!fnode || !fnode.visible) { forcedNames.delete(fid); return; }
            fo.label.getWorldPosition(v);
            var fp = v.clone().project(camera);
            if (fp.z < -1 || fp.z > 1) return;   // 相机背后：本帧不显示，窗口继续计时
            var fsize = _labelSizeCache[fid] || { w: 120, h: 20 };
            var fx = (fp.x * 0.5 + 0.5) * W + LABEL_DX;
            var fy = (-fp.y * 0.5 + 0.5) * H + LABEL_DY;
            forcedList.push({
                label: fo.label,
                age: age,
                rect: {
                    left: fx - fsize.w / 2, top: fy - fsize.h / 2,
                    right: fx + fsize.w / 2, bottom: fy + fsize.h / 2
                }
            });
        });
        // 最新的排前面：截断时挤掉最旧的，绝不会把刚出现的新节点挤掉
        forcedList.sort(function (a, b) { return a.age - b.age; });
        if (forcedList.length > MAX_FORCED_NAMES) forcedList = forcedList.slice(0, MAX_FORCED_NAMES);

        var placed = [];
        for (var fi = 0; fi < forcedList.length; fi++) {
            var fc = forcedList[fi];
            var fclash = false;
            for (var fj = 0; fj < placed.length; fj++) {
                if (rectsOverlap(fc.rect, placed[fj], LABEL_MARGIN)) { fclash = true; break; }
            }
            if (fclash && fc.age > FORCED_GRACE_MS) continue;   // 只挤掉重叠的较旧次名
            placed.push(fc.rect);
            fc.label.visible = true;
            if (fc.label.element) {
                var fopa = Math.min(1, fc.age / (NAME_FADE_IN * 1000), (NAME_LIFE * 1000 - fc.age) / (NAME_FADE_OUT * 1000));
                fc.label.element.style.display = 'block';
                fc.label.element.style.opacity = Math.max(0, Math.min(1, fopa)).toFixed(3);
            }
        }

        // ===== 常规标签：让开强制名，再按“同屏预算 + 重要性 + 防重叠”放置 =====
        for (var i = 0; i < candidates.length; i++) {
            var c = candidates[i], hit = false;
            for (var j = 0; j < placed.length; j++) {
                if (rectsOverlap(c.rect, placed[j], LABEL_MARGIN)) { hit = true; break; }
            }
            if (hit) continue;
            c.obj.visible = true;
            if (c.obj.element) c.obj.element.style.opacity = '1'; // 清掉名字窗口淡出后残留的 opacity
            placed.push(c.rect);
        }

        _lastVisibleCount = placed.length;

        // （旧的“漫游显现名字优先显示”分支已废弃：统一由上面“强制优先”块处理，
        //   漫游与播放模式共用同一套窗口/上限/碰撞规则）
    };

    // ========== 导出 API ==========
    // 调试钩子（供上游自动化验收读取场景对象；惰性 getter，不产生副作用）
    window.__EVO_DEBUG = {
        get scene() { return scene; },
        get camera() { return camera; },
        get renderer() { return renderer; },
        get controls() { return controls; },
        get nodeObjects() { return nodeObjects; },
        // 节点批渲染对象（5 个 InstancedMesh）与各桶实例数，供验收统计 draw call
        get nodeMeshes() { return nodeBatch ? nodeBatch.meshes : []; },
        get nodeBucketCounts() { return nodeBatch ? nodeBatch.items.map(b => b.length) : []; },
        get edgeObjects() { return (edgeRecords && edgeRecords.length) ? edgeRecords : edgeObjects; },
        get networkEdgeObjects() { return networkEdgeObjects; },
        // 合并后的实际渲染对象（各 1 个，供验收统计 draw call / 顶点数）
        get edgeLine() { return edgeLine; },
        get edgeArrow() { return edgeArrow; },
        get networkLine() { return networkLine; },
        get layout() { return layout; }
    };

    window.EVO3D = {
        ready: false,
        highlightNode: highlightNode,
        clearHighlight: clearHighlight,
        setTimeCutoff: setTimeCutoff,
        clearTimeCutoff: clearTimeCutoff,
        focusNode: focusNode,
        setPresetView: setPresetView,
        autoRotate: autoRotate,
        setTimeMode: setTimeMode,
        setTimeFollow: function(enabled) {
            timeFollowEnabled = enabled;
            if (!enabled) {
                timeFollowTarget = null;
            }
        },
        pickAt: pickAt,
        stats: stats,
        labelStats: labelStats,
        _forceUpdateLabels: updateLabelVisibility,
        startTour: startTour,
        stopTour: stopTour,
        get tourActive() { return tourMode; },
        get tourTime() { return tourTime; },
        // 漫游当前所在的轨道 Y（HUD 用它反查地质年代，不用播放的 ma）
        get tourTrackY() { return (tourMode && tourPlan) ? tourTrackY(tourTime) : null; },
        revealAtOf: function(nodeId) {
            return tourPlan ? tourPlan.revealAt[nodeId] : Infinity;
        },
        setLabelBudget: function(n) {
            MAX_VISIBLE_LABELS = Math.max(0, Math.min(45, n));
            updateLabelVisibility();
        },
        // 漫游镜头旋转开关（默认 false = 不旋转）
        setTourRoll: function(on) {
            tourRollOn = !!on;
        },
        get tourRoll() { return tourRollOn; }
    };

    // ========== 启动 ==========
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }

})();
