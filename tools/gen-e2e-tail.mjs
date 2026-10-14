// 生成长尾轮 e2e：查找⌘F/表格单元格导航/URL 智能粘贴/lightbox/删除线/图片相对路径
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let html = readFileSync(join(root, "EditorResources", "index.bundle.html"), "utf8");
const test = String.raw`<script>
window.addEventListener("DOMContentLoaded", async () => {
  const r = {};
  const sleep = ms => new Promise(ok => setTimeout(ok, ms));
  try {
    // ---------- 查找 ----------
    Editor.open("标题甲\n\n段落甲含目标词一\n\n段落乙含目标词二\n\n## 甲节尾\n");
    Editor.openFindBar("目标词");
    await sleep(30);
    r.findShown = !!document.querySelector("#bm-findbar.show");
    r.findHits = document.querySelectorAll("mark.bm-hit").length === 2;
    r.findCur = document.querySelectorAll("mark.bm-hit-cur").length === 1;
    r.findCount = document.querySelector("#bm-findbar .bm-find-count").textContent === "1/2";
    // Enter 下一个
    const input = document.querySelector("#bm-findbar input");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    r.findNext = document.querySelector("#bm-findbar .bm-find-count").textContent === "2/2";
    // 关闭恢复
    Editor.closeFindBar();
    r.findClosed = !document.querySelector("#bm-findbar.show") && !document.querySelector("mark.bm-hit");
    // 关键词改查含多匹配行内场景
    Editor.openFindBar("甲");
    await sleep(30);
    r.findMulti = document.querySelectorAll("mark.bm-hit").length >= 3;
    Editor.closeFindBar();

    // ---------- 表格单元格编辑 + Tab/Enter 导航 ----------
    Editor.open("| A | B |\n|---|---|\n| a1 | a2 |\n| b1 | b2 |\n");
    const tCid = Editor._editingState() && document.querySelector('[data-type="table"]').dataset.cid;
    Editor._enterCellEdit(tCid, 1, 0);
    r.cellSource = document.querySelector('[data-r="1"][data-c="0"]').textContent === "a1"; // 显示源码
    const td = document.querySelector('[data-r="1"][data-c="0"].bm-cell-editing');
    td.textContent = "改过";
    // Tab → 右格
    td.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    await sleep(30);
    r.cellTab = Editor._editingState().cellEdit && Editor._editingState().cellEdit.c === "1";
    // Enter → 下行同列
    const td2 = document.querySelector('[data-r="1"][data-c="1"].bm-cell-editing');
    td2.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await sleep(30);
    r.cellEnter = Editor._editingState().cellEdit &&
                  Editor._editingState().cellEdit.r === "2" && Editor._editingState().cellEdit.c === "1";
    // Esc 提交写回
    const td3 = document.querySelector('[data-r="2"][data-c="1"].bm-cell-editing');
    td3.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(30);
    r.cellCommitted = Editor.getMarkdown().includes("| 改过 | a2 |");
    r.cellRendered = document.querySelector('[data-r="1"][data-c="0"]').textContent === "改过";

    // ---------- 双击单元格回归：第二击的重渲染不得让 td 脱钩（否则后续点击全失效） ----------
    Editor.open("| A | B |\n|---|---|\n| a1 | a2 |\n");
    const dCid = document.querySelector('[data-type="table"]').dataset.cid;
    const dTd = document.querySelector('[data-r="1"][data-c="0"]');
    dTd.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    dTd.dispatchEvent(new MouseEvent("mousedown", { bubbles: true })); // 双击第二击
    await sleep(30);
    const dLive = document.querySelector('[data-cid="' + dCid + '"] [data-r="1"][data-c="0"]');
    r.dblLive = !!dLive && dLive.isConnected;
    r.dblEditing = !!dLive && dLive.classList.contains("bm-cell-editing") && dLive.textContent === "a1";
    r.dblFocus = document.activeElement === dLive;
    // 第三击（用户"再次点击"）仍可进入编辑并写回
    dLive.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    await sleep(30);
    const dLive2 = document.querySelector('[data-cid="' + dCid + '"] [data-r="1"][data-c="0"]');
    r.dblReclick = !!dLive2 && dLive2.classList.contains("bm-cell-editing");
    dLive2.textContent = "双击改";
    dLive2.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(30);
    r.dblWriteback = Editor.getMarkdown().includes("| 双击改 | a2 |");

    // ---------- URL 智能粘贴 ----------
    Editor.open("看看 站点 词\n");
    const cid = document.querySelector('[data-type="paragraph"]').dataset.cid;
    Editor._enterEdit(cid);
    const el = document.querySelector('[data-cid="' + cid + '"]');
    // 选中"站点"两字（textOffset 3..5）
    const setSel = (a, b) => {
      const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      let n, acc = 0, sNode = null, eNode = null, sOff = 0, eOff = 0;
      while ((n = walker.nextNode())) {
        const len = n.textContent.length;
        if (sNode === null && acc + len >= a) { sNode = n; sOff = a - acc; }
        if (acc + len >= b) { eNode = n; eOff = b - acc; break; }
        acc += len;
      }
      if (!sNode || !eNode) return false;
      const range = document.createRange();
      range.setStart(sNode, sOff); range.setEnd(eNode, eOff);
      const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range);
      return true;
    };
    r.urlSelSet = setSel(3, 5);
    Editor._pasteText(el, "https://example.com/x");
    r.urlWrapped = el.textContent.includes("[站点](https://example.com/x)");
    // 非选区纯 URL → 原样
    const el2 = el;
    Editor._pasteText(el2, "https://plain.example/y");
    r.urlPlain = el2.textContent.includes("https://plain.example/y");

    // ---------- lightbox ----------
    Editor.open("![图](assets/pic.png)\n");
    await sleep(30);
    const img = document.querySelector('[data-type="paragraph"] img');
    r.imgExists = !!img;
    img.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    r.lightbox = !!document.querySelector("#bm-lightbox.show");
    document.querySelector("#bm-lightbox").dispatchEvent(new MouseEvent("click", { bubbles: true }));
    r.lightboxClosed = !document.querySelector("#bm-lightbox.show");

    // ---------- 图片相对路径 base ----------
    Editor._assetBase("file:///Users/x/docdir/");
    r.imgAbs = img.getAttribute("src") === "file:///Users/x/docdir/assets/pic.png";
    r.imgRaw = img.dataset.raw === "assets/pic.png";

    // ---------- Enter 拆块方向 + undo + 软换行（评审 P0 回归） ----------
    Editor.open("AAAABBBB\n");
    const pCid = document.querySelector('[data-type="paragraph"]').dataset.cid;
    Editor._enterEdit(pCid);
    const pEl = document.querySelector('[data-cid="' + pCid + '"]');
    // 光标放到 AAAA|BBBB（offset 4）
    const tw = document.createTreeWalker(pEl, NodeFilter.SHOW_TEXT);
    const tn = tw.nextNode();
    const rr = document.createRange();
    rr.setStart(tn, 4); rr.collapse(true);
    const ss = getSelection(); ss.removeAllRanges(); ss.addRange(rr);
    pEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await sleep(30);
    const md1 = Editor.getMarkdown();
    r.enterSplit = md1.includes("AAAA") && md1.includes("BBBB") && !md1.includes("AAAABBBB");
    r.enterNoDup = (md1.match(/BBBB/g) || []).length === 1;   // 尾部不重复
    // undo 恢复整块（快照先于修改）
    Editor.undo();
    await sleep(30);
    r.enterUndo = Editor.getMarkdown().replace(/\n+$/, "") === "AAAABBBB";
    // 软换行：shift+Enter 插入 \n 而非被 relight 吞掉
    Editor.open("行一行二\n");
    const sCid = document.querySelector('[data-type="paragraph"]').dataset.cid;
    Editor._enterEdit(sCid);
    const sEl = document.querySelector('[data-cid="' + sCid + '"]');
    sEl.focus();
    sEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", shiftKey: true, bubbles: true }));
    await sleep(30);
    r.softBreak = sEl.textContent.includes("\n");

    // ---------- 任务列表删除线（computed） ----------
    Editor.open("- [x] 完成项\n- [ ] 未完\n");
    const doneLi = document.querySelector(".bm-task-done");
    r.strike = getComputedStyle(doneLi).textDecorationLine.includes("line-through");

    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = JSON.stringify(r);
    document.body.appendChild(pre);
    const ok = Object.values(r).every(Boolean);
    document.title = ok ? "TAIL-E2E PASS" : "TAIL-E2E FAIL";
  } catch (e) {
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = "ERROR: " + e.message + "|" + (e.stack||"").split("\n")[1];
    document.body.appendChild(pre);
    document.title = "TAIL-E2E ERROR";
  }
});
</script>
`;
html = html.replace("</body>", () => test + "\n</body>");
writeFileSync(join(root, "EditorResources", "e2e-tail.html"), html);
console.log("generated");
