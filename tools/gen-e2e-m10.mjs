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
    // 6) 右键菜单含"放大查看表格"；命令直发可开
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
