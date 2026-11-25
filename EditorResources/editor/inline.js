// BlockMark — 行内 markdown 渲染（原创实现，MVP 语法集）
// 支持: `code` **strong** *em* [text](url) ![alt](src)
import { tableParse } from "./parser.js";

export function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
}

// 行内语法中"渲染后不可见"的四种结构。落点映射要用同一份规则判断哪些字符不占可见位置，
// 所以提为常量两处共用（两套规则各写一遍必然漂移）。
const INLINE_CODE_RE = /`([^`\n]+)`/g;
const INLINE_MATH_RE = /(^|[^\\$])\$([^\s$]|[^\s$][^$\n]*[^\s$])\$(?!\d)/g;
const FOOTNOTE_REF_RE = /\[\^([^\]\n]+)\](?!\()/g;
const IMAGE_RE = /!\[([^\]]*)\]\(((?:\([^)\s]*\)|[^)\s])+)(?:\s+&quot;((?:(?!&quot;)[^\n])*?)&quot;)?\)/g;
const LINK_RE = /\[([^\]]+)\]\(((?:\([^)\s]*\)|[^)\s])+)(?:\s+&quot;((?:(?!&quot;)[^\n])*?)&quot;)?\)/g;
const ESCAPE_RE = /\\([!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-])/g;

export function renderInline(md) {
  // 1. 先抽出行内代码，占位保护
  const codes = [];
  let s = md.replace(INLINE_CODE_RE, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  // 1.1 反斜杠转义：\X（ASCII 标点）→ 字面 X，不参与任何行内语法（GFM 转义语义）
  const escs = [];
  s = s.replace(ESCAPE_RE, (_, ch) => {
    escs.push(ch);
    return `\u0001${escs.length - 1}\u0001`;
  });
  s = escapeHtml(s);
  // 1.5 行内公式 $...$（两侧贴字、内部无 $；在 strong/em 前处理防止吞掉 TeX 里的 *）
  s = s.replace(INLINE_MATH_RE, (_, pre, tex) =>
    `${pre}<span class="bm-imath" data-tex="${tex}">${tex}</span>`);
  // 1.6 脚注引用 [^id] → 上标
  s = s.replace(FOOTNOTE_REF_RE, (_, id) =>
    `<sup class="bm-fnref" data-fn="${id}">${id}</sup>`);
  // 1.7 URL scheme 白名单：javascript:/data: 等可执行 scheme 一律钝化为 #（防注入软防线）
  const safeUrl = u => /^[a-z][a-z0-9+.-]*:/i.test(u) && !/^(https?|mailto|file):/i.test(u) ? "#" : u;
  // 2. 图片（在链接前处理）；URL 允许一层平衡括号（wiki 风格 (bar)），title 懒匹配到闭合引号（可含 & 等）
  s = s.replace(IMAGE_RE, (_, alt, src, title) =>
      `<img src="${safeUrl(src)}" alt="${alt}"${title ? ` title="${title}"` : ""} loading="lazy">`);
  // 3. 链接
  s = s.replace(LINK_RE, (_, text, href, title) =>
      `<a href="${safeUrl(href)}"${title ? ` title="${title}"` : ""} target="_blank" rel="noopener">${text}</a>`);
  // 4. 粗体（**x** / __x__；内容允许单 * —— 嵌套强调 **a *b* c** 的外层不能被 [^*] 拦死）
  s = s.replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])__([^\n]+?)__(?=$|[\s).,!?，。！？])/g, "$1<strong>$2</strong>");
  // 5. 斜体（*x* 或 _x_，避开词中下划线的粗判；在 strong 之后处理内层）
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?，。！？])|(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?，。！？])/g,
    "$1$3<em>$2$4</em>");
  // 6. 还原行内代码 / 反斜杠转义
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[+i])}</code>`);
  s = s.replace(/\u0001(\d+)\u0001/g, (_, i) => escapeHtml(escs[+i]));
  // 占位符本身若被转义遗漏，兜底清掉
  return s;
}

// 表格文本 → HTML（GFM 简表：单元格带坐标，渲染态可就地编辑）
export function renderTable(source) {
  const t = tableParse(source);
  if (!t) return `<div class="bm-table-wrap"><table></table></div>`;
  const cell = (txt, r, c, tag, align) =>
    `<${tag} data-r="${r}" data-c="${c}" style="text-align:${align}" contenteditable="plaintext-only">${renderInline(txt)}</${tag}>`;
  const head = `<tr>${t.rows[0].map((c, i) => cell(c, 0, i, "th", t.aligns[i] || "left")).join("")}</tr>`;
  const body = t.rows.slice(1).map((row, ri) =>
    `<tr>${row.map((c, i) => cell(c, ri + 1, i, "td", t.aligns[i] || "left")).join("")}</tr>`).join("");
  return `<div class="bm-table-wrap"><table><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
}

// ---------------------------------------------------------------------------
// 编辑态高亮：定界符以 <span class="bm-mark"> 半透明留在原位，光标落在语法
// 结构范围内时加亮（bm-mark-active）。关键不变量：标记是真实文本，
// textContent 恒等于源码 —— 提交/序列化路径零改动。
// ---------------------------------------------------------------------------

const MASK = "\u0002"; // 同长度掩码，保持偏移稳定

// 收集 [wrapS, wrapE)（要包 span 的定界符）与 [cs, ce)（激活窗口=语法结构范围）
function collectMarkerRanges(src) {
  const ranges = [];
  const masked = src.split("");
  const mask = (s, e) => { for (let i = s; i < e; i++) masked[i] = MASK; };

  // 0) 反斜杠转义对：\X 两字符整体掩码（渲染态 \* 是字面量，编辑态不得标成定界符——两视图一致）
  let m0;
  const escRe0 = /\\([!"#$%&'()*+,./:;<=>?@[\\\]^_`{|}~-])/g;
  while ((m0 = escRe0.exec(src))) mask(m0.index, m0.index + 2);

  // 1) 行内代码：`...` 定界符是反引号串（不跨行 —— 与渲染侧 per-line 一致）
  let m;
  const codeRe = /(`+)([^`\n]+?)\1(?!`)/g;
  while ((m = codeRe.exec(src))) {
    const ticks = m[1].length;
    ranges.push({ wrapS: m.index, wrapE: m.index + ticks, cs: m.index, ce: m.index + m[0].length });
    const closeS = m.index + m[0].length - ticks;
    ranges.push({ wrapS: closeS, wrapE: m.index + m[0].length, cs: m.index, ce: m.index + m[0].length });
    mask(m.index, m.index + m[0].length);
  }
  const text = masked.join("");

  // 2) 粗体：**x** / __x__（在代码掩码之外；不跨行）
  const strongRe = /(\*\*|__)(?=\S)([^\n]*?\S)\1/g;
  while ((m = strongRe.exec(text))) {
    const d = m[1].length;
    ranges.push({ wrapS: m.index, wrapE: m.index + d, cs: m.index, ce: m.index + m[0].length });
    const closeS = m.index + m[0].length - d;
    ranges.push({ wrapS: closeS, wrapE: m.index + m[0].length, cs: m.index, ce: m.index + m[0].length });
    mask(m.index, m.index + m[0].length);
  }
  const text2 = masked.join("");

  // 3) 斜体：*x* / _x_（词边界判定）
  const emRe = /(^|[\s(}>])(\*|_)([^*_\n]+?)\2(?=$|[\s).,!?，。！？<}])/g;
  while ((m = emRe.exec(text2))) {
    const lead = m[1].length;
    const s = m.index + lead;
    const ce = s + 1 + m[3].length + 1;
    ranges.push({ wrapS: s, wrapE: s + 1, cs: s, ce });
    ranges.push({ wrapS: ce - 1, wrapE: ce, cs: s, ce });
    mask(s, ce);
  }

  // 4) 图片/链接：![alt](src) / [text](href) —— 包 ![ 或 [、] 与 (url)
  //    在快照上一次性收集（避免 live mask 与 lastIndex 交互）
  const text3 = masked.join("");
  const linkRe = /(!?)\[([^\]\n]*)\]\(([^)\s]*)(?:\s+&quot;[^&]*&quot;)?\)/g;
  while ((m = linkRe.exec(text3))) {
    const start = m.index;
    const openLen = m[1].length + 1; // "![" 或 "["
    const midS = start + openLen + m[2].length; // "]"
    const end = start + m[0].length;            // 含 ")"
    ranges.push({ wrapS: start, wrapE: start + openLen, cs: start, ce: end });
    ranges.push({ wrapS: midS, wrapE: midS + 2, cs: start, ce: end });
    ranges.push({ wrapS: end - 1, wrapE: end, cs: start, ce: end });
  }

  // 去重/丢弃越界，按 wrapS 排序（同起点保留更长者）
  const valid = ranges.filter(r => r.wrapS < r.wrapE && r.wrapE <= src.length)
                      .sort((a, b) => a.wrapS - b.wrapS || b.wrapE - a.wrapE);
  const merged = [];
  for (const r of valid) {
    const last = merged[merged.length - 1];
    if (last && r.wrapS < last.wrapE) continue; // 丢弃重叠段
    merged.push(r);
  }
  return merged;
}

// 块级前缀（# / - / 1. / >）→ 始终半透明的 bm-mark（无激活窗口）
export function highlightEditableSource(src) {
  let out = "";
  let consumed = 0;
  const prefix = src.match(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s?)/);
  if (prefix) {
    out += `<span class="bm-mark bm-mark-prefix">${escapeHtml(prefix[0])}</span>`;
    consumed = prefix[0].length;
  }
  const body = src.slice(consumed);
  const ranges = collectMarkerRanges(body);
  let pos = 0;
  const emit = s => { out += escapeHtml(s); };
  for (const r of ranges) {
    emit(body.slice(pos, r.wrapS));
    out += `<span class="bm-mark" data-cs="${r.cs}" data-ce="${r.ce}">${escapeHtml(body.slice(r.wrapS, r.wrapE))}</span>`;
    pos = r.wrapE;
  }
  emit(body.slice(pos));
  return out;
}

// ---------------------------------------------------------------------------
// 落点映射（点击落光标的纯函数层）
//
// 渲染态看到的是"可见文字"，源码里还夹着不可见的语法（定界符、链接地址、井号……）。
// 把渲染态的命中位置换算成源码偏移。事实源是 renderInline 的真实输出：
//   可见文本 = plainTextOf(renderInline(body))
// 渲染只做删除（不可见语法不占位），所以可见文本必是源码正文的子序列。
// 对齐失败（可见文本没有被完整匹配）即判 ok=false，调用方退化为行尾，不产生错误落点。
// ---------------------------------------------------------------------------

const clone = re => new RegExp(re.source, "g");

// 去标签 + 解码实体，等价于该 HTML 的 textContent（标签正则容忍属性值里的 >）
export function plainTextOf(html) {
  return html.replace(/<(?:[^>"']|"[^"]*"|'[^']*')*>/g, "")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

// 复刻 renderInline 喂给四种"不可见结构"正则之前的那串文本（行内代码、转义先抽成占位符，
// 再做 HTML 转义），同时保留"探针下标 → 源码下标"的对照，好把匹配到的结构映射回源码。
// 单元（unit）= 一段原样文本，或一个占位符（token 的每个字符都记其起始下标）。
function renderProbe(body) {
  const units = [];
  const tokens = [];
  const runs = [];
  let pos = 0, codes = 0, escs = 0;
  for (const m of body.matchAll(clone(INLINE_CODE_RE))) {
    runs.push([body.slice(pos, m.index), pos]);
    tokens.push({ text: `\u0000${codes++}\u0000`, src: m.index, token: true });
    pos = m.index + m[0].length;
  }
  runs.push([body.slice(pos), pos]);
  runs.forEach(([text, src], i) => {
    let last = 0;
    for (const m of text.matchAll(ESCAPE_RE)) {
      units.push({ text: text.slice(last, m.index), src: src + last });
      units.push({ text: `\u0001${escs++}\u0001`, src: src + m.index, token: true });
      last = m.index + m[0].length;
    }
    units.push({ text: text.slice(last), src: src + last });
    if (i < tokens.length) units.push(tokens[i]);   // 第 i 个代码占位符位于第 i 段原样文本之后
  });
  let probe = "";
  const toSrc = [];
  const escapeChar = ch => ch === "&" ? "&amp;" : ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === '"' ? "&quot;" : ch;
  for (const u of units) {
    for (let k = 0; k < u.text.length; k++) {
      probe += escapeChar(u.text[k]);
      for (let r = 0; r < probe.length - (probe.length - escapeChar(u.text[k]).length); r++) toSrc.push(u.token ? u.src : u.src + k);
    }
  }
  return { probe, toSrc };
}

// 确定不可见的源码下标集合（与 renderInline 同源正则、同预处理）
function anchorHidden(body) {
  const hidden = new Uint8Array(body.length);
  const { probe, toSrc } = renderProbe(body);
  const hide = (s, e) => { for (let i = toSrc[s]; i < toSrc[e - 1] + 1; i++) hidden[i] = 1; };
  for (const re of [IMAGE_RE, LINK_RE, INLINE_MATH_RE, FOOTNOTE_REF_RE]) {
    for (const m of probe.matchAll(clone(re))) {
      const end = m.index + m[0].length;
      if (re === LINK_RE) {                 // 链接：方括号与地址不可见，链接文字可见
        const close = probe.indexOf("](", m.index + 1);
        hide(m.index, m.index + 1);
        hide(close, close + 2);
        hide(close + 2, end - 1);
        hide(end - 1, end);
      } else if (re === INLINE_MATH_RE) {   // 公式：两个美元符不可见
        hide(m.index + m[1].length, m.index + m[1].length + 1);
        hide(end - 1, end);
      } else if (re === FOOTNOTE_REF_RE) {  // 脚注引用：[^ 与 ] 不可见
        hide(m.index, m.index + 2);
        hide(end - 1, end);
      } else {
        hide(m.index, end);                 // 图片：整段不可见
      }
    }
  }
  return hidden;
}

const ESCAPABLE = new Set("!\"#$%&'()*+,./:;<=>?@[\\]^_`{|}~-");

// 一行正文 → { ok, visible, toSrc }；toSrc[i] = 第 i 个可见字符在正文里的起始下标
export function visibleIndexMap(body) {
  const visible = plainTextOf(renderInline(body));
  const toSrc = new Int32Array(visible.length);
  if (!visible.length) return { ok: true, visible, toSrc };
  const hidden = anchorHidden(body);
  const inCode = new Uint8Array(body.length);
  for (const m of body.matchAll(clone(INLINE_CODE_RE))) {
    for (let i = m.index; i < m.index + m[0].length; i++) inCode[i] = 1;
  }
  let j = 0;
  for (let i = 0; i < body.length && j < visible.length; i++) {
    if (hidden[i]) continue;
    if (!inCode[i] && body[i] === "\\" && ESCAPABLE.has(body[i + 1])) continue;   // 转义：反斜杠不可见
    if (body[i] === visible[j]) toSrc[j++] = i;
    // 其余不匹配的字符（粗斜体定界符、代码反引号等）按不可见处理
  }
  return { ok: j === visible.length, visible, toSrc };
}

// 块级前缀（渲染态不可见）：标题井号、列表符号与任务框、引用符
const ATX_PREFIX_RE = /^(#{1,6})\s+/;
const UL_PREFIX_RE = /^(\s*)[-*+]\s+(?:\[( |x|X)\]\s+)?/;
const OL_PREFIX_RE = /^\s*\d+[.)]\s+/;
const QUOTE_PREFIX_RE = /^>\s?/;

// 块 → 渲染行清单：每行 { start: 在块源码中的起始下标, text: 该行源码, prefix: 不可见前缀长度 }。
// 不提供落点的块（代码/公式/分隔线等）返回 null。
export function blockLineMap(block) {
  const lines = (block.source || "").split("\n");
  const out = [];
  let start = 0;
  const emit = (text, prefix) => { out.push({ start, text, prefix }); start += text.length + 1; };
  switch (block.type) {
    case "paragraph":
    case "table":
      for (const text of lines) emit(text, 0);
      break;
    case "heading": {
      const m = lines[0].match(ATX_PREFIX_RE);
      emit(lines[0], m ? m[0].length : 0);
      break;
    }
    case "quote":
      for (const text of lines) { const m = text.match(QUOTE_PREFIX_RE); emit(text, m ? m[0].length : 0); }
      break;
    case "ul":
    case "ol": {
      const item = block.type === "ul" ? UL_PREFIX_RE : OL_PREFIX_RE;
      for (const text of lines) {
        if (!text.trim()) { start += text.length + 1; continue; }   // 空行不占渲染行
        const m = text.match(item);
        // marker 行：符号（及任务框）是前缀；延续行渲染时行首空白被裁掉，同样计入前缀
        emit(text, m ? m[0].length : text.length - text.trimStart().length);
      }
      break;
    }
    default:
      return null;
  }
  return out;
}

// 可见边界 → 源码偏移。v = 可见字符下标（落在第 v 个可见字符之前）；preferPrev = 点击落在前一个字符的后半。
// 两侧可见字符之间夹着不可见语法时，由 preferPrev 决定落在语法之前还是之后。
export function caretSourceOffset(lines, li, v, preferPrev) {
  const L = lines && lines[li];
  if (!L) return null;
  const base = L.start + L.prefix;
  const body = L.text.slice(L.prefix);
  const lineEnd = base + body.replace(/\s+$/, "").length;   // 行尾不含尾部空白
  if (!body) return base;
  const m = visibleIndexMap(body);
  if (!m.ok) return lineEnd;                                // 映射失败 → 行尾
  const n = m.visible.length;
  if (v <= 0) return base;
  if (v >= n) return lineEnd;
  const before = base + m.toSrc[v - 1] + 1, at = base + m.toSrc[v];
  if (before === at) return at;
  return preferPrev ? before : at;
}
