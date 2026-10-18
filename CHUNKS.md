# 分块施工说明（CHUNKS）— 生物演化 3D 网状图谱

> 背景：一次性生成大文件会导致模型请求超时。**必须分块、每次只交付一小部分**。
> 每次开工前先读本文件 + `SPEC.md` 里对应章节。**不要在 G:\生物演化\ 或 G:\生物演化-gpt\ 里写文件。**

## 公共约定

- 项目目录：`G:\生物演化-3d\`
- 依赖已在 `vendor/`：`three.min.js`(r128 UMD)、`OrbitControls.js`、`CSS2DRenderer.js`。禁止 CDN / npm / import 语法。
- 数据格式（`js/data*.js`，用全局变量，不要 fetch）：

```js
// js/data.js —— 只定义结构与元数据 + 第 1 块节点
(function () {
  var D = (window.EVO_DATA = window.EVO_DATA || { nodes: [], edges: [], meta: {} });
  D.meta = { timeTopMa: 4200, sources: ["……"] };
  // 统一构造器
  window.N = function (id, zh, latin, ma, maEnd, clade, group, rank, extinct, emoji, blurb, key, evidence, note) {
    return { id: id, zh: zh, latin: latin, ma: ma, maEnd: maEnd, clade: clade, group: group,
             rank: rank, extinct: !!extinct, emoji: emoji, blurb: blurb || "", key: key || [],
             evidence: evidence || "textbook", note: note || "" };
  };
  window.E = function (from, to, type, label) { return { from: from, to: to, type: type || "descent", label: label || "" }; };
  D.nodes.push(
    N("luca", "LUCA", "—", 4200, 3800, "生命起源", "共同祖先", "clade", false, "🦠", "所有现存生命的最近共同祖先，已是完整细胞。", ["DNA/RNA/蛋白质", "代谢网络"], "debated", "出现时间估计 35–42 亿年前"),
    /* 更多节点…… */
  );
  D.edges.push(E("luca", "bacteria", "descent"));
})();
```

- **节点每行一个**，字段紧凑，`blurb` ≤ 40 字，`key` 2–3 条短语。
- 每个节点必须有 **中文名 + 拉丁学名**（`latin`，类群节点写正式类群名；无学名的用 `—`）。
- 时间 `ma` 单位=百万年前，数字；`maEnd` 为灭绝时间（现存写 0）。不确定就写近似值并把 `evidence` 设 `estimate`/`debated`，`note` 里说明。
- 边方向：`from` → `to` 表示 **from 是祖先、to 是后代**（箭头必须指向 to）。
- 横向网状边类型：`endosymbiosis` / `hgt` / `hybrid` / `ring` / `symbiosis`。
- **禁止编造**具体数字与基因名；不确定的必须标 `estimate`/`debated`。
- 每次回复末尾只写 3 行以内状态（写完了哪个文件、节点数、边数），不要长篇总结。

## 块清单

| 块 | 交付物 | 内容 | 状态 |
|---|---|---|---|
| 1 | `js/data.js` | 结构 + 元数据 + 第 1 块节点（生命起源/原核/古菌/真核与原生生物，约 40 个）+ 它们之间的谱系边 | 待做 |
| 2 | `js/data2.js` | 第 2 块节点（真菌/植物/无脊椎动物，约 40 个）+ 与已有节点的连接边 | 待做 |
| 3 | `js/data3.js` | 第 3 块节点（脊索动物/鱼类/两栖/爬行/恐龙/鸟，约 40 个）+ 连接边 | 待做 |
| 4 | `js/data4.js` | 第 4 块节点（哺乳动物/灵长类/人科/灭绝明星物种，约 40 个）+ 连接边 | 待做 |
| 5 | `js/data5.js` | 全部**横向网状边**（内共生/水平基因转移/杂交渗入/环物种/共生，≥14 条）+ 少量补充节点 | 待做 |
| 6 | `js/layout.js` + `index.html` + `css/style.css` | 时间轴映射（分段非线性 + 等距开关）、大类扇区布局、页面骨架、样式与图例 | 待做 |
| 7 | `js/app.js` | Three.js 场景：球体节点、带箭头的谱系边、虚线网状边、CSS2D 标签、OrbitControls、地质年代参考面 | 待做 |
| 8 | `js/ui.js` | 交互：点击高亮祖先链+后代、信息面板、搜索定位、大类筛选、时间游标/播放、悬停 tooltip、预设视角 | 待做 |
| 9 | `tools/serve.py` + `tools/e2e_test.js` + `README.md` | 本地服务、Puppeteer 自检（无报错/画布非空/高亮生效/搜索定位）+ 截图 4 张 | 待做 |
