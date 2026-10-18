// 端到端自检：起本地服务 → 无头浏览器打开 → 断言关键功能 → 截图
// 依赖：puppeteer（已装在 OpenClaw 的 browser-automation-puppeteer skill 目录）
// 运行：
//   $env:NODE_PATH="C:/Users/haoma/.openclaw/workspace/skills/browser-automation-puppeteer/node_modules"
//   node tools/e2e_test.js
const http = require("http");
const fs = require("fs");
const path = require("path");
const puppeteer = require(process.env.PUPPETEER_PATH || "C:/Users/haoma/.openclaw/workspace/skills/browser-automation-puppeteer/node_modules/puppeteer");

const ROOT = path.dirname(__dirname);
const PORT = Number(process.env.PORT || 8788);
const MIME = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml" };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/") p = "/index.html";
  fs.readFile(path.join(ROOT, p), (err, data) => {
    if (err) { res.writeHead(404); res.end("404"); return; }
    res.writeHead(200, { "Content-Type": MIME[path.extname(p).toLowerCase()] || "application/octet-stream" });
    res.end(data);
  });
});

const results = [];
function check(name, ok, extra) {
  results.push({ name, ok: !!ok, extra: extra === undefined ? "" : extra });
  console.log((ok ? "PASS  " : "FAIL  ") + name + (extra !== undefined ? "  " + JSON.stringify(extra) : ""));
}

(async () => {
  await new Promise((r) => server.listen(PORT, "127.0.0.1", r));
  const browser = await puppeteer.launch({ headless: "new", args: ["--no-sandbox", "--enable-unsafe-swiftshader"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 900 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e.message).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });

  await page.goto("http://127.0.0.1:" + PORT + "/index.html", { waitUntil: "load", timeout: 30000 });

  let ready = true;
  try { await page.waitForFunction("window.EVO3D && window.EVO3D.ready === true", { timeout: 40000 }); }
  catch (e) { ready = false; }
  check("页面初始化 EVO3D.ready", ready);

  const stats = await page.evaluate(() => (window.EVO3D && window.EVO3D.stats ? window.EVO3D.stats() : null));
  check("节点数 = 219", stats && stats.nodes === 219, stats);
  check("谱系边 = 200", stats && stats.edges === 200, stats && stats.edges);
  check("网状边 = 33", stats && stats.networkEdges === 33, stats && stats.networkEdges);

  const lab = await page.evaluate(() => (window.EVO3D.labelStats ? window.EVO3D.labelStats() : null));
  check("标签不重叠（overlaps = 0）", lab && lab.overlaps === 0, lab && lab.overlaps);
  check("标签数量受控（<=45）", lab && lab.visible <= 45, lab && lab.visible);

  // 交互：搜索 智人 → 点第一条 → 面板
  await page.click("#search-input");
  await page.type("#search-input", "智人", { delay: 50 });
  await new Promise((r) => setTimeout(r, 800));
  await page.evaluate(() => { const el = document.getElementById("search-results"); const f = el && el.querySelector("li,div,button,a"); if (f) f.click(); });
  await new Promise((r) => setTimeout(r, 1200));
  const panel = await page.evaluate(() => (document.getElementById("node-info") || {}).innerText || "");
  check("搜索并定位智人（面板含学名）", /Homo\s*sapiens/.test(panel), panel.slice(0, 60));

  // 高亮祖先链
  const hl = await page.evaluate(() => { window.EVO3D.highlightNode("homo_sapiens"); return window.EVO3D.stats ? window.EVO3D.stats().nodes : 0; });
  check("高亮祖先链调用成功", hl > 0);

  // 时间滑杆
  const t = await page.evaluate(async () => {
    const s = document.getElementById("time-slider");
    if (!s) return null;
    s.value = "541"; s.dispatchEvent(new Event("input", { bubbles: true }));
    await new Promise((r) => setTimeout(r, 500));
    return (document.getElementById("time-display") || {}).innerText || "";
  });
  check("时间滑杆联动（显示年代）", t && /百万年前/.test(t), t);

  // 截图
  const shotDir = path.join(ROOT, "tools", "shots");
  fs.mkdirSync(shotDir, { recursive: true });
  const views = ["initial", "iso", "side", "top"];
  for (const v of views) {
    if (v !== "initial") await page.evaluate((vv) => window.EVO3D.setPresetView && window.EVO3D.setPresetView(vv), v);
    await new Promise((r) => setTimeout(r, 1500));
    await page.screenshot({ path: path.join(shotDir, v + ".png") });
  }
  check("截图输出 4 张", fs.readdirSync(shotDir).filter((f) => /\.png$/.test(f)).length >= 4);

  const fatal = errors.filter((e) => !/404/.test(e)); // 允许 favicon 之类 404
  check("无致命脚本错误", fatal.length === 0, fatal.slice(0, 3));

  await browser.close();
  server.close();
  const failed = results.filter((r) => !r.ok);
  console.log("\n== 汇总: " + (results.length - failed.length) + "/" + results.length + " 通过 ==");
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error("自检异常:", e); process.exit(2); });
