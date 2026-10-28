// 生成 M10 轮 e2e：表格放大视图——hover 按钮存在/点击开大视图/只读/Esc/背景关/右键菜单项/最新内容
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
  const block = cid => document.querySelector('[data-cid="' + cid + '"]');
  window.addEventListener("error", e => { r.jsErr = (r.jsErr || "") + e.message + ";"; });
  try {
    Editor.open("| 姓名 | 年龄 | 部门 | 备注 |\\n|---|---|---|---|\\n| 张三 | 30 | 研发 | 长备注文字测试列宽 |\\n| 李四 | 28 | 产品 | - |\\n");
    const cid = document.querySelector('[data-type="table"]').dataset.cid;
    // 1) 渲染后自动挂放大按钮（导出不含）
    r.btnExists = !!block(cid).querySelector(".bm-table-zoom-btn");
    r.exportClean = !Editor.getExportHtml().includes("bm-table-zoom-btn");
    // 2) 点按钮 → 大视图开、内容完整、只读
    block(cid).querySelector(".bm-table-zoom-btn").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await sleep(30);
    const ov = document.getElementById("bm-table-zoom");
    r.zoomOpen = !!ov && ov.classList.contains("show");
    r.zoomCells = ov && ov.querySelectorAll("td,th").length === 12;   // 4列×(1头+2体)
    r.zoomReadOnly = ov && [...ov.querySelectorAll("td,th")].every(c => !c.isContentEditable);
    r.zoomSticky = ov && !!ov.querySelector("th");
    // 3) 单元格编辑未提交时开大视图 → 显示最新已提交内容（编辑先落盘）
    r.zoomHasData = ov && ov.textContent.includes("张三");
    // 4) Esc 关（捕获层拦截，不误触块编辑）
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(20);
    r.escClose = !ov.classList.contains("show");
    // 5) 背景点击关
    block(cid).querySelector(".bm-table-zoom-btn").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await sleep(20);
    document.getElementById("bm-table-zoom").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await sleep(20);
    r.backdropClose = !document.getElementById("bm-table-zoom").classList.contains("show");
    // 6) 宽表自适配：长文本单元格折行，无横向溢出（大视图目标=一页看完）
    Editor.open("| 列一 | 列二 |\\n|---|---|\\n| 这是一段非常长的单元格文本用来验证放大视图里会自动折行而不是横向撑开表格导致需要左右滑动查看 " +
      "https://example.com/a/very/long/path/that/should/wrap/inside/the/cell/without/horizontal/scroll | 短 |\\n");
    const wcid = document.querySelector('[data-type="table"]').dataset.cid;
    block(wcid).querySelector(".bm-table-zoom-btn").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await sleep(30);
    const ov2 = document.getElementById("bm-table-zoom");
    const sc = ov2.querySelector(".bm-table-zoom-scroll");
    r.fitNoHScroll = sc.scrollWidth <= sc.clientWidth + 1;
    const longTd = [...ov2.querySelectorAll("td")].find(c => c.textContent.includes("非常长"));
    r.longTextWrapped = !!longTd && longTd.clientHeight > 24;   // 多行（行高~24px，折行后更高）
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(20);

    // 7) 列宽拖拽：多步 move 流（复现"手柄移出光标下丢事件"故障面）、像素直写、
    //    pair 守恒、二次拖拽可用、双击重置
    Editor.open("| 短列 | 长文本列 |\\n|---|---|\\n| a | 这列文字比较长用来占位 |\\n");
    const rcid = document.querySelector('[data-type="table"]').dataset.cid;
    block(rcid).querySelector(".bm-table-zoom-btn").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await sleep(30);
    const ov3 = document.getElementById("bm-table-zoom");
    const sc3 = ov3.querySelector(".bm-table-zoom-scroll");
    const tbl3 = sc3.querySelector("table");
    const ths3 = [...tbl3.querySelectorAll("thead th")];
    const handle = ths3[0].querySelector(".bm-zoom-colhandle");
    r.handleExists = !!handle;
    if (handle) {
      const w0 = tbl3.offsetWidth;
      const th0 = ths3.map(t => t.offsetWidth);
      const x0 = ths3[0].getBoundingClientRect().right;
      const dragBy = dx => {
        handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: x0, pointerId: 7, bubbles: true }));
        for (const step of [10, 25, 40, 60]) {
          window.dispatchEvent(new PointerEvent("pointermove", { clientX: x0 + step, pointerId: 7, bubbles: true }));
        }
        window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 7, bubbles: true }));
      };
      dragBy(0);
      await sleep(20);
      const th1 = ths3.map(t => t.offsetWidth);
      r.dragPxWidths = ths3.every(t => t.style.width.endsWith("px"));
      r.dragConserved = Math.abs(th1[0] + th1[1] - (th0[0] + th0[1])) <= 1;
      r.dragFirstGrew = th1[0] > th0[0] + 30;
      r.dragNoHScroll = sc3.scrollWidth <= sc3.clientWidth + 1 && Math.abs(tbl3.offsetWidth - w0) <= 1;
      // 二次拖拽（回归：旧版监听残留导致失效）——往回拖
      const x1 = ths3[0].getBoundingClientRect().right;
      handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: x1, pointerId: 8, bubbles: true }));
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: x1 - 80, pointerId: 8, bubbles: true }));
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 8, bubbles: true }));
      await sleep(20);
      const th2 = ths3.map(t => t.offsetWidth);
      r.secondDragWorks = th2[0] < th1[0] - 30 && Math.abs(th2[0] + th2[1] - (th0[0] + th0[1])) <= 1;
      // 拖拽中文本跟随重排：move 后（未 up 前）列宽即时生效
      handle.dispatchEvent(new PointerEvent("pointerdown", { clientX: ths3[0].getBoundingClientRect().right, pointerId: 9, bubbles: true }));
      window.dispatchEvent(new PointerEvent("pointermove", { clientX: ths3[0].getBoundingClientRect().right + 50, pointerId: 9, bubbles: true }));
      const midDrag = ths3[0].offsetWidth;
      window.dispatchEvent(new PointerEvent("pointerup", { pointerId: 9, bubbles: true }));
      r.liveReflow = midDrag > th2[0] + 20;
      // 双击重置回 auto
      handle.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
      await sleep(20);
      r.dblclickReset = ths3.every(t => t.style.width === "") && tbl3.style.tableLayout === "";
    }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(20);

    // 8) 右键菜单含"放大查看表格"；命令直发可开
    const orig = Bridge.call.bind(Bridge);
    let cap = null;
    Bridge.call = (n, d) => { if (n === "menu.showContext") cap = d; else orig(n, d); };
    document.querySelector('[data-r="1"][data-c="0"]').dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    Bridge.call = orig;
    r.menuItem = !!(cap && (cap.items || []).some(i => i.cmd === "table.preview"));
    Bridge.dispatch("menu.onCommand", { cmd: "table.preview", cid });
    await sleep(20);
    r.cmdOpen = document.getElementById("bm-table-zoom").classList.contains("show");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(20);

    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = JSON.stringify(r);
    document.body.appendChild(pre);
    const ok = Object.values(r).every(Boolean);
    document.title = ok ? "M10-E2E PASS" : "M10-E2E FAIL";
  } catch (e) {
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = "ERROR: " + e.message + "|" + (e.stack||"").split("\\n")[1];
    document.body.appendChild(pre);
    document.title = "M10-E2E ERROR";
  }
});
</script>
`;
html = html.replace("</body>", () => test + "\n</body>");
writeFileSync(join(root, "EditorResources", "e2e-m10.html"), html);
console.log("generated");
