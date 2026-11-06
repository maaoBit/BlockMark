// 生成 M11 轮 e2e：mermaid 放大查看器（按钮/右键/双击进入、滚轮缩放、拖拽平移、
// Esc/空白关、手势路由 viewer→editor）+ 字号 ui.prefs 链路（正文/标题/CM calc 联动、钳制）
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let html = readFileSync(join(root, "EditorResources", "index.bundle.html"), "utf8");
const test = `
<script>
window.addEventListener("DOMContentLoaded", async () => {
  const r = {};
  const sleep = ms => new Promise(ok => setTimeout(ok, ms));
  const waitFor = async (fn, ms) => {
    const t0 = Date.now();
    while (!fn()) { if (Date.now() - t0 > ms) return false; await sleep(40); }
    return true;
  };
  window.addEventListener("error", e => { r.jsErr = (r.jsErr || "") + e.message + ";"; });
  try {
    // 手势路由捕获（浏览器环境 Bridge.call 是 no-op，包装捕获 ui.gestureRoute 序列）
    const origCall = Bridge.call.bind(Bridge);
    const routes = [];
    Bridge.call = (n, d) => { if (n === "ui.gestureRoute") routes.push(d.route); else origCall(n, d); };

    const BT = String.fromCharCode(96);
    const MMD = BT.repeat(3) + "mermaid\\ngraph LR\\n  A[开始] --> B[处理] --> C[汇总] --> D[结束]\\n" + BT.repeat(3) + "\\n";
    Editor.open(MMD);
    r.mmdRendered = await waitFor(() => !!document.querySelector(".bm-mermaid svg"), 3000);
    const wrapEl = document.querySelector(".bm-mermaid");
    const cid = wrapEl.closest(".bm-block").dataset.cid;

    // 1) inline max-width 剥除（宽图不再被压扁）+ 自然尺寸钉死（防 width="100%" 被 parseFloat 误读）+ hover 按钮挂载 + 导出不含按钮
    const inSvg = wrapEl.querySelector("svg");
    r.noInlineMaxWidth = inSvg.style.maxWidth === "none";
    const ivb = (inSvg.getAttribute("viewBox") || "").trim().split(/[\\s,]+/).map(Number);
    r.indocNaturalW = !(inSvg.getAttribute("width") || "").endsWith("%") &&
                      Math.abs(parseFloat(inSvg.getAttribute("width")) - ivb[2]) <= 1;
    r.btnExists = !!wrapEl.querySelector(".bm-mermaid-zoom-btn");
    r.exportClean = !Editor.getExportHtml().includes("bm-mermaid-zoom-btn");

    // 2) 按钮进入：查看器开、svg 克隆、百分比文本、手势路由 viewer
    wrapEl.querySelector(".bm-mermaid-zoom-btn").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await sleep(30);
    const ov = document.getElementById("bm-mermaid-zoom");
    const stage = ov && ov.querySelector(".bm-mzoom-stage");
    const canvas = ov && ov.querySelector(".bm-mzoom-canvas");
    const pct = ov && ov.querySelector(".bm-mzoom-pct");
    r.zoomOpen = !!ov && ov.classList.contains("show");
    // computed display 必须真变（曾因 CSS 里误写 // 注释吞掉 display:none，"关闭"后浮层仍可见——
    // class 断言测不出，观感断言必须走 getComputedStyle）
    r.zoomDisplayFlex = !!ov && getComputedStyle(ov).display === "flex";
    r.stageFlexFull = !!stage && stage.clientHeight > 400;   // display:flex+flex:1 生效（display 塌了 stage 只剩 svg 高）
    r.zoomSvg = !!(canvas && canvas.querySelector("svg"));
    r.cloneNaturalW = !!canvas && (() => {
      const cs = canvas.querySelector("svg");
      const cvb = (cs.getAttribute("viewBox") || "").trim().split(/[\\s,]+/).map(Number);
      return Math.abs(parseFloat(cs.getAttribute("width")) - cvb[2]) <= 1;
    })();
    r.pctText = !!pct && /^\\d+%$/.test(pct.textContent);
    r.routeViewer = routes[routes.length - 1] === "viewer";

    // 3) 滚轮缩放（deltaY<0 放大）：百分比上升
    const p0 = parseInt(pct.textContent, 10);
    stage.dispatchEvent(new WheelEvent("wheel", { deltaY: -120, clientX: 200, clientY: 200, bubbles: true, cancelable: true }));
    const p1 = parseInt(pct.textContent, 10);
    r.wheelZoomIn = p1 > p0;

    // 4) 拖拽平移：translate 变化且不误关
    const t0 = canvas.style.transform;
    stage.dispatchEvent(new PointerEvent("pointerdown", { clientX: 300, clientY: 300, pointerId: 31, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 340, clientY: 320, pointerId: 31, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 340, pointerId: 31, bubbles: true }));
    await sleep(20);
    r.panMoved = canvas.style.transform !== t0 && canvas.style.transform.includes("translate");

    // 5) 工具条：＋ 放大；100% 复位为自然尺寸
    ov.querySelector(".bm-mzoom-in").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    r.btnZoomIn = parseInt(pct.textContent, 10) > p1;
    ov.querySelector(".bm-mzoom-full").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    r.btnFull = pct.textContent === "100%";

    // 6) Esc 关 + 关后真隐藏（computed display=none）+ 手势路由归还 editor
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(20);
    r.escClose = !ov.classList.contains("show");
    r.escDisplayNone = getComputedStyle(ov).display === "none";
    r.routeBack = routes[0] === "viewer" && routes[routes.length - 1] === "editor";

    // 7) 原生手势直推通道（WKWebView 不合成 gesturechange，捏合/滚轮由原生转译成桥命令）
    Editor._openMermaidZoom(cid);
    await sleep(20);
    const ovz = document.getElementById("bm-mermaid-zoom");
    const pctz = ovz.querySelector(".bm-mzoom-pct");
    const pz0 = parseInt(pctz.textContent, 10);
    Bridge.dispatch("viewer.zoom", { k: 1.25, x: 400, y: 300 });
    r.nativeZoomIn = parseInt(pctz.textContent, 10) > pz0;
    Bridge.dispatch("viewer.zoom", { k: 0.001, x: 400, y: 300 });
    r.nativeZoomClamp = pctz.textContent !== "0%";   // MZ_MIN=15% 钳制生效
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(20);

    // 8) 空白处原地点击关（拖动 >3px 不关）
    Editor._openMermaidZoom(cid);
    await sleep(20);
    const ov2 = document.getElementById("bm-mermaid-zoom");
    ov2.querySelector(".bm-mzoom-stage").dispatchEvent(new PointerEvent("pointerdown", { clientX: 10, clientY: 300, pointerId: 32, bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 10, clientY: 300, pointerId: 32, bubbles: true }));
    await sleep(20);
    r.backdropClose = !ov2.classList.contains("show") && getComputedStyle(ov2).display === "none";

    // 8) 右键菜单含"放大查看图表"；命令直发可开
    let cap = null;
    const orig2 = Bridge.call;
    Bridge.call = (n, d) => { if (n === "menu.showContext") cap = d; };
    document.querySelector(".bm-mermaid svg").dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    Bridge.call = orig2;
    r.menuItem = !!(cap && (cap.items || []).some(i => i.cmd === "mermaid.preview"));
    Bridge.dispatch("menu.onCommand", { cmd: "mermaid.preview", cid });
    await sleep(20);
    r.cmdOpen = document.getElementById("bm-mermaid-zoom").classList.contains("show") &&
                getComputedStyle(document.getElementById("bm-mermaid-zoom")).display === "flex";
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(20);

    // 9) 双击图 = 开查看器（不滑进源码编辑）
    const wrap3 = document.querySelector(".bm-mermaid");
    wrap3.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
    wrap3.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 2 }));
    await sleep(20);
    r.dblclickOpen = document.getElementById("bm-mermaid-zoom").classList.contains("show") &&
                     getComputedStyle(document.getElementById("bm-mermaid-zoom")).display === "flex";
    r.dblclickNoEdit = !Editor._editingState().hasCm;
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(20);

    // 10) 单击图 = 280ms 后进源码编辑（原行为保留）
    const wrap4 = document.querySelector(".bm-mermaid");
    wrap4.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
    await sleep(450);
    r.singleClickEdits = Editor._editingState().hasCm;   // 留着 CM：下组断言用其 calc 字号

    // 11) 字号 ui.prefs：正文/标题联动、CM calc 跟随、钳制
    Editor._applyPrefs({ fontSize: 20 });
    const wr = document.querySelector(".write");
    r.write20 = getComputedStyle(wr).fontSize === "20px";
    const h1 = document.createElement("h1");
    h1.textContent = "x";
    wr.appendChild(h1);
    r.h1Scales = parseFloat(getComputedStyle(h1).fontSize) >= 33;   // h1=1.7em×20=34
    h1.remove();
    const cmEl = document.querySelector(".bm-cm-host .CodeMirror");
    r.cmCalc = !!cmEl && Math.abs(parseFloat(getComputedStyle(cmEl).fontSize) - 16.25) < 0.6;   // 20×0.8125
    Editor._applyPrefs({ fontSize: 3 });
    r.clampLow = getComputedStyle(wr).fontSize === "10px";
    Editor._applyPrefs({ fontSize: 99 });
    r.clampHigh = getComputedStyle(wr).fontSize === "32px";
    Editor._applyPrefs({ fontSize: 16 });
    r.writeReset = getComputedStyle(wr).fontSize === "16px";

    // 12) 换文档：查看器 computed none + route 归还；单击图的 280ms 计时被换文档清掉
    Editor.open(MMD);
    r.mmd2 = await waitFor(() => !!document.querySelector(".bm-mermaid svg"), 3000);
    const cid2 = document.querySelector(".bm-mermaid").closest(".bm-block").dataset.cid;
    Editor._openMermaidZoom(cid2);
    await sleep(20);
    Editor.open("# 新文档\\n\\n段落\\n");
    await sleep(20);
    r.docSwitchCloses = getComputedStyle(document.getElementById("bm-mermaid-zoom")).display === "none";
    r.docSwitchRoute = routes[routes.length - 1] === "editor";
    Editor.open(MMD);
    r.mmd3 = await waitFor(() => !!document.querySelector(".bm-mermaid svg"), 3000);
    document.querySelector(".bm-mermaid").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
    Editor.open("# 又一篇\\n");
    await sleep(450);
    r.timerNoLeak = !Editor._editingState().hasCm;   // 旧文档的延时进编辑不得落进新文档

    // 13) 延时窗内改点他处进编辑：焦点不得被劫进图表源码 CM（评审轮修复回归）
    Editor.open(MMD + "目标段落\\n");
    r.mmd4 = await waitFor(() => !!document.querySelector(".bm-mermaid svg"), 3000);
    document.querySelector(".bm-mermaid").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
    document.querySelector('[data-type="paragraph"]').dispatchEvent(new MouseEvent("mousedown", { bubbles: true, detail: 1 }));
    await sleep(450);
    const es = Editor._editingState();
    r.hijackFixed = !es.hasCm && !!es.editingCid;   // 停在段落编辑，图表 CM 未弹出

    // 14) viewer.zoom 锚点不变性：缩放前后内容点 (ax-tx)/s 不变（锚点/坐标数学错了此处现形）
    Editor.open(MMD);
    r.mmd5 = await waitFor(() => !!document.querySelector(".bm-mermaid svg"), 3000);
    const cid5 = document.querySelector(".bm-mermaid").closest(".bm-block").dataset.cid;
    Editor._openMermaidZoom(cid5);
    await sleep(30);
    const parseTf = el => {
      const m = /translate\\(([-\\d.]+)px, ([-\\d.]+)px\\) scale\\(([\\d.]+)\\)/.exec(el.style.transform) || [];
      return m.length ? { tx: +m[1], s: +m[3] } : null;
    };
    const cv5 = document.querySelector(".bm-mzoom-canvas");
    const ax = 300;
    const ta = parseTf(cv5);
    Bridge.dispatch("viewer.zoom", { k: 1.3, x: ax, y: 200 });
    const tb = parseTf(cv5);
    r.anchorStable = !!(ta && tb && Math.abs((ax - ta.tx) / ta.s - (ax - tb.tx) / tb.s) < 0.6);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(20);

    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = JSON.stringify(r);
    document.body.appendChild(pre);
    const ok = Object.values(r).every(Boolean);
    document.title = ok ? "M11-E2E PASS" : "M11-E2E FAIL";
  } catch (e) {
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = "ERROR: " + e.message + "|" + (e.stack||"").split("\\n")[1];
    document.body.appendChild(pre);
    document.title = "M11-E2E ERROR";
  }
});
</script>
`;
html = html.replace("</body>", () => test + "\n</body>");
writeFileSync(join(root, "EditorResources", "e2e-m11.html"), html);
console.log("generated");
