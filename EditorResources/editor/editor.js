// BlockMark — 编辑器核心：块模型（DOM 即文档）
// 设计:
//   - #write 是唯一 contenteditable 容器；每块是 data-cid + data-type 的子元素
//   - 块的两个状态: 渲染态（语法隐藏）/ 编辑态（就地显示源码，定界符半透明标记，
//     光标落在语法结构内时加亮 —— M1 行内就地编辑）
//   - 代码块编辑态内嵌 CodeMirror（M2），渲染态 runMode 语法高亮
//   - 事实源是块对象的 source 字段，DOM 由它派生
import { parseBlocks, serializeBlocks, reclassify, classifyBlock, mathTex, toggleTaskItem, tableGetCell, tableSetCell, tableParse, tableInsertRow, tableDeleteRow, tableInsertCol, tableDeleteCol } from "./parser.js";
import { renderInline, renderTable, escapeHtml, highlightEditableSource } from "./inline.js";

const write = () => document.getElementById("write");
const scroller = () => document.getElementById("bm-main"); // 滚动容器：全宽 .bm-main（.write 只限宽居中）

let blocks = [];            // [{cid, type, level, lang, source}]
let editingCid = null;      // contenteditable 编辑态的块
let editingCm = null;       // {cid, cm, langInput} CodeMirror 编辑态（代码块）
let composing = false;      // IME 组合期间禁止重渲染
let undoStack = [], redoStack = [];
let changeTimer = null;
let sourceMode = false;
let sourceCm = null;

// CodeMirror 语言别名（依赖 modes.bundle.js 实际打包的模式）
const CM_MODES = {
  js: "javascript", javascript: "javascript", json: "application/json", json5: "application/json",
  ts: "javascript", typescript: "javascript", tsx: "jsx" in window ? "jsx" : "javascript",
  py: "python", python: "python",
  sh: "shell", bash: "shell", shell: "shell", zsh: "shell",
  go: "go", golang: "go",
  c: "text/x-csrc", h: "text/x-csrc", cpp: "text/x-c++src", "c++": "text/x-c++src", cc: "text/x-c++src",
  hpp: "text/x-c++src", java: "text/x-java", cs: "text/x-csharp", csharp: "text/x-csharp",
  objc: "text/x-objectivec", scala: "text/x-scala",
  swift: "swift", rust: "rust", rs: "rust",
  css: "css", less: "text/x-less", scss: "text/x-scss",
  html: "htmlmixed", xml: "xml", svg: "xml", vue: "htmlmixed", svelte: "htmlmixed",
  md: "markdown", markdown: "markdown",
  yaml: "yaml", yml: "yaml", toml: "toml",
  sql: "sql", rb: "ruby", ruby: "ruby", php: "application/x-httpd-php",
  tex: "stex", latex: "stex", stex: "stex", math: "stex",
};
function cmModeFor(lang) { return CM_MODES[(lang || "").toLowerCase()] || null; }

// ---------- 渲染 ----------

function blockHtml(b) {
  const inner = renderBlockInner(b);
  const levelAttr = b.level ? ` data-level="${b.level}"` : "";
  return `<div class="bm-block" data-cid="${b.cid}" data-type="${b.type}"${levelAttr}>${inner}</div>`;
}

function renderBlockInner(b) {
  const src = b.source;
  switch (b.type) {
    case "heading": {
      const text = src.replace(/^#{1,6}\s+/, "");
      return `<h${b.level} class="bm-render">${renderInline(text)}</h${b.level}>`;
    }
    case "hr":
      return `<hr class="bm-render">`;
    case "code": {
      const lines = src.split("\n");
      const lang = (lines[0].match(/^```\s*(\S*)/) || [])[1] || "";
      const body = lines.slice(1, lines.length - 1).join("\n");
      // 渲染态高亮由 enhanceCodeBlocks() 用 CodeMirror.runMode 后处理
      return `<pre class="bm-render bm-code" data-lang="${escapeHtml(lang)}"><code>${escapeHtml(body)}</code></pre>`;
    }
    case "quote":
      return `<blockquote class="bm-render">${src.split("\n").map(l => renderInline(l.replace(/^>\s?/, ""))).join("<br>")}</blockquote>`;
    case "ul": {
      const items = src.split("\n").filter(l => l.trim());
      if (b.tasks) {
        let ti = -1;
        return `<ul class="bm-render bm-tasks">` + items.map(l => {
          const m = l.match(/^(\s*[-*+]\s+)\[( |x|X)\](\s+)(.*)$/);
          if (!m) return `<li>${renderInline(l.replace(/^\s*[-*+]\s+/, ""))}</li>`;
          ti++;
          const done = m[2] !== " ";
          return `<li class="bm-task${done ? " bm-task-done" : ""}"><span class="bm-task-box" data-index="${ti}" contenteditable="false">${done ? "\u2713" : ""}</span>${renderInline(m[4])}</li>`;
        }).join("") + `</ul>`;
      }
      return `<ul class="bm-render">${items.map(l =>
        `<li>${renderInline(l.replace(/^\s*[-*+]\s+/, ""))}</li>`).join("")}</ul>`;
    }
    case "ol":
      return `<ol class="bm-render">${src.split("\n").filter(l => l.trim()).map(l =>
        `<li>${renderInline(l.replace(/^\s*\d+[.)]\s+/, ""))}</li>`).join("")}</ol>`;
    case "table":
      return renderTable(src);
    case "frontmatter": {
      const body = src.split("\n").slice(1, -1).join("\n");
      return `<pre class="bm-render bm-frontmatter"><code>${escapeHtml(body)}</code></pre>`;
    }
    case "math": {
      const tex = mathTex(src);
      return `<div class="bm-render bm-math" data-tex="${escapeHtml(tex)}">${escapeHtml(tex)}</div>`;
    }
    case "footnote":
      return `<section class="bm-render bm-footnote">` + src.split("\n").filter(l => l.trim()).map(l => {
        const m = l.match(/^\[\^([^\]]+)\]:\s?(.*)$/);
        return m ? `<div class="bm-fndef" data-fn="${escapeHtml(m[1])}"><span class="bm-fn-label">${escapeHtml(m[1])}</span>${renderInline(m[2])}</div>` : "";
      }).join("") + `</section>`;
    default:
      return `<p class="bm-render">${src.split("\n").map(renderInline).join("<br>")}</p>`;
  }
}

function renderAll() {
  write().innerHTML = blocks.map(blockHtml).join("");
  enhanceCodeBlocks();
  enhanceMath();
  enhanceImages();
  enhanceTables();
}

function rerenderBlock(b) {
  const el = write().querySelector(`[data-cid="${b.cid}"]`);
  if (!el) return;
  el.outerHTML = blockHtml(b);
  enhanceCodeBlocks();
  enhanceMath();
  enhanceImages();
  enhanceTables();
}

// 图片相对路径 → 文档目录绝对 file URL（base 由原生 doc.baseDir 推送）
// （修复：file:// 页面相对 src 以 EditorResources/ 为基准解析，贴图后 404）
let assetBase = "";

function enhanceImages() {
  // 幂等：以 dataset.raw 为事实源重算显示 src（base 变化后也能纠正）
  for (const img of write().querySelectorAll("img")) {
    const raw = img.dataset.raw || img.getAttribute("src") || "";
    img.dataset.raw = raw;
    if (raw && !/^[a-z][a-z0-9+.-]*:/i.test(raw)) {
      img.src = assetBase ? assetBase + raw.replace(/^\.\//, "") : raw;
    }
  }
}

// 表格块挂"放大查看"按钮（hover 浮现；只进活 DOM，导出用 blockHtml 重渲不含按钮）
function enhanceTables() {
  for (const el of write().querySelectorAll('.bm-block[data-type="table"]')) {
    if (el.querySelector(".bm-table-zoom-btn")) continue;
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "bm-table-zoom-btn";
    btn.title = "放大查看表格";
    btn.textContent = "\u26F6 \u653E\u5927";
    el.appendChild(btn);
  }
}

// 渲染态代码块：CodeMirror.runMode 语法高亮（无 CM 时保持纯文本）
let mmdSeq = 0;

function enhanceCodeBlocks() {
  if (!window.CodeMirror || !CodeMirror.runMode) return;
  for (const pre of write().querySelectorAll("pre.bm-code:not([data-enhanced])")) {
    // mermaid 图表：渲染为 SVG（编辑走代码块 CM 路径）
    if ((pre.dataset.lang || "").toLowerCase() === "mermaid" && window.mermaid) {
      const code = pre.textContent;
      pre.dataset.enhanced = "1";
      const id = "mmd" + (++mmdSeq);
      Promise.resolve(mermaid.render(id, code)).then(res => {
        const svg = typeof res === "string" ? res : (res && res.svg) || "";
        if (!svg) return;
        const wrap = document.createElement("div");
        wrap.className = "bm-mermaid";
        wrap.innerHTML = svg;
        pre.replaceWith(wrap);
      }).catch(() => { pre.classList.add("bm-mermaid-error"); });
      continue;
    }
    const mode = cmModeFor(pre.dataset.lang || "");
    if (!mode) continue;
    const code = pre.textContent;
    pre.textContent = "";
    pre.dataset.enhanced = "1";
    CodeMirror.runMode(code, mode, pre);
  }
}

// KaTeX：公式块（displayMode）+ 行内公式
function enhanceMath() {
  if (!window.katex) return;
  for (const el of write().querySelectorAll(".bm-math:not([data-enhanced]), .bm-imath:not([data-enhanced])")) {
    el.dataset.enhanced = "1";
    try {
      katex.render(el.dataset.tex || "", el, {
        displayMode: el.classList.contains("bm-math"),
        throwOnError: false,
      });
    } catch (_) { el.classList.add("bm-math-error"); }
  }
}

// ---------- 光标（textContent 偏移，跨装饰 span 稳定） ----------

function caretTextOffset(el) {
  const sel = getSelection();
  if (!sel.rangeCount) return null;
  const range = sel.getRangeAt(0);
  if (!el.contains(range.startContainer)) return null;
  const probe = range.cloneRange();
  probe.selectNodeContents(el);
  probe.setEnd(range.startContainer, range.startOffset);
  return probe.toString().length;
}

function setCaretTextOffset(el, off) {
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  let node, acc = 0;
  while ((node = walker.nextNode())) {
    const len = node.textContent.length;
    if (acc + len >= off) {
      const range = document.createRange();
      range.setStart(node, off - acc);
      range.collapse(true);
      const sel = getSelection();
      sel.removeAllRanges();
      sel.addRange(range);
      return;
    }
    acc += len;
  }
  // 超出：放末尾
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(false);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

function placeCaret(el, atEnd) {
  el.focus();
  const range = document.createRange();
  range.selectNodeContents(el);
  range.collapse(!atEnd);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
}

// 光标激活窗口：光标落在语法结构 [cs,ce) 内 → 定界符加亮
function updateMarksActive() {
  if (!editingCid) return;
  const el = write().querySelector(`[data-cid="${editingCid}"]`);
  if (!el) return;
  const off = caretTextOffset(el);
  if (off === null) return;
  for (const mark of el.querySelectorAll(".bm-mark[data-cs]")) {
    const cs = +mark.dataset.cs, ce = +mark.dataset.ce;
    mark.classList.toggle("bm-mark-active", off > cs && off < ce);
  }
}

// ---------- 编辑态 ----------

function findBlock(cid) { return blocks.find(b => b.cid === cid); }

function enterEdit(cid, atEnd = true) {
  let b = findBlock(cid);
  if (!b) return;
  lastFocusedCid = cid;
  // 代码/公式块优先走 CM（含围栏行回车转换：此时 cid 可能正是编辑中的块，自重入快捷路径不得拦在前面）
  if ((b.type === "code" || b.type === "math") && window.CodeMirror) { mountCmBlock(b, b.type); return; }
  if (editingCid === cid) {   // 已在该块编辑态（空白点击复用空段等）：只归位光标，不走提交（空块会被自删）
    const self = write().querySelector(`[data-cid="${cid}"]`);
    if (self) { placeCaret(self, atEnd); return; }
  }
  commitEditing();
  b = findBlock(cid);         // commitEditing 可能删掉目标块（如空块自删）——重解析防悬垂
  if (!b) return;
  editingCid = cid;
  const el = write().querySelector(`[data-cid="${cid}"]`);
  if (!el) return;
  el.classList.add("bm-editing");
  el.contentEditable = "true";
  el.innerHTML = highlightEditableSource(b.source);
  placeCaret(el, atEnd);
  updateMarksActive();
  syncFocusHighlight();
  refreshFindIfOpen();
}

// findbar 开启期间任何块重渲染都会让 mark 脱钩（计数/跳转失真）——重跑当前查询
function refreshFindIfOpen() {
  const bar = document.getElementById("bm-findbar");
  const input = bar && bar.querySelector("input");
  if (bar && bar.classList.contains("show") && input) runFind(input.value);
}

// 代码块/公式块：CodeMirror 内嵌编辑（kind=code 带语言输入框；kind=math 用 stex 模式）
function mountCmBlock(b, kind) {
  commitEditing();
  const el = write().querySelector(`[data-cid="${b.cid}"]`);
  const lines = b.source.split("\n");
  const isMath = kind === "math";
  const lang = isMath ? "" : (lines[0].match(/^```\s*(\S*)/) || [])[1] || "";
  const body = isMath ? mathTex(b.source) : lines.slice(1, lines.length - 1).join("\n");
  el.classList.add("bm-editing", "bm-cm-block");
  el.contentEditable = "false";
  const bar = isMath
    ? `<div class="bm-cm-bar"><span class="bm-cm-lang-label">TeX</span><span class="bm-cm-hint">Esc 完成</span></div>`
    : `<div class="bm-cm-bar"><input class="bm-lang-input" value="${escapeHtml(lang)}" placeholder="语言" spellcheck="false"><span class="bm-cm-hint">Esc 完成</span></div>`;
  el.innerHTML = bar + `<div class="bm-cm-host"></div>`;
  const cm = CodeMirror(el.querySelector(".bm-cm-host"), {
    value: body, mode: isMath ? "stex" : cmModeFor(lang), lineNumbers: !isMath, indentUnit: 4, tabSize: 4,
    extraKeys: { "Esc": () => commitEditing() },
  });
  const langInput = el.querySelector(".bm-lang-input");
  editingCm = { cid: b.cid, cm, langInput, kind, baseline: b.source, baselineLang: lang };
  // blur 延迟提交须校验身份：定时器跨块存活时 editingCm 可能已换人（前一个 CM 的陈旧回调不得提交新 CM）
  cm.on("blur", () => setTimeout(() => {
    if (editingCm && editingCm.cm === cm && document.activeElement !== editingCm.langInput) commitEditing();
  }, 150));
  if (langInput) langInput.addEventListener("blur", () => setTimeout(() => {
    if (editingCm && editingCm.langInput === langInput && !editingCm.cm.hasFocus()) commitEditing();
  }, 150));
  cm.focus();
}

function commitEditing() {
  if (cellEditing) commitCellEdit();   // 单元格先落盘（其 rerender 可能重建整块 DOM）
  // CodeMirror 分支
  if (editingCm) {
    const { cid, cm, langInput, kind, baseline, baselineLang } = editingCm;
    const b = findBlock(cid);
    editingCm = null;
    const el = write().querySelector(`[data-cid="${cid}"]`);
    if (b && el) {
      const body = cm.getValue().replace(/\s+$/, "");
      const lang = kind === "math" ? "" : (langInput.value || "").trim();
      const composed = kind === "math" ? "$$\n" + body + "\n$$"
        : "```" + lang + (body ? "\n" + body : "") + "\n```";
      // 无变更短路：不进 undo 栈、不误标文档已编辑（旧实现 Esc 必 push 一次同值快照）
      if (composed === baseline && lang === baselineLang) {
        rerenderBlock(b);
        return;
      }
      pushHistory(true);
      if (body.trim() === "" && !lang) {
        if (blocks.length > 1) blocks = blocks.filter(x => x.cid !== cid);
        renderAll();
      } else if (kind === "math") {
        b.source = "$$\n" + body + "\n$$";
        reclassify(b);
        rerenderBlock(b);
      } else {
        b.source = "```" + lang + (body ? "\n" + body : "") + "\n```";
        reclassify(b);
        rerenderBlock(b);
      }
      notifyChanged();
    }
    return;
  }
  // contenteditable 分支
  if (!editingCid) return;
  const b = findBlock(editingCid);
  const el = write().querySelector(`[data-cid="${editingCid}"]`);
  if (!b || !el) { editingCid = null; return; }
  // "编辑态 el 的 textContent == 源码" 只在可编辑时成立；若期间块被重渲染成渲染态
  // （如围栏转换 renderAll 后），可见文本不是源码 —— 以 b.source 为准，禁止回写清空
  const newSource = el.isContentEditable ? el.textContent.replace(/\u00a0/g, " ") : b.source;
  el.contentEditable = "false";
  el.classList.remove("bm-editing");
  syncFocusHighlight();
  if (newSource.trim() === "" && blocks.length > 1) {
    pushHistory(true);   // 冻结为上次提交态：undo 复活被删块的原文
    editingCid = null;
    blocks = blocks.filter(x => x.cid !== b.cid);
    renderAll();
    notifyChanged();
    return;
  }
  if (newSource === b.source) {
    reclassify(b, blocks[0] === b);   // 字面未变但活体类型可能与旧 source 分叉（对齐后重渲）
    editingCid = null;
    rerenderBlock(b);
    return;
  }
  pushHistory(true); // 冻结为上次提交态（旧 source+旧类型）：undo = 回滚整个编辑会话
  editingCid = null;
  b.source = newSource;
  reclassify(b, blocks[0] === b);
  rerenderBlock(b);
  notifyChanged();
}

// ---------- 历史栈 ----------

// 快照经 withLiveBlocks 一致化：活体 type 必须配活文本 source，否则 undo 恢复出"渲染 h1/磁盘段落"嵌合态
function snapshot() { return withLiveBlocks(() => JSON.stringify(blocks)); }

// 冻结快照（提交路径专用）：编辑中块回退为"上次提交态"——旧 source 配按旧 source 重判的类型。
// undo 语义 = 回滚整个编辑会话（快照若取活文本，Esc 提交后 ⌘Z 会变成空转）
function snapshotFrozen() {
  const b0 = editingCid ? findBlock(editingCid) : null;
  let revert = null;
  if (b0) {
    revert = { b: b0, props: { ...b0 } };
    const info = classifyBlock(b0.source);
    b0.type = info.type;
    if (info.type === "heading") b0.level = info.level; else delete b0.level;
    if (info.type === "code") b0.lang = info.lang; else delete b0.lang;
    if (info.tasks) b0.tasks = true; else delete b0.tasks;
  }
  const s = JSON.stringify(blocks);
  if (revert) Object.assign(revert.b, revert.props);
  return s;
}
function pushHistory(frozen) {
  undoStack.push(frozen ? snapshotFrozen() : snapshot());
  if (undoStack.length > 300) undoStack.shift();
  redoStack = [];
}
function restore(snap) {
  cellEditing = null;
  editingCm = null;
  blocks = JSON.parse(snap);
  renderAll();
  editingCid = null;
  notifyChanged();
}
function undo() {
  if (!undoStack.length) return;
  commitEditing();
  redoStack.push(snapshot());
  restore(undoStack.pop());
}
function redo() {
  if (!redoStack.length) return;
  commitEditing();
  undoStack.push(snapshot());
  restore(redoStack.pop());
}

// ---------- 变更通知（防抖推送原生） ----------

function notifyChanged() {
  updateStatus();
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    Bridge.call("document.syncContent", { content: getMarkdown() });
    Bridge.call("document.updateChangeCount", {});
  }, 400);
}

let savedTick = "";
function updateStatus() {
  const el = document.getElementById("bm-status");
  if (!el) return;
  const text = getMarkdown();
  const cjk = (text.match(/[\u4e00-\u9fff\u3040-\u30ff]/g) || []).length;
  const words = (text.replace(/[\u4e00-\u9fff\u3040-\u30ff]/g, " ").match(/[A-Za-z0-9_'-]+/g) || []).length;
  el.textContent = `${blocks.length} 块 · ${cjk + words} 字 · ${text.split("\n").length} 行${savedTick}`;
}

// ---------- 块操作 ----------

function newCid() {
  let n = 1;
  const used = new Set(blocks.map(b => b.cid));
  while (used.has("b" + n)) n++;
  return "b" + n;
}

function insertBlockAfter(cid) {
  const nb = { cid: newCid(), type: "paragraph", source: "" };
  const idx = blocks.findIndex(b => b.cid === cid);
  blocks.splice(idx + 1, 0, nb);
  renderAll();
  enterEdit(nb.cid);
  return nb;
}

function focusSibling(cid, dir, atEnd) {
  const idx = blocks.findIndex(b => b.cid === cid);
  const t = blocks[idx + dir];
  if (t) enterEdit(t.cid, dir > 0 ? false : true);
  return !!t;
}

function wrapSelection(delim) {
  const el = editingCid ? write().querySelector(`[data-cid="${editingCid}"]`) : null;
  if (!el) return;
  const sel = getSelection();
  if (!sel.rangeCount || !el.contains(sel.anchorNode)) return;
  const range = sel.getRangeAt(0);
  const probe = range.cloneRange();
  probe.selectNodeContents(el);
  probe.setEnd(range.startContainer, range.startOffset);
  const start = probe.toString().length;
  const len = range.toString().length;
  let text = el.textContent;
  const closeMap = { "[": "]" };
  const close = closeMap[delim] || delim;
  if (len > 0) {
    text = text.slice(0, start) + delim + text.slice(start, start + len) + close + text.slice(start + len);
  } else {
    text = text.slice(0, start) + delim + close + text.slice(start);
  }
  el.textContent = text;
  relightEditing();
  // 光标放回结构内（包裹后内容起点 delim.length 处）
  setCaretTextOffset(el, start + delim.length + (len > 0 ? len : 0));
}

// 格式命令中枢（原生格式菜单入口）
let lastFocusedCid = null;   // 空闲态（Esc 提交后）格式命令的作用块
function format(cmd) {
  const targetCid = editingCid || lastFocusedCid || (blocks.length ? blocks[0].cid : null);
  if (!targetCid) return;
  const b = findBlock(targetCid);
  if (!b) return;
  const inline = { bold: "**", italic: "*" };
  if (cmd === "bold" || cmd === "italic") {
    if (editingCid) { wrapSelection(inline[cmd]); return; }
    // 渲染态选区：捕获选中文本，进编辑态后在源码中唯一定位并包裹（旧实现无条件行尾插 ****）
    const selText = String(getSelection());
    enterEdit(targetCid, true);
    setTimeout(() => {
      const el = write().querySelector(`[data-cid="${targetCid}"]`);
      if (!el) return;
      const at = selText ? el.textContent.indexOf(selText) : -1;
      if (at >= 0 && el.textContent.indexOf(selText, at + 1) === -1) {
        const d = inline[cmd];
        el.textContent = el.textContent.slice(0, at) + d + selText + d + el.textContent.slice(at + selText.length);
        relightEditing();
        setCaretTextOffset(el, at + d.length + selText.length);
      } else {
        wrapSelection(inline[cmd]);   // 无选区/文本不唯一：保守退化为行尾插定界对
      }
    }, 30);
    return;
  }
  const heads = ["h1", "h2", "h3", "h4", "h5", "h6"];
  if (heads.includes(cmd)) {
    pushHistory();
    const lvl = +cmd[1];
    if (editingCid === targetCid) {
      // 编辑中：以 DOM 活文本为基准就地变换，保持编辑态与光标（rerender 会打断编辑）
      const edEl = write().querySelector(`[data-cid="${targetCid}"]`);
      if (!edEl) return;
      const live = edEl.textContent.replace(/\u00a0/g, " ").replace(/^#{1,6}\s+/, "");
      b.source = "#".repeat(lvl) + " " + live;
      reclassify(b);
      edEl.dataset.type = b.type;
      if (b.level) edEl.dataset.level = String(b.level); else delete edEl.dataset.level;
      edEl.innerHTML = highlightEditableSource(b.source);
      placeCaret(edEl, true);
      updateMarksActive();
      notifyChanged();
      return;
    }
    b.source = b.source.replace(/^#{1,6}\s+/, "").replace(/^(?=#)/, "#".repeat(lvl) + " ");
    reclassify(b);
    rerenderBlock(b);
    notifyChanged();
    return;
  }
  const inserts = {
    table: "| 列A | 列B |\n| --- | --- |\n|  |  |",
    code: "```\n\n```",
    math: "$$\n\n$$",
    quote: "> ",
    hr: "---",
  };
  if (inserts[cmd]) {
    commitEditing();   // 先落活文本——renderAll 会抹掉编辑态 DOM，未提交即重建=静默丢字
    const idx0 = blocks.findIndex(x => x.cid === targetCid);
    const at = idx0 === -1 ? blocks.length - 1 : idx0;   // 目标块可能被提交自删（空块）
    const nb = { cid: newCid(), type: "paragraph", source: inserts[cmd] };
    pushHistory();
    blocks.splice(at + 1, 0, nb);
    renderAll();
    if (cmd === "code" || cmd === "math") { /* 点击进入 CM 编辑 */ }
    else enterEdit(nb.cid);
    notifyChanged();
  }
}

function flashJump(el) {
  el.scrollIntoView({ behavior: "smooth", block: "center" });
  el.classList.add("bm-flash");
  setTimeout(() => el.classList.remove("bm-flash"), 700);
}

// ---------- 表格单元格就地编辑（渲染态 td/th；Tab/Enter 导航） ----------

let cellEditing = null; // {cid, td}

function enterCellEdit(blockEl, td) {
  if (!td) return;
  if (cellEditing) commitCellEdit();   // 先提交上一格；其重渲染会替换整块 DOM
  // 上一步 rerenderBlock 后入参 td 可能已脱离 DOM（双击/直接点另一格）：按 r/c 重新解析
  const r = td.dataset.r, c = td.dataset.c;
  blockEl = write().querySelector(`[data-cid="${blockEl.dataset.cid}"]`) || blockEl;
  td = blockEl.querySelector(`td[data-r="${r}"][data-c="${c}"], th[data-r="${r}"][data-c="${c}"]`) || td;
  const b = findBlock(blockEl.dataset.cid);
  if (!b) return;
  const src = tableGetCell(b.source, +r, +c) ?? "";
  td.textContent = src;                    // 显示该格源码（与整块编辑模型一致）
  td.classList.add("bm-cell-editing");
  td.focus();
  const range = document.createRange();
  range.selectNodeContents(td);
  const sel = getSelection();
  sel.removeAllRanges();
  sel.addRange(range);                      // 全选：输入即替换
  cellEditing = { cid: b.cid, td };
}

function commitCellEdit() {
  if (!cellEditing) return;
  const { cid, td } = cellEditing;
  cellEditing = null;
  td.classList.remove("bm-cell-editing");
  const b = findBlock(cid);
  const r = +td.dataset.r, c = +td.dataset.c;
  const text = td.textContent.replace(/\u00a0/g, " ");
  if (!b) return;
  if (text !== (tableGetCell(b.source, r, c) ?? "")) {
    pushHistory();
    b.source = tableSetCell(b.source, r, c, text);
    reclassify(b);
    notifyChanged();
  }
  rerenderBlock(b);   // 恢复行内格式渲染（焦点已转移时安全）
}

function moveCell(td, dir) {
  const cid = td.closest(".bm-block").dataset.cid;
  const cells = [...td.closest("table").querySelectorAll("td[data-r], th[data-r]")];
  const next = cells[cells.indexOf(td) + dir];
  if (!next) { commitCellEdit(); return; }
  const nr = next.dataset.r, nc = next.dataset.c;
  commitCellEdit();
  const blockEl = write().querySelector(`[data-cid="${cid}"]`);
  if (blockEl) enterCellEdit(blockEl, blockEl.querySelector(`[data-r="${nr}"][data-c="${nc}"]`));
}

function moveCellDown(td) {
  const cid = td.closest(".bm-block").dataset.cid;
  const c = +td.dataset.c, r = +td.dataset.r;
  const below = [...td.closest("table").querySelectorAll(`td[data-c="${c}"], th[data-c="${c}"]`)]
    .find(x => +x.dataset.r > r);
  if (below) { moveCellTo(cid, below.dataset.r, below.dataset.c); return; }
  // 末行：提交并在表格后进入段落（无则新建）
  commitCellEdit();
  const b = findBlock(cid);
  const idx = blocks.findIndex(x => x.cid === cid);
  if (!b || idx === -1) return;
  let next = blocks[idx + 1];
  if (!next || next.type !== "paragraph") {
    next = { cid: newCid(), type: "paragraph", source: "" };
    pushHistory();
    blocks.splice(idx + 1, 0, next);
    renderAll();
    notifyChanged();
  }
  enterEdit(next.cid);
}

function moveCellTo(cid, r, c) {
  commitCellEdit();
  const blockEl = write().querySelector(`[data-cid="${cid}"]`);
  if (blockEl) enterCellEdit(blockEl, blockEl.querySelector(`[data-r="${r}"][data-c="${c}"]`));
}

// 空白区点击（#write 的 padding / 两侧留白没有块可点；空文档整页几乎都是死区）
// 命中块竖直范围 → 进该块；点在首块之上 → 首块开头；块下方 → 段落收光标 / 其余类型补空段
function focusBlankAreaAt(y) {
  const els = [...write().querySelectorAll(".bm-block")];
  if (!els.length) return;
  if (y < els[0].getBoundingClientRect().top) { enterEdit(blocks[0].cid, false); return; }
  let hit = null, above = null;
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (y >= r.top && y <= r.bottom) { hit = el; break; }
    if (r.bottom <= y) above = el;
  }
  if (hit) { enterEdit(hit.dataset.cid, true); return; }
  if (above) {
    const b = findBlock(above.dataset.cid);
    if (b && b.type === "paragraph") { enterEdit(b.cid, true); return; }
    insertParagraphAfterBlock(b.cid);
  }
}

function insertParagraphAfterBlock(cid) {
  commitEditing();   // 先落活文本（renderAll 会抹掉编辑态 DOM；空块此时可能被自删）
  let idx = blocks.findIndex(x => x.cid === cid);
  if (idx === -1) idx = blocks.length - 1;   // 目标块被提交自删 → 追加到文末
  const last = blocks[idx];
  if (idx === blocks.length - 1 && last.type === "paragraph" && last.source === "") {
    enterEdit(last.cid, true);
    return;
  }
  const nb = { cid: newCid(), type: "paragraph", source: "" };
  pushHistory();
  blocks.splice(idx + 1, 0, nb);
  renderAll();
  enterEdit(nb.cid);
}

// ---------- 表格结构编辑（右键菜单命令；操作后光标进焦点格续写） ----------

function runTableCommand(cmd, data) {
  const cid = data.cid || "";
  const b = findBlock(cid);
  if (!b || b.type !== "table") return;
  const r = +data.tr, c = +data.tc;
  commitEditing();   // 先落所有编辑态活文本（删表 renderAll 会抹掉别处编辑中的 DOM）
  if (cmd === "table.preview") { openTableZoom(cid); return; }
  if (cmd === "table.deleteTable") {
    pushHistory();
    blocks = blocks.filter(x => x.cid !== cid);
    if (!blocks.length) blocks = [{ cid: newCid(), type: "paragraph", source: "" }];
    renderAll();
    notifyChanged();
    return;
  }
  let next = null, focusAt = null;
  switch (cmd) {
    case "table.insertRowAbove": next = tableInsertRow(b.source, r); focusAt = { r, c }; break;
    case "table.insertRowBelow": next = tableInsertRow(b.source, r + 1); focusAt = { r: r + 1, c }; break;
    case "table.deleteRow": next = tableDeleteRow(b.source, r); focusAt = { r: Math.max(1, r), c }; break;
    case "table.insertColLeft": next = tableInsertCol(b.source, c); focusAt = { r, c }; break;
    case "table.insertColRight": next = tableInsertCol(b.source, c + 1); focusAt = { r, c: c + 1 }; break;
    case "table.deleteCol": next = tableDeleteCol(b.source, c); focusAt = { r, c }; break;
  }
  if (next === null || next === b.source) return;   // 越界/守卫命中 → 无操作
  pushHistory();
  b.source = next;
  reclassify(b);
  rerenderBlock(b);
  notifyChanged();
  const t = tableParse(b.source);
  if (!t || !focusAt) return;
  const rr = Math.min(focusAt.r, t.rows.length - 1);
  const cc = Math.min(focusAt.c, Math.max(...t.rows.map(row => row.length)) - 1);
  const blockEl = write().querySelector(`[data-cid="${cid}"]`);
  const td = blockEl && blockEl.querySelector(`[data-r="${rr}"][data-c="${cc}"]`);
  if (td) enterCellEdit(blockEl, td);
}

// ---------- 查找 ⌘F ----------

let findHits = [];
let findIdx = -1;

function openFindBar(prefill) {
  let bar = document.getElementById("bm-findbar");
  if (!bar) {
    bar = document.createElement("div");
    bar.id = "bm-findbar";
    bar.innerHTML = `<input placeholder="查找" spellcheck="false"><span class="bm-find-count"></span>` +
      `<button type="button" data-act="prev" title="上一个">↑</button>` +
      `<button type="button" data-act="next" title="下一个">↓</button>` +
      `<button type="button" data-act="close" title="关闭">✕</button>`;
    document.body.appendChild(bar);
    const input = bar.querySelector("input");
    input.addEventListener("input", () => runFind(input.value));
    input.addEventListener("keydown", e => {
      if (e.key === "Enter") { e.preventDefault(); jumpFind(e.shiftKey ? -1 : 1); }
      if (e.key === "Escape") { e.preventDefault(); closeFindBar(); }
    });
    bar.addEventListener("mousedown", e => { if (e.target === bar) e.preventDefault(); }); // 保输入焦点
    bar.addEventListener("click", e => {
      const btn = e.target.closest("button");
      if (!btn) return;
      if (btn.dataset.act === "next") jumpFind(1);
      else if (btn.dataset.act === "prev") jumpFind(-1);
      else closeFindBar();
    });
  }
  bar.classList.add("show");
  const input = bar.querySelector("input");
  if (prefill !== undefined) input.value = prefill;
  input.focus();
  if (input.value) runFind(input.value);
  else input.select();
}

function runFind(q) {
  clearFindMarks();
  findHits = [];
  findIdx = -1;
  const count = document.querySelector("#bm-findbar .bm-find-count");
  if (!q) { if (count) count.textContent = ""; return; }
  const lq = q.toLowerCase();
  for (const el of write().querySelectorAll(".bm-block")) {
    if (el.classList.contains("bm-cm-block")) continue;
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
      acceptNode: n => n.parentElement?.closest(".bm-hit, .bm-mark")
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    let node;
    while ((node = walker.nextNode())) {
      const lower = node.textContent.toLowerCase();
      const idx = lower.indexOf(lq);
      if (idx === -1) continue;
      const range = document.createRange();
      range.setStart(node, idx);
      range.setEnd(node, idx + q.length);
      const mark = document.createElement("mark");
      mark.className = "bm-hit";
      try { range.surroundContents(mark); findHits.push(mark); } catch (_) {}
    }
  }
  if (findHits.length) jumpFind(1, true);
  if (count) count.textContent = findHits.length ? `1/${findHits.length}` : "无结果";
}

function jumpFind(dir, first) {
  if (!findHits.length) return;
  if (first) findIdx = 0;
  else findIdx = (findIdx + dir + findHits.length) % findHits.length;
  for (const m of findHits) m.classList.remove("bm-hit-cur");
  const cur = findHits[findIdx];
  cur.classList.add("bm-hit-cur");
  cur.scrollIntoView({ block: "center" });
  const count = document.querySelector("#bm-findbar .bm-find-count");
  if (count) count.textContent = `${findIdx + 1}/${findHits.length}`;
}

function clearFindMarks() {
  for (const m of [...document.querySelectorAll("mark.bm-hit")]) {
    const parent = m.parentNode;
    if (!parent) continue;
    while (m.firstChild) parent.insertBefore(m.firstChild, m);
    parent.removeChild(m);
    parent.normalize();
  }
}

function closeFindBar() {
  clearFindMarks();
  findHits = [];
  document.getElementById("bm-findbar")?.classList.remove("show");
  write().focus();
}

// ---------- 表格放大视图（宽表免横向搓动：hover 按钮 / 右键进入，全屏只读大表） ----------

function openTableZoom(cid) {
  commitEditing();   // 取最新已提交源码（单元格/块编辑先行落盘）
  const b = findBlock(cid);
  if (!b || b.type !== "table") return;
  let ov = document.getElementById("bm-table-zoom");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "bm-table-zoom";
    ov.innerHTML = `<div class="bm-table-zoom-card">` +
      `<div class="bm-table-zoom-bar"><span class="bm-table-zoom-title"></span>` +
      `<span>只读预览 · Esc 关闭</span><button type="button" class="bm-zoom-reset" title="恢复自动列宽">重置列宽</button>` +
      `<button type="button" title="关闭">\u2715</button></div>` +
      `<div class="bm-table-zoom-scroll"></div></div>`;
    document.body.appendChild(ov);
    ov.addEventListener("mousedown", e => { if (e.target === ov) closeTableZoom(); });   // 点背景关
    ov.querySelector(".bm-table-zoom-bar button").addEventListener("click", closeTableZoom);
    document.addEventListener("keydown", e => {
      if (e.key === "Escape" && document.getElementById("bm-table-zoom")?.classList.contains("show")) {
        e.preventDefault();
        e.stopPropagation();
        closeTableZoom();
      }
    }, true);   // 捕获阶段抢在块编辑 Esc 之前
  }
  ov.querySelector(".bm-table-zoom-title").textContent = `${tableParse(b.source)?.rows.length || 0} 行`;
  const scroll = ov.querySelector(".bm-table-zoom-scroll");
  scroll.innerHTML = renderTable(b.source);
  for (const cell of scroll.querySelectorAll("td, th")) cell.removeAttribute("contenteditable");   // 只读
  ov.classList.add("show");   // 先显示再量宽（display:none 时 offsetWidth 恒 0）
  // 卡片宽度按 auto 表宽钉死（上限 94vw）：列宽拖拽的百分比基准自此稳定，
  // 切 fixed 布局后总宽不随内容涨缩（否则收缩到内容宽的卡片会被百分比反推着膨胀）
  const card = ov.querySelector(".bm-table-zoom-card");
  const autoW = (scroll.querySelector("table")?.offsetWidth || 0) + 40;
  card.style.width = Math.min(autoW, Math.round(window.innerWidth * 0.94)) + "px";
  initZoomColResize(ov);
}

// 大视图列宽拖拽（Excel 式）：拖边界 = 相邻两列按百分比此消彼长，总宽恒 100%（零横滚保证不破）。
// 首次拖拽才从 auto 布局固化为百分比（table-layout:fixed）；每列下限 4% 防压死；双击/按钮重置回 auto。
const ZOOM_COL_MIN_PCT = 4;
let zoomColReset = null;

function initZoomColResize(ov) {
  const table = ov.querySelector(".bm-table-zoom-scroll table");
  const ths = table ? [...table.querySelectorAll("thead th")] : [];
  const resetBtn = ov.querySelector(".bm-zoom-reset");
  zoomColReset = null;
  if (!table || ths.length < 2) { if (resetBtn) resetBtn.style.display = "none"; return; }
  if (resetBtn) resetBtn.style.display = "";
  let pcts = null;   // null = 自动布局

  const reset = () => {
    pcts = null;
    table.style.tableLayout = "";
    for (const th of ths) th.style.width = "";
  };
  zoomColReset = reset;
  if (resetBtn && !resetBtn.dataset.wired) {
    resetBtn.dataset.wired = "1";
    resetBtn.addEventListener("click", () => zoomColReset && zoomColReset());
  }

  for (let i = 0; i < ths.length - 1; i++) {
    const h = document.createElement("div");
    h.className = "bm-zoom-colhandle";
    h.title = "拖动调整列宽（双击重置）";
    ths[i].appendChild(h);
    h.addEventListener("pointerdown", e => {
      e.preventDefault();   // 阻止拖拽中选中文本
      if (!pcts) {
        // 固化当前 auto 布局的列宽为百分比基线
        const total = ths.reduce((a, th) => a + th.offsetWidth, 0) || 1;
        pcts = ths.map(th => (th.offsetWidth / total) * 100);
      }
      const startX = e.clientX;
      const base = [...pcts];
      const pairSum = base[i] + base[i + 1];
      const totalW = table.offsetWidth || 1;
      try { h.setPointerCapture(e.pointerId); } catch (_) { /* 合成事件无活动指针 */ }
      const move = ev => {
        const d = ((ev.clientX - startX) / totalW) * 100;
        // 下限钳制内保持 pair 守恒：moved 落在 [MIN, pairSum-MIN]
        const moved = Math.min(Math.max(base[i] + d, ZOOM_COL_MIN_PCT), pairSum - ZOOM_COL_MIN_PCT);
        pcts[i] = moved;
        pcts[i + 1] = pairSum - moved;
        table.style.tableLayout = "fixed";
        ths.forEach((th, k) => { th.style.width = pcts[k] + "%"; });
      };
      const up = () => {
        h.removeEventListener("pointermove", move);
        h.removeEventListener("pointerup", up);
        h.removeEventListener("pointercancel", up);
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", up);
      h.addEventListener("pointercancel", up);
    });
    h.addEventListener("dblclick", () => zoomColReset && zoomColReset());
  }
}

function closeTableZoom() {
  document.getElementById("bm-table-zoom")?.classList.remove("show");
}

// ---------- 图片预览（lightbox） ----------

function openLightbox(src) {
  let lb = document.getElementById("bm-lightbox");
  if (!lb) {
    lb = document.createElement("div");
    lb.id = "bm-lightbox";
    lb.innerHTML = "<img alt=\"预览\">";
    lb.addEventListener("click", () => lb.classList.remove("show"));
    document.body.appendChild(lb);
  }
  lb.querySelector("img").src = src;
  lb.classList.add("show");
}

// ---------- 粘贴核心（URL 智能粘贴：选中文本 + URL → [文本](URL)） ----------

const pasteTargets = new Map();   // 贴图 marker → 目标块 cid（落盘异步往返期防悬死）

function insertPastedText(el, text) {
  const sel = getSelection();
  const selText = (sel.rangeCount && el.contains(sel.anchorNode)) ? String(sel) : "";
  const trimmed = text.trim();
  if (selText && /^https?:\/\/\S+$/i.test(trimmed)) {
    document.execCommand("insertText", false, `[${selText}](${trimmed})`);
    return;
  }
  document.execCommand("insertText", false, text);
}

// ---------- 事件 ----------

function bindEvents() {
  const w = write();

  w.addEventListener("mousedown", e => {
    if (sourceMode) return;
    if (e.button !== 0) return;   // 右键交给 contextmenu（不再闪现源码编辑态）；中键系统自理
    if (e.target.closest && e.target.closest(".bm-table-zoom-btn")) {
      e.preventDefault();
      const blockEl = e.target.closest(".bm-block");
      if (blockEl) openTableZoom(blockEl.dataset.cid);
      return;
    }
    const blockEl = e.target.closest(".bm-block");
    if (!blockEl) return;
    const a = e.target.closest("a");
    if (a && blockEl.dataset.cid !== editingCid) {
      e.preventDefault();
      Bridge.call("path.openURL", { url: a.getAttribute("href") });
      return;
    }
    // 任务勾选：翻转源码 [ ]/[x] 并重渲染
    const box = e.target.closest(".bm-task-box");
    if (box && blockEl.dataset.cid !== editingCid) {
      e.preventDefault();
      const b = findBlock(blockEl.dataset.cid);
      if (b) {
        pushHistory();
        b.source = toggleTaskItem(b.source, +box.dataset.index);
        reclassify(b);
        rerenderBlock(b);
        notifyChanged();
      }
      return;
    }
    // 脚注引用 ↔ 定义 互跳
    const fnref = e.target.closest(".bm-fnref");
    if (fnref) {
      e.preventDefault();
      const def = write().querySelector(`.bm-fndef[data-fn="${CSS.escape(fnref.dataset.fn)}"]`);
      if (def) flashJump(def);
      return;
    }
    const fndef = e.target.closest(".bm-fndef");
    if (fndef && blockEl.dataset.cid !== editingCid) {
      e.preventDefault();
      const ref = write().querySelector(`.bm-fnref[data-fn="${CSS.escape(fndef.dataset.fn)}"]`);
      if (ref) flashJump(ref);
      return;
    }
    if (editingCm && editingCm.cid === blockEl.dataset.cid) return; // CM 内点击交还 CM
    // 图片预览：渲染态点击图片 → lightbox
    if (e.target.closest("img") && blockEl.dataset.cid !== editingCid) {
      e.preventDefault();
      openLightbox(e.target.closest("img").src);
      return;
    }
    // 表格单元格就地编辑（不进整块编辑态）
    const td = e.target.closest("td[data-r], th[data-r]");
    if (td && blockEl.dataset.cid !== editingCid) {
      e.preventDefault();
      enterCellEdit(blockEl, td);
      return;
    }
    if (blockEl.dataset.cid !== editingCid) {
      e.preventDefault();
      enterEdit(blockEl.dataset.cid);
    }
  });

  // 空白区点击兜底（挂在滚动容器上，覆盖 #write padding 与两侧留白；块内点击已被上方处理器消费）
  scroller().addEventListener("mousedown", e => {
    if (sourceMode || e.button !== 0) return;
    if (e.target.closest(".bm-block") || e.target.closest("#bm-source-wrap")) return;
    if (!blocks.length) return;
    e.preventDefault();
    focusBlankAreaAt(e.clientY);
  });

  w.addEventListener("keydown", e => {
    if (sourceMode) return;
    if (e.target.closest && e.target.closest(".bm-cm-block")) {
      if (e.target.closest(".bm-cm-host")) return;   // CodeMirror 自理
      // 语言输入框：Enter/Esc = 确认提交；其余键浏览器自理。
      // （旧守卫只排 .bm-cm-host，语言框回车会落进 Enter 拆块分支把代码块当段落摧毁）
      if (e.key === "Enter" || e.key === "Escape") { e.preventDefault(); commitEditing(); }
      return;
    }
    const blockEl = e.target.closest ? e.target.closest(".bm-block") : e.target.parentElement?.closest(".bm-block");
    if (!blockEl) return;
    const cid = blockEl.dataset.cid;

    // ⌘F 查找（e2e/无菜单环境兜底；app 内由原生菜单触发 findAction）
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      openFindBar();
      return;
    }
    // 表格单元格导航：Tab/Shift+Tab 左右、Enter 下行同列、Esc 提交
    if (cellEditing && e.target === cellEditing.td) {
      if (e.key === "Tab") { e.preventDefault(); moveCell(cellEditing.td, e.shiftKey ? -1 : 1); return; }
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); moveCellDown(cellEditing.td); return; }
      if (e.key === "Escape") { e.preventDefault(); commitCellEdit(); return; }
      return; // 其余键（含 ⌘Z）交给浏览器默认行为，避免整块 undo 打断单元格编辑
    }

    if (e.isComposing) return;   // IME 组合中的 Enter/Backspace 交给输入法
    // Tab：编辑态下阻止默认 —— 渲染态表格格恒为 contenteditable，默认焦点会逃进格内
    // 造成绕过模型的"幽灵输入"（输入事件不认非编辑态祖先，内容一重渲染即蒸发）
    if (e.key === "Tab") { e.preventDefault(); return; }
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      e.shiftKey ? redo() : undo();
      return;
    }
    // ⌘B 加粗 / ⌘I 斜体（编辑态选区包裹）
    if ((e.metaKey || e.ctrlKey) && editingCid === cid && !e.shiftKey) {
      const k = e.key.toLowerCase();
      if (k === "b" || k === "i") {
        e.preventDefault();
        wrapSelection(k === "b" ? "**" : "*");
        return;
      }
    }
    if (e.key === "Enter" && e.shiftKey && !e.isComposing) {
      // 软换行：手动按 textContent 偏移插入换行符（浏览器默认插 <br> 会被 relight 吞掉；
      // execCommand 版本依赖 trusted 事件，合成环境/部分浏览器无效）
      e.preventDefault();
      const el = write().querySelector(`[data-cid="${cid}"]`);
      const off = caretTextOffset(el);
      if (el && off !== null) {
        const t = el.textContent;
        el.textContent = t.slice(0, off) + "\n" + t.slice(off);
        relightEditing();
        setCaretTextOffset(el, off + 1);
      }
      return;
    }
    if (e.key === "Escape" && !e.isComposing) { e.preventDefault(); commitEditing(); return; }
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      pushHistory();   // 必须先于任何 blocks 修改（cur.source 赋值/拆块），否则 undo 丢尾段
      const el = write().querySelector(`[data-cid="${cid}"]`);
      const sel = getSelection();
      let after = "";
      if (sel.rangeCount && el.contains(sel.anchorNode)) {
        const range = sel.getRangeAt(0);
        const probe = range.cloneRange();
        probe.selectNodeContents(el);
        probe.setStart(range.endContainer, range.endOffset);
        after = probe.toString();
        if (after) {
          // 删除 [光标, 块尾]（当前块留头、新块接尾）；此前误删头部导致内容重复丢失
          const cut = document.createRange();
          cut.setStart(range.endContainer, range.endOffset);
          cut.selectNodeContents(el);
          cut.setStart(range.endContainer, range.endOffset);
          cut.deleteContents();
        }
      }
      const cur = findBlock(cid);
      cur.source = el.textContent.replace(/\u00a0/g, " ");
      reclassify(cur);
      // 围栏/公式定界行 + Enter：整块即转代码/公式并进 CM（Typora 流程）。
      // 仅光标在行尾（after 为空）时转换，行中回车仍走常规拆块。
      if (after === "") {
        const fm = cur.source.match(/^```([A-Za-z0-9_+-]*)$/);
        if (fm) {
          cur.source = "```" + fm[1] + "\n```";
          reclassify(cur);
          renderAll();
          enterEdit(cur.cid);   // code → 挂 CodeMirror
          notifyChanged();
          return;
        }
        if (cur.source === "$$") {
          cur.source = "$$\n$$";
          reclassify(cur);
          renderAll();
          enterEdit(cur.cid);   // math → 挂 TeX CM
          notifyChanged();
          return;
        }
      }
      // 同类编辑器惯例：回车延续列表/引用前缀；前缀空项回车 → 消除前缀成段落
      let prefix = "";
      const pm = cur.source.match(/^(\s*)([-*+]\s+|\d+[.)]\s+|>\s?)/);
      if (pm) {
        const itemBody = cur.source.slice(pm[0].length);
        if (after === "" && itemBody.trim() === "") {
          // 空项：消除前缀，光标留在当前块
          cur.source = "";
          reclassify(cur);
          renderAll();
          enterEdit(cur.cid);
          notifyChanged();
          return;
        }
        prefix = pm[2].startsWith(">") ? "> " :
          /^\d/.test(pm[2]) ? (parseInt(pm[2], 10) + 1 + pm[2].replace(/^\d+/, "").replace(/\d+/g, "")) : pm[2];
        // 有序列表序号 +1
        const om = pm[2].match(/^(\d+)([.)]\s+)$/);
        if (om) prefix = (parseInt(om[1], 10) + 1) + om[2];
      }
      const nb = { cid: newCid(), type: "paragraph", source: prefix + after };
      blocks.splice(blocks.findIndex(x => x.cid === cid) + 1, 0, nb);
      renderAll();
      enterEdit(nb.cid);
      notifyChanged();
      return;
    }
    if (e.key === "Backspace" && caretAtStart(blockEl) && !e.isComposing && getSelection().isCollapsed) {
      const idx = blocks.findIndex(x => x.cid === cid);
      if (blockEl.textContent === "") {
        // 空块删除：唯一块删后必须 renderAll 再进编辑（曾因补块不重渲染 → enterEdit 空指针 → 编辑器假死）
        e.preventDefault();
        pushHistory();
        const prevCid = blocks[idx - 1]?.cid;   // 删除前记前块
        blocks = blocks.filter(x => x.cid !== cid);
        editingCid = null;
        if (!blocks.length) blocks = [{ cid: newCid(), type: "paragraph", source: "" }];
        renderAll();
        if (prevCid && findBlock(prevCid)) enterEdit(prevCid);
        else enterEdit(blocks[blocks.length - 1].cid);
        notifyChanged();
        return;
      }
      if (idx > 0) {
        // 行首退格：并块（Typora 式）—— 文本型前块直接拼源码、光标停拼接点；
        // 表格进末格、代码/公式进 CM；其余（hr/frontmatter）进其末尾
        const prev = blocks[idx - 1];
        e.preventDefault();
        const curSrc = blockEl.textContent.replace(/\u00a0/g, " ");
        if (["paragraph", "heading", "quote", "ul", "ol", "footnote"].includes(prev.type)) {
          pushHistory();
          editingCid = null;
          const joinAt = prev.source.length;
          // 剥当前块行首语法前缀（# / - / 1. / >）：合块语义=内容并入，前缀不属于内容
          prev.source += curSrc.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, "");
          reclassify(prev);
          blocks.splice(idx, 1);
          renderAll();
          enterEdit(prev.cid);
          setCaretTextOffset(write().querySelector(`[data-cid="${prev.cid}"]`), joinAt);
          notifyChanged();
        } else if (prev.type === "table") {
          commitEditing();
          const t = tableParse(prev.source);
          const blockEl2 = write().querySelector(`[data-cid="${prev.cid}"]`);
          const rr = t ? t.rows.length - 1 : 0;
          const td = blockEl2 && t && blockEl2.querySelector(`[data-r="${rr}"][data-c="${(t.rows[rr] || []).length - 1}"]`);
          if (td) enterCellEdit(blockEl2, td); else enterEdit(prev.cid, true);
        } else {
          commitEditing();
          enterEdit(prev.cid, true);   // code/math → CM 挂载，光标在末尾
        }
        return;
      }
    }
    // Delete 前向合块：光标在块尾且无选区 → 与后块合并（镜像 Backspace 行首合块）
    if (e.key === "Delete" && caretAtEnd(blockEl) && !e.isComposing && getSelection().isCollapsed) {
      const idx = blocks.findIndex(x => x.cid === cid);
      const next = blocks[idx + 1];
      if (next) {
        e.preventDefault();
        const cur = findBlock(cid);
        const curSrc = blockEl.textContent.replace(/\u00a0/g, " ");
        if (["paragraph", "heading", "quote", "ul", "ol", "footnote"].includes(next.type)) {
          pushHistory();
          editingCid = null;
          cur.source = curSrc + next.source.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/, "");
          reclassify(cur, blocks[0] === cur);
          blocks.splice(idx + 1, 1);
          renderAll();
          enterEdit(cur.cid);
          setCaretTextOffset(write().querySelector(`[data-cid="${cur.cid}"]`), curSrc.length);
          notifyChanged();
        } else if (next.type === "table") {
          commitEditing();
          const blockEl2 = write().querySelector(`[data-cid="${next.cid}"]`);
          const td0 = blockEl2 && blockEl2.querySelector('[data-r="0"][data-c="0"]');
          if (td0) enterCellEdit(blockEl2, td0); else enterEdit(next.cid, false);
        } else {
          commitEditing();
          enterEdit(next.cid, false);   // code/math → CM 挂载，光标在开头
        }
        return;
      }
    }
    if (e.key === "ArrowUp" && caretAtStart(blockEl)) {
      if (focusSibling(cid, -1, true)) e.preventDefault();
    }
    if (e.key === "ArrowDown" && caretAtEnd(blockEl)) {
      if (focusSibling(cid, 1, false)) e.preventDefault();
    }
  });

  // IME 守卫：组合期间禁止重渲染（打断组合会丢字）
  w.addEventListener("compositionstart", () => { composing = true; });
  w.addEventListener("compositionend", () => {
    composing = false;
    relightEditing();
  });

  // 输入 → 重新高亮 + 光标恢复（textContent 偏移跨 span 稳定）
  w.addEventListener("input", e => {
    const el = e.target.closest ? e.target.closest(".bm-editing") : null;
    if (!el || editingCid === null || el.dataset.cid !== editingCid) return;
    if (composing) return;
    relightEditing();
  });

  // 粘贴：图片 → 原生落盘 assets/ 后替换占位；其余强制纯文本
  // （防富文本 DOM 混入破坏 textContent==源码 不变量）
  w.addEventListener("paste", e => {
    const el = e.target.closest ? e.target.closest(".bm-editing") : null;
    if (!el || el.dataset.cid !== editingCid) return;
    e.preventDefault();
    const cd = e.clipboardData;
    const img = cd && [...(cd.items || [])].find(it => it.type.startsWith("image/"));
    if (img) {
      const file = img.getAsFile();
      if (file) {
        const marker = "uploading-" + Date.now();
        const ext = (img.type.split("/")[1] || "png").replace("jpeg", "jpg");
        document.execCommand("insertText", false, `![${marker}](${marker})`);
        pasteTargets.set(marker, editingCid);   // 落盘往返期间用户可能切块/提交，按 cid 找回
        const reader = new FileReader();
        reader.onload = () => Bridge.call("images.savePasted", {
          dataUrl: String(reader.result), ext, marker,
        });
        reader.readAsDataURL(file);
        return;
      }
    }
    const text = cd ? cd.getData("text/plain") : "";
    insertPastedText(el, text);
  });

  // 右键菜单：收集上下文发原生弹菜单，命令回推 menu.onCommand
  w.addEventListener("contextmenu", e => {
    if (sourceMode) return;
    const blockEl = e.target.closest ? e.target.closest(".bm-block") : null;
    if (!blockEl) return;
    e.preventDefault();
    const sel = getSelection();
    const hasSel = sel.rangeCount && String(sel).length > 0;
    const a = e.target.closest("a");
    const img = e.target.closest("img");
    const items = [];
    if (hasSel) items.push({ cmd: "cut", label: "剪切" }, { cmd: "copy", label: "拷贝" });
    items.push({ cmd: "paste", label: "粘贴" });
    if (a) items.push({ sep: true }, { cmd: "openLink", label: "打开链接" }, { cmd: "copyLink", label: "拷贝链接地址" });
    if (img) items.push({ sep: true }, { cmd: "copyImg", label: "拷贝图片地址" }, { cmd: "saveImg", label: "存储图片为…" });
    if (hasSel) items.push({ sep: true }, { cmd: "bold", label: "加粗" }, { cmd: "italic", label: "斜体" });
    // 表格结构编辑：表头行（r=0）不可删/不可上方插；仅剩一列时不可删列
    const td = e.target.closest("td[data-r], th[data-r]");
    let tr, tc;
    if (td && blockEl.dataset.type === "table") {
      tr = +td.dataset.r; tc = +td.dataset.c;
      const t = tableParse(findBlock(blockEl.dataset.cid)?.source || "");
      const cols = t ? Math.max(...t.rows.map(row => row.length)) : 0;
      items.push({ sep: true });
      if (tr >= 1) items.push({ cmd: "table.insertRowAbove", label: "在上方插入行" });
      items.push({ cmd: "table.insertRowBelow", label: "在下方插入行" });
      if (tr >= 1) items.push({ cmd: "table.deleteRow", label: "删除此行" });
      items.push({ sep: true });
      items.push({ cmd: "table.insertColLeft", label: "在左侧插入列" });
      items.push({ cmd: "table.insertColRight", label: "在右侧插入列" });
      if (cols > 1) items.push({ cmd: "table.deleteCol", label: "删除此列" });
      items.push({ sep: true }, { cmd: "table.preview", label: "放大查看表格" }, { cmd: "table.deleteTable", label: "删除表格" });
    }
    const payload = {
      items,
      link: a ? (a.getAttribute("href") || "") : "",
      img: img ? (img.dataset.raw || img.getAttribute("src") || "") : "",
      cid: blockEl.dataset.cid,
    };
    if (td && blockEl.dataset.type === "table") { payload.tr = tr; payload.tc = tc; }
    Bridge.call("menu.showContext", payload);
  });

  // 光标移动 → 定界符激活窗口刷新
  document.addEventListener("selectionchange", () => {
    updateMarksActive();
    if (typewriterMode && editingCid) {
      const sel = getSelection();
      if (sel.rangeCount) {
        const rect = sel.getRangeAt(0).getBoundingClientRect();
        if (rect.height > 0) {
          const scEl = scroller();
          const target = scEl.scrollTop + rect.top - scEl.getBoundingClientRect().top - scEl.clientHeight / 2;
          scEl.scrollTo({ top: Math.max(0, target), behavior: "smooth" });
        }
      }
    }
  });

  w.addEventListener("focusout", e => {
    if (cellEditing && e.target === cellEditing.td) {
      setTimeout(() => {
        if (cellEditing && document.activeElement !== cellEditing.td) commitCellEdit();
      }, 0);
      return;
    }
    const blockEl = e.target.closest ? e.target.closest(".bm-block") : null;
    if (blockEl && blockEl.dataset.cid === editingCid) {
      setTimeout(() => {
        if (!blockEl.isConnected) return;   // 期间块被重渲染/重建（同 cid 新 el）：脱钩 el 不代表当前编辑态
        const sel = getSelection();
        if (!sel.anchorNode || !blockEl.contains(sel.anchorNode)) commitEditing();
      }, 0);
    }
  });
}

// Typora 式活体形态：编辑中每次重高亮都按当前源码重分类块并同步 data-type/level，
// 行首语法（# / - / > / --- …）敲下即改变块排印（CSS 按 data-type 走编辑态字号）。
// 注意 b.source 保持"上次提交值"不动 —— commitEditing 靠它与 DOM 文本的差异驱动
// pushHistory/notifyChanged（自动保存/undo 的事实源）；活文本经 liveMarkdown() 取数。
function relightEditing() {
  if (!editingCid) return;
  const el = write().querySelector(`[data-cid="${editingCid}"]`);
  if (!el) return;
  const src = el.textContent.replace(/\u00a0/g, " ");
  const b = findBlock(editingCid);
  if (b) {
    const info = classifyBlock(src, blocks[0] === b);   // frontmatter 仅文档首块（守恒）
    b.type = info.type;
    if (info.type === "heading") b.level = info.level; else delete b.level;
    if (info.type === "code") b.lang = info.lang; else delete b.lang;
    if (info.tasks) b.tasks = true; else delete b.tasks;
    el.dataset.type = b.type;
    if (b.level) el.dataset.level = String(b.level); else delete el.dataset.level;
  }
  const off = caretTextOffset(el);
  el.innerHTML = highlightEditableSource(src);
  if (off !== null) setCaretTextOffset(el, off);
  updateMarksActive();
  notifyChanged();   // 输入即防抖推送活文本（原生侧 markdown/edited/自动保存全程保鲜）
}

// 三态活文本快照（评审 P0 根因修复）：普通块编辑态活在 DOM、代码/公式块活在
// CodeMirror、单元格活在 td —— 而保存/导出/undo 快照/状态栏全都要读"现在的内容"。
// 借用-恢复写法：临时替换对应块 source → fn() → 还原，不动 blocks 真身与 undo 语义。
function withLiveBlocks(fn) {
  const saved = [];
  const apply = (b, val) => { saved.push([b, b.source]); b.source = val; };
  if (editingCid) {
    const b = findBlock(editingCid);
    const el = write().querySelector(`[data-cid="${editingCid}"]`);
    if (b && el && el.isContentEditable) apply(b, el.textContent.replace(/\u00a0/g, " "));
  }
  if (editingCm) {
    const { cid, cm, langInput, kind } = editingCm;
    const b = findBlock(cid);
    if (b) {
      const body = cm.getValue().replace(/\s+$/, "");
      const lang = ((langInput && langInput.value) || "").trim();
      apply(b, kind === "math" ? "$$\n" + body + "\n$$"
        : "```" + lang + (body ? "\n" + body : "") + "\n```");
    }
  }
  if (cellEditing) {
    const b = findBlock(cellEditing.cid);
    const td = cellEditing.td;
    if (b && td && td.isConnected) {
      const r = +td.dataset.r, c = +td.dataset.c;
      const text = td.textContent.replace(/\u00a0/g, " ");
      if (text !== (tableGetCell(b.source, r, c) ?? "")) {
        apply(b, tableSetCell(b.source, r, c, text));
      }
    }
  }
  try { return fn(); } finally { for (const [b, src] of saved) b.source = src; }
}

function caretAtStart(el) {
  return caretTextOffset(el) === 0;
}
function caretAtEnd(el) {
  const sel = getSelection();
  if (!sel.rangeCount || !el.contains(sel.anchorNode)) return false;
  const range = sel.getRangeAt(0).cloneRange();
  const probe = range.cloneRange();
  probe.selectNodeContents(el);
  probe.setStart(range.endContainer, range.endOffset);
  return probe.toString().length === 0;
}

// ---------- 源码模式（CodeMirror 优先，textarea 兜底） ----------

function toggleSourceMode(force) {
  const hostWrap = document.getElementById("bm-source-wrap");
  const to = force !== undefined ? force : !sourceMode;
  if (to === sourceMode) return;
  commitEditing();
  sourceMode = to;
  if (sourceMode) {
    if (window.CodeMirror) {
      if (!sourceCm) {
        const host = document.createElement("div");
        host.id = "bm-source-cm";
        hostWrap.appendChild(host);
        sourceCm = CodeMirror(host, {
          value: "", mode: "markdown", lineWrapping: true, indentUnit: 2,
        });
        sourceCm.on("change", () => scheduleSourcePush());
      }
      sourceCm.setValue(getMarkdown());
      hostWrap.style.display = "block";
      write().style.display = "none";
      sourceCm.refresh();
      setTimeout(() => sourceCm.focus(), 50);
    } else {
      const ta = document.getElementById("bm-source");
      ta.value = getMarkdown();
      ta.style.display = "block";
      write().style.display = "none";
      ta.focus();
    }
  } else {
    const md = sourceCm ? sourceCm.getValue() : document.getElementById("bm-source").value;
    hostWrap.style.display = "none";
    document.getElementById("bm-source").style.display = "none";
    openMarkdown(md, false);
    write().style.display = "block";
  }
}

function scheduleSourcePush() {
  clearTimeout(changeTimer);
  changeTimer = setTimeout(() => {
    Bridge.call("document.syncContent", { content: sourceCm.getValue() });
    Bridge.call("document.updateChangeCount", {});
  }, 400);
}

// ---------- 对外 API（原生命令入口 + 通知） ----------

function openMarkdown(md, resetHistory = true) {
  cellEditing = null;      // 悬空 td/cm 会把旧文档内容写进新文档同 cid 块
  editingCm = null;
  blocks = parseBlocks(md);
  editingCid = null;
  if (resetHistory) { undoStack = []; redoStack = []; }
  renderAll();
  updateStatus();
}

// 活文本序列化：任何出口（原生拉取/导出/同步推送）都读到三层编辑态的当前内容
function getMarkdown() { return withLiveBlocks(() => serializeBlocks(blocks)); }

function getExportHtml() {
  const body = withLiveBlocks(() => blocks.map(blockHtml).join(""));
  const css = [...document.querySelectorAll("style,link[rel=stylesheet]")]
    .map(n => n.outerHTML).join("\n");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${document.title}</title>${css}</head><body><div id="write" class="write export">${body}</div></body></html>`;
}

function toast(msg) {
  let el = document.querySelector(".bm-toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "bm-toast";
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add("bm-toast-show");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.remove("bm-toast-show"), 3200);
}

function markSaved(auto) {
  const t = new Date();
  const hh = String(t.getHours()).padStart(2, "0"), mm = String(t.getMinutes()).padStart(2, "0");
  savedTick = ` · ${auto ? "已自动保存" : "已保存"} ${hh}:${mm}`;
  updateStatus();
}


// ---------- M3 侧栏（双 dock 面板：文件树/大纲 tab 可拖动分栏 + 边界拖宽；数据由原生 library.* 桥供给） ----------

let sidebarOpen = false;
let libraryRoot = null;      // 侧栏根目录（当前文档所在目录）
let currentFilePath = null;  // 当前文档绝对路径（高亮用）
let fileTreeLoaded = false;
const dirCache = new Map();  // dirPath -> entries[]；值 "loading" 表示请求中
const expandedDirs = new Set();
let searchMode = false;
let searchSeq = 0;

const TAB_NAMES = { files: "文件", outline: "大纲" };
const SIDEBAR_MIN_W = 180, SIDEBAR_MAX_W = 480;
// tab → 停靠侧；panelActive → 各侧当前激活 tab；宽度按侧独立持久化
let sidebarLayout = { files: "left", outline: "left" };
let panelActive = { left: null, right: null };
let sidebarWidths = { left: 240, right: 260 };

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 隐私模式等 */ } },
};
(function restoreSidebarPrefs() {
  try {
    const l = JSON.parse(store.get("bm.sidebar.layout", "null"));
    if (l && TAB_NAMES[l.files] && TAB_NAMES[l.outline]) sidebarLayout = { files: l.files, outline: l.outline };
  } catch { /* 坏数据回默认 */ }
  for (const s of ["left", "right"]) {
    const w = parseInt(store.get("bm.sidebar.w." + s, ""), 10);
    if (w >= SIDEBAR_MIN_W && w <= SIDEBAR_MAX_W) sidebarWidths[s] = w;
  }
})();

const sideEls = side => ({
  panel: document.getElementById(side === "left" ? "bm-sidebar" : "bm-sidebar-right"),
  body: document.getElementById(side === "left" ? "bm-sidebar-body" : "bm-sidebar-body-right"),
  resizer: document.getElementById(side === "left" ? "bm-resizer-left" : "bm-resizer-right"),
});
const sidebarEl = () => document.getElementById("bm-sidebar");
const sidebarBody = () => document.getElementById("bm-sidebar-body");
const filesBody = () => sideEls(sidebarLayout.files).body;

const clampW = w => Math.max(SIDEBAR_MIN_W, Math.min(SIDEBAR_MAX_W, w));

function saveSidebarPrefs() {
  store.set("bm.sidebar.layout", JSON.stringify(sidebarLayout));
  store.set("bm.sidebar.w.left", String(sidebarWidths.left));
  store.set("bm.sidebar.w.right", String(sidebarWidths.right));
}

function toggleSidebar(force) {
  const el = sidebarEl();
  if (!el) return;
  const to = force !== undefined ? force : !sidebarOpen;
  if (to === sidebarOpen) return;
  sidebarOpen = to;
  if (to && !fileTreeLoaded) Bridge.call("library.listDocs", {});
  rebuildSidebar();
}

function setSidebarTab(tab) {
  if (!TAB_NAMES[tab]) return;
  panelActive[sidebarLayout[tab]] = tab;
  if (tab !== "files") searchMode = false;
  rebuildSidebar();
}

// tab 迁移（拖拽落点与测试/快捷指令共用此入口）
function moveSidebarTab(tab, side) {
  if (!TAB_NAMES[tab] || (side !== "left" && side !== "right")) return;
  if (sidebarLayout[tab] === side) return;
  sidebarLayout[tab] = side;
  panelActive[side] = tab;
  saveSidebarPrefs();
  rebuildSidebar();
}

function setSidebarWidth(px, side = "left") {
  if (side !== "left" && side !== "right") return;
  sidebarWidths[side] = clampW(px);
  saveSidebarPrefs();
  rebuildSidebar();
}

// 重建两个面板：tab 按钮 / 搜索框归属 / 显示与宽度，随后渲染内容
function rebuildSidebar() {
  for (const side of ["left", "right"]) {
    const els = sideEls(side);
    if (!els.panel) continue;
    const tabs = Object.keys(TAB_NAMES).filter(t => sidebarLayout[t] === side);
    if (!panelActive[side] || !tabs.includes(panelActive[side])) panelActive[side] = tabs[0] || null;
    els.panel.querySelector(".bm-sidebar-tabs").innerHTML = tabs.map(t =>
      `<button class="bm-sidebar-tab${t === panelActive[side] ? " active" : ""}" data-tab="${t}">${TAB_NAMES[t]}</button>`).join("");
    const show = sidebarOpen && tabs.length > 0;
    els.panel.style.display = show ? "flex" : "none";
    els.resizer.style.display = show ? "block" : "none";
    if (show) els.panel.style.width = sidebarWidths[side] + "px";
  }
  // 搜索框属于 files 所在面板（整体搬移节点，input 监听器不丢）
  const fEl = sideEls(sidebarLayout.files);
  const wrap = document.getElementById("bm-search-wrap");
  if (wrap && fEl.panel && wrap.parentElement !== fEl.panel) fEl.panel.insertBefore(wrap, fEl.body);
  renderSidebarBody();
}

function renderSidebarBody() {
  for (const side of ["left", "right"]) {
    const els = sideEls(side);
    if (!els.body || els.panel.style.display === "none") continue;
    const tab = panelActive[side];
    if (tab === "outline") renderOutline(els.body);
    else if (tab === "files" && !searchMode) renderFileTree(els.body); // 搜索结果不被覆盖
  }
}

function treeDirHtml(dirPath) {
  const entries = dirCache.get(dirPath);
  if (!entries || entries === "loading") return "";
  const kids = entries.map(e => {
    if (e.isDir) {
      const open = expandedDirs.has(e.path);
      return `<div class="bm-tree-dir" data-dir="${escapeHtml(e.path)}">${open ? "\u25BE" : "\u25B8"} ${escapeHtml(e.name)}</div>${open ? treeDirHtml(e.path) : ""}`;
    }
    const active = e.path === currentFilePath ? " active" : "";
    return `<div class="bm-tree-file${active}" data-file="${escapeHtml(e.path)}">${escapeHtml(e.name)}</div>`;
  }).join("");
  return `<div class="bm-tree-children">${kids}</div>`;
}

function renderFileTree(body) {
  body = body || filesBody();
  if (!body) return;
  if (!libraryRoot) { body.innerHTML = '<div class="bm-sidebar-empty">保存文件后可见目录</div>'; return; }
  if (!dirCache.has(libraryRoot)) { body.innerHTML = '<div class="bm-sidebar-empty">加载中…</div>'; return; }
  body.innerHTML = treeDirHtml(libraryRoot) || '<div class="bm-sidebar-empty">空目录</div>';
}

function renderOutline(body) {
  body = body || sideEls(sidebarLayout.outline).body;
  if (!body) return;
  const hs = blocks.filter(b => b.type === "heading");
  if (!hs.length) { body.innerHTML = '<div class="bm-sidebar-empty">无标题</div>'; return; }
  body.innerHTML = hs.map(h => {
    const pad = 8 + (h.level - 1) * 14;
    const text = escapeHtml(h.source.replace(/^#{1,6}\s+/, ""));
    return `<div class="bm-outline-item" data-cid="${h.cid}" style="padding-left:${pad}px">${text}</div>`;
  }).join("");
}

function renderSearchResults(results, query, done) {
  const body = filesBody();
  if (!body) return;
  if (!results.length) {
    body.innerHTML = `<div class="bm-sidebar-empty">${done ? "无匹配" : "搜索中…"}</div>`;
    return;
  }
  const esc = escapeHtml(query).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const mark = t => escapeHtml(t).replace(new RegExp(esc, "gi"), m => `<mark>${m}</mark>`);
  body.innerHTML = results.map(r =>
    `<div class="bm-search-hit" data-file="${escapeHtml(r.path)}">` +
    `<div class="bm-search-hit-file">${escapeHtml(r.name)}:${r.line}</div>` +
    `<div class="bm-search-hit-line">${mark(r.text)}</div></div>`).join("") +
    (done ? "" : '<div class="bm-sidebar-empty">搜索中…</div>');
}

let suppressTabClick = false;

// 边界拖宽：left 越往右越宽；right 越往左越宽
function bindResizer(el, side) {
  if (!el) return;
  el.addEventListener("pointerdown", e => {
    e.preventDefault();
    const startX = e.clientX, startW = sidebarWidths[side];
    document.body.classList.add("bm-resizing");
    const move = ev => {
      const delta = side === "left" ? ev.clientX - startX : startX - ev.clientX;
      sidebarWidths[side] = clampW(startW + delta);
      const els = sideEls(side);
      if (els.panel.style.display !== "none") els.panel.style.width = sidebarWidths[side] + "px";
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      document.body.classList.remove("bm-resizing");
      saveSidebarPrefs();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

// tab 拖拽迁移：位移超阈值进入拖拽，对侧面板显示落点提示（隐藏时临时展开窄落点条），松手按落点判定迁移/取消
function bindTabDrag(tabsEl, side) {
  if (!tabsEl) return;
  tabsEl.addEventListener("pointerdown", e => {
    const tab = e.target.closest(".bm-sidebar-tab");
    if (!tab) return;
    const name = tab.dataset.tab;
    const other = side === "left" ? "right" : "left";
    const target = sideEls(other);
    const sx = e.clientX, sy = e.clientY;
    let dragging = false;
    const move = ev => {
      if (!dragging && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 8) return;
      dragging = true;
      document.body.classList.add("bm-dragging-tab");
      const p = target.panel;
      p.classList.add("bm-drop-hint");
      if (p.style.display === "none") { p.style.width = "120px"; p.style.display = "flex"; }
    };
    const up = ev => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!dragging) return;                     // 纯点击 → click 事件照常切 tab
      suppressTabClick = true;
      document.body.classList.remove("bm-dragging-tab");
      const r = target.panel.getBoundingClientRect();
      const inside = ev.clientX >= r.left - 24 && ev.clientX <= r.right + 24 &&
                     ev.clientY >= r.top - 8 && ev.clientY <= r.bottom + 8;
      target.panel.classList.remove("bm-drop-hint");
      if (inside) moveSidebarTab(name, other);
      else rebuildSidebar();                     // 取消：恢复原布局显示
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  });
}

function bindSidebarEvents() {
  for (const side of ["left", "right"]) {
    const els = sideEls(side);
    if (!els.panel) continue;
    els.panel.querySelector(".bm-sidebar-tabs").addEventListener("click", e => {
      if (suppressTabClick) { suppressTabClick = false; return; }
      const tab = e.target.closest(".bm-sidebar-tab");
      if (tab) setSidebarTab(tab.dataset.tab);
    });
    els.body.addEventListener("click", e => {
      const dir = e.target.closest(".bm-tree-dir");
      if (dir) {
        const path = dir.dataset.dir;
        if (expandedDirs.has(path)) expandedDirs.delete(path);
        else {
          expandedDirs.add(path);
          if (!dirCache.has(path)) { dirCache.set(path, "loading"); Bridge.call("library.listDocs", { path }); }
        }
        if (!searchMode) renderFileTree(els.body);
        return;
      }
      const file = e.target.closest(".bm-tree-file, .bm-search-hit");
      if (file) {
        currentFilePath = file.dataset.file;
        Bridge.call("library.openFile", { path: file.dataset.file });
        if (!searchMode) renderFileTree(els.body);
        return;
      }
      const item = e.target.closest(".bm-outline-item");
      if (item) {
        const target = write().querySelector(`[data-cid="${item.dataset.cid}"]`);
        if (target) flashJump(target);
      }
    });
    bindResizer(els.resizer, side);
    bindTabDrag(els.panel.querySelector(".bm-sidebar-tabs"), side);
  }
  const input = document.getElementById("bm-search-input");
  let timer = null;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      const q = input.value.trim();
      if (!q) { searchMode = false; renderSidebarBody(); return; }
      searchMode = true;
      searchSeq++;
      renderSearchResults([], q, false);
      Bridge.call("library.search", { query: q, seq: searchSeq });
    }, 350);
  });
}

// 原生 → JS：粘贴图片落盘完成（占位 → 替换）。按 marker→cid 定位目标块——
// 落盘期间用户可能已切块（旧实现依赖 editingCid，占位符会悬死落盘/误写他块）。
Bridge.register("images.onSaved", data => {
  const marker = data.marker || "";
  const cid = pasteTargets.has(marker) ? pasteTargets.get(marker) : editingCid;
  pasteTargets.delete(marker);
  const b = findBlock(cid);
  if (!b || !marker) return;
  const oldStr = `![${marker}](${marker})`;
  const newStr = data.url ? `![](${data.url})` : "";
  const el = (editingCid === cid) ? write().querySelector(`[data-cid="${cid}"]`) : null;
  if (el && el.isContentEditable) {
    const off = caretTextOffset(el);
    el.textContent = el.textContent.split(oldStr).join(newStr);
    relightEditing();
    if (off !== null) setCaretTextOffset(el, Math.max(0, off - (oldStr.length - newStr.length)));
  } else {
    b.source = b.source.split(oldStr).join(newStr);
    reclassify(b);
    rerenderBlock(b);
  }
  notifyChanged();
  if (!data.url) toast("图片未保存（未命名文档或写入失败），已移除占位符");
});

// ---------- 打字机 / 专注模式 ----------

let typewriterMode = false, focusMode = false;

function toggleTypewriter() {
  typewriterMode = !typewriterMode;
  write().classList.toggle("bm-typewriter", typewriterMode);
}
function toggleFocusMode() {
  focusMode = !focusMode;
  write().classList.toggle("bm-focus", focusMode);
  syncFocusHighlight();
}
function syncFocusHighlight() {
  for (const el of write().querySelectorAll(".bm-focus-on")) el.classList.remove("bm-focus-on");
  if (!focusMode || !editingCid) { write().removeAttribute("data-focus-cid"); return; }
  write().setAttribute("data-focus-cid", editingCid);
  write().querySelector(`[data-cid="${editingCid}"]`)?.classList.add("bm-focus-on");
}

// 原生 → JS：文档目录基准（图片相对路径解析）
Bridge.register("doc.baseDir", data => {
  assetBase = data.base || "";
  enhanceImages();
});

// 原生 → JS：右键菜单命令回推
Bridge.register("menu.onCommand", data => {
  const cmd = data.cmd || "";
  if (cmd.startsWith("table.")) { runTableCommand(cmd, data); return; }
  if (cmd === "paste" && typeof data.text === "string") {
    // 表格格坐标在 → 进格粘贴（菜单弹窗已吹走原焦点，重定位到右键格）
    if (data.cid && Number.isInteger(+data.tr) && Number.isInteger(+data.tc)) {
      const blockEl = write().querySelector(`[data-cid="${data.cid}"]`);
      const td = blockEl && blockEl.querySelector(
        `td[data-r="${data.tr}"][data-c="${data.tc}"], th[data-r="${data.tr}"][data-c="${data.tc}"]`);
      if (td) { enterCellEdit(blockEl, td); document.execCommand("insertText", false, data.text); return; }
    }
    const el = editingCid ? write().querySelector(`[data-cid="${editingCid}"]`) : null;
    if (el) { insertPastedText(el, data.text); return; }
    if (data.cid) {   // 右键不再预进编辑态：按 cid 进块后落剪贴板文本
      enterEdit(data.cid);
      setTimeout(() => {
        const t = write().querySelector(`[data-cid="${data.cid}"]`);
        if (t) insertPastedText(t, data.text);
      }, 30);
    }
    return;
  }
  if (cmd === "bold" || cmd === "italic") {
    const wrap = () => wrapSelection(cmd === "bold" ? "**" : "*");
    if (!editingCid && data.cid) {
      enterEdit(data.cid);
      setTimeout(wrap, 30);
    } else wrap();
  }
});

// 原生 → JS：主题（#theme_css 动态样式注入）
Bridge.register("theme.apply", data => {
  document.documentElement.dataset.theme = data.name || "default";
  let tag = document.getElementById("theme_css");
  if (!tag) { tag = document.createElement("style"); tag.id = "theme_css"; document.head.appendChild(tag); }
  tag.textContent = data.css || "";
});

// 原生 → JS：library/globalSearch 数据回推
Bridge.register("library.onRoot", data => {
  libraryRoot = data.root;
  currentFilePath = data.current || null;
  expandedDirs.add(data.root);
});
Bridge.register("library.onDocs", data => {
  dirCache.set(data.dir, data.entries || []);
  fileTreeLoaded = true;
  if (sidebarOpen && !searchMode) renderFileTree();
});
Bridge.register("globalSearch.onResults", data => {
  if (data.seq !== searchSeq) return;   // 过期结果丢弃
  renderSearchResults(data.results || [], data.query, !!data.done);
});
Bridge.register("globalSearch.onErrorMsg", data => {
  renderSearchResults([], "", true);
});

window.Editor = {
  open: openMarkdown,
  getMarkdown,
  getExportHtml,
  toggleSourceMode,
  undo, redo,
  toast, markSaved,
  toggleSidebar,
  setSidebarTab,
  moveSidebarTab,
  setSidebarWidth,
  sidebarState: () => ({ layout: { ...sidebarLayout }, active: { ...panelActive }, widths: { ...sidebarWidths }, open: sidebarOpen }),
  toggleTypewriter,
  toggleFocusMode,
  format,
  openFindBar,
  closeFindBar,
  _enterEdit: enterEdit,   // 测试钩子
  _enterCellEdit: (cid, r, c) => {
    const blockEl = write().querySelector(`[data-cid="${cid}"]`);
    const td = blockEl && blockEl.querySelector(`[data-r="${r}"][data-c="${c}"]`);
    if (td) enterCellEdit(blockEl, td);
  },
  _commitCellEdit: commitCellEdit,
  _setCmValue: v => { if (editingCm) editingCm.cm.setValue(v); },   // 测试钩子：CM 活文本注入
  _pasteTargets: () => pasteTargets,                                // 测试钩子：贴图登记表
  _pasteText: insertPastedText,
  _findState: () => ({ hits: findHits.length, idx: findIdx }),
  _assetBase: b => { assetBase = b; enhanceImages(); },
  _editingState: () => ({ editingCid, hasCm: !!editingCm, cellEdit: cellEditing ? { r: cellEditing.td.dataset.r, c: cellEditing.td.dataset.c } : null, markCount: document.querySelectorAll(".bm-mark").length }),
};

// ---------- 启动 ----------

document.addEventListener("DOMContentLoaded", () => {
  if (window.mermaid) mermaid.initialize({ startOnLoad: false, securityLevel: "loose" });
  bindEvents();
  bindSidebarEvents();
  openMarkdown("");
  const ta = document.getElementById("bm-source");
  ta.addEventListener("input", () => {
    clearTimeout(changeTimer);
    changeTimer = setTimeout(() => {
      Bridge.call("document.syncContent", { content: ta.value });
      Bridge.call("document.updateChangeCount", {});
    }, 400);
  });
  ta.addEventListener("keydown", e => {
    if (e.key === "Tab") {
      e.preventDefault();
      ta.setRangeText("  ", ta.selectionStart, ta.selectionEnd, "end");
    }
  });
  Bridge.call("editor.ready", {});
});
