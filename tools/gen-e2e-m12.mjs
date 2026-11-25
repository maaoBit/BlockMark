// 生成 m12 e2e：可靠点击与点击落光标（specs/001-reliable-click-caret）
// 覆盖不依赖原生焦点事件时序的部分：落点偏移、链接单击/⌘点击、空白区兜底只进一次编辑、拖选、双击选词，
// 以及"编辑中的块 → 点单元格"的点击生效性。原生焦点级行为的系统 WebKit 验证见 tools/run-webkit.sh。
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
    Editor.open("# 标题文字\n\n你好世界，第二段落。\n\n- 列表项甲\n- 列表项**乙**续\n  延续行文字\n\n> 引用一行文字\n\n" +
      "| 甲 | 乙 |\n| --- | --- |\n| a1 | a2 |\n| b1 | b2 |\n\n" +
      "表后正文段落，**粗体**与${"`"}代码${"`"}还有[链接](https://example.com)。\n\n末尾段落，再写一些文字。\n\n" +
      "第一行文字\n第二行文字\n第三行文字\n\n- [ ] 任务一文字\n\n公式 $a+b$ 后文\n");
    await sleep(60);

    // ---------- 工具 ----------
    const block = cid => document.querySelector('.bm-block[data-cid="' + cid + '"]');
    const visible = el => { el.scrollIntoView({ block: "center" }); return el; };
    // 块内第 li 行第 ci 个可见字符的视口坐标；side 0 = 左缘，1 = 右缘（按当前 DOM，按下后即源码视图）
    const charPos = (cid, li, ci, side = 0.5) => {
      const el = visible(block(cid));
      const lines = [[]]; const started = new Set();
      const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      let n;
      while ((n = walk.nextNode())) {
        if (n.nodeType === 1) {
          if (n.tagName === "BR") { lines.push([]); continue; }
          if (/^(P|LI|H[1-6]|DIV|BLOCKQUOTE)$/.test(n.tagName) && !started.has(n)) { started.add(n); if (lines[lines.length - 1].length) lines.push([]); }
          continue;
        }
        if (n.textContent.length && !n.parentElement.closest(".bm-task-box")) lines[lines.length - 1].push(n);
      }
      let k = ci;
      for (const tn of lines[li] || []) {
        if (k < tn.textContent.length) {
          const q = document.createRange(); q.setStart(tn, k); q.setEnd(tn, Math.min(k + 1, tn.textContent.length));
          const b = q.getBoundingClientRect();
          return [b.left + b.width * side, b.top + b.height / 2];
        }
        k -= tn.textContent.length;
      }
      return null;
    };
    const mouse = (type, x, y, o = {}) => (document.elementFromPoint(x, y) || document).dispatchEvent(new MouseEvent(type, {
      bubbles: true, cancelable: true, clientX: x, clientY: y, button: 0, buttons: o.buttons || 0, detail: o.detail || 1, metaKey: !!o.meta }));
    const clickAt = (x, y, o) => { mouse("mousedown", x, y, o); mouse("mouseup", x, y, o); };
    // 编辑态块内光标的源码偏移
    const caretOff = cid => {
      const el = block(cid); const sel = getSelection();
      if (!el || !sel.rangeCount || !el.contains(sel.anchorNode)) return -1;
      const p = sel.getRangeAt(0).cloneRange(); p.selectNodeContents(el);
      p.setEnd(sel.anchorNode, sel.anchorOffset);
      return p.toString().length;
    };
    const caretIs = (cid, want) => { const got = caretOff(cid); return got === want ? true : "got " + got; };
    const es = () => Editor._editingState();

    // ---------- 点击落点：光标 = 被点击字符对应的源码偏移 ----------
    // 每例重开文档：点击前块处于渲染态，坐标按所见取；点击后断言编辑态里的源码偏移
    const caretCase = async (doc, li, ci, side, want, xOverride) => {
      Editor.open(doc); await sleep(30);
      let p = charPos("b1", li, ci, side);
      if (xOverride) p = [xOverride(p), p[1]];
      if (!p) return "no pos";
      clickAt(p[0], p[1]); await sleep(10);
      const got = caretOff("b1");
      return es().editingCid === "b1" && got === want ? true : "got " + got;
    };
    const P = "你好世界，第二段落。\n", B = "表后正文段落，**粗体**与${"`"}代码${"`"}还有[链接](https://example.com)。\n";
    const T = "第一行文字\n第二行文字\n第三行文字\n";
    r.caretMidLeft = await caretCase(P, 0, 2, 0.2, 2);            // 你好|世界
    r.caretMidRight = await caretCase(P, 0, 2, 0.8, 3);           // 你好世|界
    r.caretStart = await caretCase(P, 0, 0, 0.1, 0);              // |你好
    r.caretHeading = await caretCase("# 标题文字\n", 0, 0, 0.2, 2);              // # |标题文字
    r.caretListBold = await caretCase("- 列表项甲\n- 列表项**乙**续\n  延续行文字\n", 1, 3, 0.2, 14);   // - 列表项**|乙**续
    r.caretListCont = await caretCase("- 列表项甲\n- 列表项**乙**续\n  延续行文字\n", 2, 2, 0.2, 23);   //   延续|行文字
    r.caretQuote = await caretCase("> 引用一行文字\n", 0, 2, 0.2, 4);            // > 引用|一行文字
    r.caretBoldOpen = await caretCase(B, 0, 7, 0.2, 9);           // ，**|粗体**与
    r.caretBoldClose = await caretCase(B, 0, 8, 0.8, 11);         // **粗体|**与（点在"体"右半）
    r.caretCode = await caretCase(B, 0, 10, 0.2, 15);             // 与·|代码·还
    r.caretLinkText = await caretCase(B, 0, 14, 0.2, 21);         // 还有[|链接](…)
    r.caretLineEnd = await caretCase("末尾段落，再写一些文字。\n", 0, 0, 0.5, 12,
      () => block("b1").querySelector("p").getBoundingClientRect().right - 2);   // 行尾空白 → 行尾
    r.caretMultiLine = await caretCase(T, 1, 2, 0.2, 8);          // 第二|行文字
    r.caretLastLineEnd = await caretCase(T, 2, 0, 0.5, 17,
      () => block("b1").querySelector("p").getBoundingClientRect().right - 2);   // 最后一行行尾
    r.caretTask = await caretCase("- [ ] 任务一文字\n", 0, 2, 0.2, 8);           // - [ ] 任务|一文字
    // 行内公式：美元符不占可见位（左缘 → 开美元符之前；右缘 → 闭美元符之后）
    const mathCase = async (frac, want) => {
      Editor.open("公式 $a+b$ 后文\n"); await sleep(60);
      const im = visible(block("b1")).querySelector(".bm-imath").getBoundingClientRect();
      clickAt(im.left + im.width * frac, im.top + im.height / 2); await sleep(10);
      const got = caretOff("b1");
      return es().editingCid === "b1" && got === want ? true : "got " + got;
    };
    r.caretMathOpen = await mathCase(0.15, 3);                    // 公式 |$a+b$ 后文
    r.caretMathClose = await mathCase(0.85, 8);                   // 公式 $a+b$| 后文
    // 表格行右侧空白：整表源码态，光标在被点击行行尾
    const rowCase = async (rowSel, lineText) => {
      const doc = "| 甲 | 乙 |\n| --- | --- |\n| a1 | a2 |\n| b1 | b2 |\n";
      Editor.open(doc); await sleep(30);
      const w = block("b1").querySelector(".bm-table-wrap").getBoundingClientRect();
      const t = block("b1").querySelector(rowSel).getBoundingClientRect();
      clickAt(w.right - 6, t.top + t.height / 2); await sleep(10);
      const got = caretOff("b1"), want = doc.indexOf(lineText) + lineText.length;
      return es().editingCid === "b1" && got === want ? true : "got " + got;
    };
    r.caretTableRow1 = await rowCase("tbody tr:nth-child(1)", "| a1 | a2 |");
    r.caretTableRow2 = await rowCase("tbody tr:nth-child(2)", "| b1 | b2 |");

    // ---------- 链接：单击落光标，⌘点击打开 ----------
    Editor.open("段落[链接文字](https://example.com/a)尾巴\n");
    await sleep(40);
    window.__bmCalls = [];
    { const o = Bridge.call; Bridge.call = (n, d) => { window.__bmCalls.push(n); return o(n, d); }; }
    p = charPos("b1", 0, 4, 0.5); clickAt(p[0], p[1]); await sleep(10);
    r.linkClickNoOpen = window.__bmCalls.indexOf("path.openURL") === -1 && es().editingCid === "b1" && caretOff("b1") === 5;
    Editor.open("段落[链接文字](https://example.com/a)尾巴\n");
    await sleep(40);
    p = charPos("b1", 0, 4, 0.5); clickAt(p[0], p[1], { meta: true }); await sleep(10);
    r.linkCmdClickOpens = window.__bmCalls.indexOf("path.openURL") !== -1 && es().editingCid === null;

    // ---------- 空白区兜底：块内容点击只进一次编辑（不得把光标拽回块尾） ----------
    Editor.open("你好世界\n\n甲乙丙丁戊己庚辛壬癸子丑寅卯\n");
    await sleep(40);
    window.__bmEnters = 0;
    { const o = window.enterEdit; window.enterEdit = function (...a) { window.__bmEnters++; return o.apply(this, a); }; }
    p = charPos("b2", 0, 3, 0.2); clickAt(p[0], p[1]); await sleep(10);
    r.singleEnter = window.__bmEnters === 1 && es().editingCid === "b2";
    r.enterCaretKept = caretOff("b2") === 3;

    // ---------- 点击生效：编辑中的块 → 点单元格 ----------
    Editor.open("第一段落文字\n\n| 甲 | 乙 |\n| --- | --- |\n| a1 | a2 |\n| b1 | b2 |\n");
    await sleep(40);
    p = charPos("b1", 0, 2, 0.2); clickAt(p[0], p[1]); await sleep(10);
    const td = document.querySelector('[data-cid="b2"] [data-r="1"][data-c="0"]');
    p = td.getBoundingClientRect(); clickAt(p.left + p.width / 2, p.top + p.height / 2);
    await sleep(40);   // 让 focusout 的 0ms 延时回调有机会触发（被吞的点击正是在这里露馅）
    r.cellClickFromEditing = !!es().cellEdit && es().cellEdit.r === "1" && es().cellEdit.c === "0";
    r.cellFocused = document.activeElement === document.querySelector(".bm-cell-editing");
    r.blockCommitted = es().editingCid === null;

    // ---------- 拖选（首次按下即生效）与双击选词 ----------
    Editor.open("你好世界，第二段落。\n\n表后段落，**粗体**与代码还有链接。\n");
    await sleep(40);
    p = charPos("b1", 0, 1, 0.2); mouse("mousedown", p[0], p[1]); await sleep(5);
    p = charPos("b1", 0, 2, 0.5); mouse("mousemove", p[0], p[1], { buttons: 1 });
    p = charPos("b1", 0, 4, 0.8); mouse("mousemove", p[0], p[1], { buttons: 1 });
    mouse("mouseup", p[0], p[1]); await sleep(10);
    r.dragSelect = es().editingCid === "b1" && getSelection().toString() === "好世界，";
    Editor.open("你好世界，第二段落。\n\n表后段落，**粗体**与代码还有链接。\n");
    await sleep(40);
    // 双击"还有"（渲染态第 10 个字符）：两次按下用同一坐标，坐标在首次按下前按渲染态取好
    { const q = charPos("b2", 0, 10, 0.5);
      clickAt(q[0], q[1], { detail: 1 }); await sleep(5);
      clickAt(q[0], q[1], { detail: 2 });
      (document.elementFromPoint(q[0], q[1]) || document).dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true, clientX: q[0], clientY: q[1] })); }
    await sleep(10);
    r.dblClickWord = es().editingCid === "b2" && getSelection().toString() === "还有";
    // 已在编辑态的块里双击：同样按分词选词；点在空白上则不干预
    Editor.open("Hello world foo\n");
    await sleep(40);
    { const q = charPos("b1", 0, 1, 0.5); clickAt(q[0], q[1]); } await sleep(10);
    { const el = block("b1"), tn = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode();
      const setCaret = off => { const rr = document.createRange(); rr.setStart(tn, off); rr.collapse(true); const ss = getSelection(); ss.removeAllRanges(); ss.addRange(rr); };
      // 真实操作里，进入编辑态后的首次单击（计数 1）会作废上一次按下的手势；这里补上这一下
      el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, detail: 1 }));
      const dbl = () => el.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
      setCaret(7); dbl(); await sleep(5);
      r.dblClickEditingWord = getSelection().toString() === "world";
      setCaret(5); dbl(); await sleep(5);
      r.dblClickSpaceNoop = getSelection().isCollapsed;
    }

    // ---------- 诊断导出（纯读取） ----------
    Editor.open("诊断用文档\n");
    await sleep(40);
    p = charPos("b1", 0, 0, 0.5); clickAt(p[0], p[1]); await sleep(10);
    const diag = JSON.parse(Editor._diag());
    r.diagShape = Array.isArray(diag.trace) && Array.isArray(diag.issues) && typeof diag.now === "string" && !!diag.state;
    r.diagTraceHasEntry = diag.trace.some(e => e.ev === "blockIn" && e.t !== undefined);
    r.diagReadOnly = es().editingCid === "b1" && diag.state.editingCid === "b1";
    r.diagNoBody = !JSON.stringify(diag).includes("诊断用文档");   // 诊断不记正文

    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = JSON.stringify(r);
    document.body.appendChild(pre);
    const ok = Object.values(r).every(Boolean);
    document.title = ok ? "M12-E2E PASS" : "M12-E2E FAIL";
  } catch (e) {
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = "ERROR: " + e.message + "|" + (e.stack || "").split("\n")[1];
    document.body.appendChild(pre);
    document.title = "M12-E2E ERROR";
  }
});
</script>
`;
html = html.replace("</body>", () => test + "\n</body>");
writeFileSync(join(root, "EditorResources", "e2e-m12.html"), html);
console.log("generated");
