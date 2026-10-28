// 生成 M9 轮 e2e：P2 清尾——非编辑态加粗包裹选区 / CM 无变更不污染 undo / 空列表项合块剥前缀
// / Delete 前向合块 / 全选退格不走合块 / 转义渲染 / setext 活体
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let html = readFileSync(join(root, "EditorResources", "index.bundle.html"), "utf8");
const FB = "\u0060\u0060\u0060";
const test = `
<script>
window.addEventListener("DOMContentLoaded", async () => {
  const r = {};
  const sleep = ms => new Promise(ok => setTimeout(ok, ms));
  const st = () => Editor._editingState();
  const block = cid => document.querySelector('[data-cid="' + cid + '"]');
  window.addEventListener("error", e => { r.jsErr = (r.jsErr || "") + e.message + ";"; });
  try {
    // ---------- 非编辑态加粗：选区文本唯一定位 → 就地包裹 ----------
    Editor.open("段落含目标词二字尾随\\n");
    const bCid = document.querySelector(".bm-block").dataset.cid;
    // 渲染态选中"目标词"（用 DOM Range 在渲染文本上取）
    const pEl = block(bCid).querySelector("p");
    const walker = document.createTreeWalker(pEl, NodeFilter.SHOW_TEXT);
    const tn = walker.nextNode();
    const rng = document.createRange();
    rng.setStart(tn, 3); rng.setEnd(tn, 6);   // "目标词"
    const sel0 = getSelection(); sel0.removeAllRanges(); sel0.addRange(rng);
    Editor.format("bold");
    await sleep(80);
    r.boldWrap = block(bCid).textContent.includes("**目标词**");
    block(bCid).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(30);
    r.boldCommit = Editor.getMarkdown().includes("**目标词**");

    // 无选区：退化行尾插定界对（旧行为保底）
    Editor.open("另段\\n");
    const b2 = document.querySelector(".bm-block").dataset.cid;
    getSelection().removeAllRanges();
    Editor.format("italic");
    await sleep(80);
    r.italicTail = block(b2).textContent.includes("*") && !block(b2).textContent.includes("**另段**");
    block(b2).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));

    // ---------- CM 无变更 Esc：undo 栈不进同值快照 ----------
    Editor.open("改动基线段\\n\\n${FB}\\ncode\\n${FB}\\n");
    const cids = [...document.querySelectorAll(".bm-block")].map(e => e.dataset.cid);
    Editor._enterEdit(cids[0]);
    document.execCommand("insertText", false, "真实改动");
    await sleep(30);
    block(cids[0]).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(30);
    Editor._enterEdit(cids[1]);   // 进 CM 不改一字
    await sleep(80);
    block(cids[1]).querySelector(".CodeMirror").dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(80);
    Editor.undo();                // 一次 undo 应回滚"真实改动"（若 CM 空转进了栈，这次是空转）
    await sleep(30);
    r.cmNoopUndo = !Editor.getMarkdown().includes("真实改动");

    // ---------- 空列表项块首退格：剥前缀并入 ----------
    Editor.open("前文\\n\\n- ");
    const lCids = [...document.querySelectorAll(".bm-block")].map(e => e.dataset.cid);
    Editor._enterEdit(lCids[1], false);
    block(lCids[1]).dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    await sleep(30);
    r.mergeStripPrefix = Editor.getMarkdown().includes("前文") && !Editor.getMarkdown().includes("- ") &&
                         document.querySelectorAll(".bm-block").length === 1;

    // ---------- Delete 前向合块 ----------
    Editor.open("甲段\\n\\n乙段");
    const dCids = [...document.querySelectorAll(".bm-block")].map(e => e.dataset.cid);
    Editor._enterEdit(dCids[0]);   // 光标在尾
    block(dCids[0]).dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    await sleep(30);
    r.delMerge = st().editingCid === dCids[0] && block(dCids[0]).textContent === "甲段乙段" &&
                 document.querySelectorAll(".bm-block").length === 1;
    // 后块表格 → 首格；后块代码 → CM
    Editor.open("前文\\n\\n| A | B |\\n|---|---|\\n| 1 | 2 |");
    const tCids = [...document.querySelectorAll(".bm-block")].map(e => e.dataset.cid);
    Editor._enterEdit(tCids[0]);
    block(tCids[0]).dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    await sleep(40);
    r.delIntoTable = st().cellEdit && st().cellEdit.r === "0" && st().cellEdit.c === "0";
    Editor._commitCellEdit();
    Editor.open("前文\\n\\n${FB}\\ncode\\n${FB}");
    const cCids = [...document.querySelectorAll(".bm-block")].map(e => e.dataset.cid);
    Editor._enterEdit(cCids[0]);
    block(cCids[0]).dispatchEvent(new KeyboardEvent("keydown", { key: "Delete", bubbles: true }));
    await sleep(60);
    r.delIntoCode = st().hasCm;

    // ---------- 全选 + Backspace：走浏览器删除，不合块 ----------
    Editor.open("独段文字");
    const sCid = document.querySelector(".bm-block").dataset.cid;
    Editor._enterEdit(sCid);
    document.execCommand("selectAll");
    block(sCid).dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    await sleep(30);
    // 合成环境浏览器默认删除不发生——只验证守卫：不合块、内容原样、编辑态保持
    r.selDelNoMerge = document.querySelectorAll(".bm-block").length === 1 &&
                      block(sCid).textContent === "独段文字" && !!st().editingCid;

    // ---------- 转义渲染：\\[x\\](u) 字面 ----------
    Editor.open("前导\\\\[x\\\\](u)后缀\\n");
    const eEl = document.querySelector("#write a");
    r.escapeLiteral = !eEl && document.querySelector("#write p").textContent.includes("[x](u)");

    // ---------- setext 活体（直构源码+合成 input：execCommand 在软换行尾的插入位置有合成怪癖） ----------
    Editor.open("标题行");
    const sx = document.querySelector(".bm-block").dataset.cid;
    Editor._enterEdit(sx);
    block(sx).textContent = "标题行\\n===";
    block(sx).dispatchEvent(new KeyboardEvent("input", { bubbles: true }));
    await sleep(30);
    r.setextLive = block(sx).dataset.type === "heading" && block(sx).dataset.level === "1";
    block(sx).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(30);
    r.setextCommit = !!block(sx).querySelector("h1") && Editor.getMarkdown().includes("标题行");
    // 发布评审 P0 回归：setext 渲染态/导出不得把下划线 ===/--- 当标题文字渲染
    Editor.open("标题甲\\n===\\n\\n小节乙\\n---\\n");
    await sleep(30);
    const h1el = document.querySelector('[data-type="heading"][data-level="1"] h1');
    const h2el = document.querySelector('[data-type="heading"][data-level="2"] h2');
    r.setextRenderText = !!h1el && h1el.textContent === "标题甲" && !h1el.textContent.includes("===") &&
                         !!h2el && h2el.textContent === "小节乙" && !h2el.textContent.includes("---");
    r.setextExportClean = !Editor.getExportHtml().match(/<h1[^>]*>[^<]*===/);
    const ocid = document.querySelector('[data-type="heading"][data-level="1"]').dataset.cid;
    Editor._enterEdit(ocid);   // 显式定目标（format 兜底链的 lastFocusedCid 可能指上个用例的旧 cid）
    Editor.format("h2");       // setext 源升降级须归一为 ATX（旧版静默无效）
    block(ocid).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(30);
    await sleep(30);
    r.setextFormat = Editor.getMarkdown().includes("## 标题甲") && !Editor.getMarkdown().includes("===");

    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = JSON.stringify(r);
    document.body.appendChild(pre);
    const ok = Object.values(r).every(Boolean);
    document.title = ok ? "M9-E2E PASS" : "M9-E2E FAIL";
  } catch (e) {
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = "ERROR: " + e.message + "|" + (e.stack||"").split("\\n")[1];
    document.body.appendChild(pre);
    document.title = "M9-E2E ERROR";
  }
});
</script>
`;
html = html.replace("</body>", () => test + "\n</body>");
writeFileSync(join(root, "EditorResources", "e2e-m9.html"), html);
console.log("generated");
