// 生成 M7 轮 e2e：编辑逻辑重构——空块 Backspace 崩溃回归 / Typora 式活体形态（行首语法即变块型）
// / 行首退格合块（并入文本前块、进表格末格、进代码 CM）/ 围栏行回车即转代码·公式块 / 格式菜单编辑态感知
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let html = readFileSync(join(root, "EditorResources", "index.bundle.html"), "utf8");
const test = String.raw`<script>
window.addEventListener("DOMContentLoaded", async () => {
  const r = {};
  const sleep = ms => new Promise(ok => setTimeout(ok, ms));
  const st = () => Editor._editingState();
  const block = cid => document.querySelector('[data-cid="' + cid + '"]');
  const type = () => Editor.getMarkdown();
  window.addEventListener("error", e => { r.jsError = e.message; });
  try {
    // ---------- 回归：唯一空块上 Backspace（曾崩溃 → 编辑器假死） ----------
    Editor.open("");
    const solo = document.querySelector(".bm-block").dataset.cid;
    Editor._enterEdit(solo);
    block(solo).dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    const soloAfter = st().editingCid;   // 同步读（headless 焦点不粘，sleep 会引入假 blur-commit）
    await sleep(30);
    r.bsSoleNoCrash = !r.jsError && !!soloAfter && document.querySelectorAll(".bm-block").length === 1;
    block(soloAfter).focus();
    document.execCommand("insertText", false, "重打");
    block(soloAfter).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(30);
    r.bsSoleReeditable = type().includes("重打");

    // ---------- 回归：多块中删空块（Enter 拆出的空段再退格删除） ----------
    Editor.open("甲行\n");
    const jCid = document.querySelector(".bm-block").dataset.cid;
    Editor._enterEdit(jCid);
    block(jCid).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    const emptyCid = st().editingCid;
    r.enterSplitEmpty = !!emptyCid && emptyCid !== jCid && document.querySelectorAll(".bm-block").length === 2;
    block(emptyCid).dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    await sleep(30);
    r.bsEmptyDelete = !r.jsError && st().editingCid === jCid && type().includes("甲行") &&
                      document.querySelectorAll(".bm-block").length === 1;

    // ---------- 活体形态：行首语法即变块型（Typora 式） ----------
    Editor.open("");
    const hCid = document.querySelector(".bm-block").dataset.cid;
    Editor._enterEdit(hCid);
    document.execCommand("insertText", false, "# 标题一");
    await sleep(30);
    const hEl = block(hCid);
    r.liveHeading = hEl.dataset.type === "heading" && hEl.dataset.level === "1" &&
                    !!hEl.querySelector(".bm-mark-prefix") && hEl.textContent === "# 标题一" &&
                    document.activeElement === hEl;
    r.liveStatus = document.getElementById("bm-status").textContent.includes("3 字");
    hEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(30);
    r.liveHeadingCommit = !!block(hCid).querySelector("h1") && type().includes("# 标题一");

    Editor.open("");
    const lCid = document.querySelector(".bm-block").dataset.cid;
    Editor._enterEdit(lCid);
    document.execCommand("insertText", false, "- 项目");
    await sleep(30);
    r.liveList = block(lCid).dataset.type === "ul";
    Editor.open("");
    const qCid = document.querySelector(".bm-block").dataset.cid;
    Editor._enterEdit(qCid);
    document.execCommand("insertText", false, "> 引文");
    await sleep(30);
    r.liveQuote = block(qCid).dataset.type === "quote";
    // 敲掉前缀回到段落（活体双向）
    document.execCommand("insertText", false, "");
    block(qCid).textContent = "纯文本";
    block(qCid).dispatchEvent(new KeyboardEvent("input", { bubbles: true }));
    await sleep(30);
    r.liveBackToPara = block(qCid).dataset.type === "paragraph";

    // ---------- 行首退格合块 ----------
    Editor.open("甲段落\n\n乙段落");
    const cids = [...document.querySelectorAll(".bm-block")].map(e => e.dataset.cid);
    Editor._enterEdit(cids[1], false);   // 光标在块首
    block(cids[1]).dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    await sleep(30);
    r.mergePara = st().editingCid === cids[0] && block(cids[0]).textContent === "甲段落乙段落" &&
                  document.querySelectorAll(".bm-block").length === 1;
    const sel = getSelection();
    r.mergeCaret = block(cids[0]).contains(sel.anchorNode) &&
                   (sel.anchorOffset <= 6);   // 光标在拼接点附近（甲段落|=3，容忍高亮 span 切分）
    Editor.undo();
    await sleep(30);
    r.mergeUndo = type().includes("甲段落") && type().includes("乙段落") &&
                  document.querySelectorAll(".bm-block").length === 2;

    Editor.open("# 标\n\n正文");
    const hc = [...document.querySelectorAll(".bm-block")].map(e => e.dataset.cid);
    Editor._enterEdit(hc[1], false);
    block(hc[1]).dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    await sleep(30);
    r.mergeHeading = st().editingCid === hc[0] && block(hc[0]).textContent === "# 标正文" &&
                     block(hc[0]).dataset.type === "heading";

    // 前块表格 → 末格；前块代码 → CM
    Editor.open("| A | B |\n|---|---|\n| 1 | 2 |\n\n尾段");
    const tc = [...document.querySelectorAll(".bm-block")].map(e => e.dataset.cid);
    Editor._enterEdit(tc[1], false);
    block(tc[1]).dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    await sleep(50);
    r.mergeTableCell = st().cellEdit && st().cellEdit.r === "1" && st().cellEdit.c === "1" &&
                       document.querySelectorAll(".bm-block").length === 2 && type().includes("尾段");
    Editor._commitCellEdit();

    Editor.open("\`\`\`\ncode\n\`\`\`\n\n尾段");
    const cc = [...document.querySelectorAll(".bm-block")].map(e => e.dataset.cid);
    Editor._enterEdit(cc[1], false);
    block(cc[1]).dispatchEvent(new KeyboardEvent("keydown", { key: "Backspace", bubbles: true }));
    await sleep(50);
    r.mergeCodeCm = st().hasCm && document.querySelectorAll(".bm-block").length === 2 && type().includes("尾段");

    // ---------- 围栏/公式行 + Enter 即转块进 CM ----------
    const caretEnd = el => {
      el.focus();
      const rng = document.createRange();
      rng.selectNodeContents(el);
      rng.collapse(false);
      const s = getSelection();
      s.removeAllRanges();
      s.addRange(rng);
    };
    Editor.open("前段\n\n尾段");
    const fc = [...document.querySelectorAll(".bm-block")].map(e => e.dataset.cid);
    Editor._enterEdit(fc[1]);
    block(fc[1]).textContent = "\`\`\`js";
    caretEnd(block(fc[1]));
    block(fc[1]).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await sleep(50);
    r.fenceEnter = st().hasCm && block(fc[1]).dataset.type === "code" &&
                   !!block(fc[1]).querySelector(".CodeMirror");
    // 点回前段提交 CM → 代码块落盘带语言
    block(fc[0]).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await sleep(50);
    r.fenceCommit = type().includes("\`\`\`js") && st().editingCid === fc[0];

    Editor.open("前段\n\n尾段");
    const mc = [...document.querySelectorAll(".bm-block")].map(e => e.dataset.cid);
    Editor._enterEdit(mc[1]);
    block(mc[1]).textContent = "$$";
    caretEnd(block(mc[1]));
    block(mc[1]).dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await sleep(50);
    r.mathEnter = st().hasCm && block(mc[1]).dataset.type === "math";
    block(mc[0]).dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await sleep(50);

    // ---------- 格式菜单编辑态感知：不丢已敲文本、不打断编辑 ----------
    Editor.open("正文段");
    const gCid = document.querySelector(".bm-block").dataset.cid;
    Editor._enterEdit(gCid);
    document.execCommand("insertText", false, "追加");
    await sleep(30);
    Editor.format("h1");
    await sleep(30);
    r.fmtLive = st().editingCid === gCid && block(gCid).textContent === "# 正文段追加" &&
                block(gCid).dataset.type === "heading" && document.activeElement === block(gCid);
    block(gCid).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(30);
    r.fmtCommit = type().includes("# 正文段追加");

    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = JSON.stringify(r);
    document.body.appendChild(pre);
    const ok = Object.values(r).every(Boolean);
    document.title = ok ? "M7-E2E PASS" : "M7-E2E FAIL";
  } catch (e) {
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = "ERROR: " + e.message + "|" + (e.stack||"").split("\n")[1];
    document.body.appendChild(pre);
    document.title = "M7-E2E ERROR";
  }
});
</script>
`;
html = html.replace("</body>", () => test + "\n</body>");
writeFileSync(join(root, "EditorResources", "e2e-m7.html"), html);
console.log("generated");
