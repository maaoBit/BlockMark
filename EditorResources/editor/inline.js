// BlockMark — 行内 markdown 渲染（原创实现，MVP 语法集）
// 支持: `code` **strong** *em* [text](url) ![alt](src)
import { tableParse } from "./parser.js";

export function escapeHtml(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
          .replace(/"/g, "&quot;");
}

export function renderInline(md) {
  // 1. 先抽出行内代码，占位保护
  const codes = [];
  let s = md.replace(/`([^`\n]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0000${codes.length - 1}\u0000`;
  });
  s = escapeHtml(s);
  // 1.5 行内公式 $...$（两侧贴字、内部无 $；在 strong/em 前处理防止吞掉 TeX 里的 *）
  s = s.replace(/(^|[^\\$])\$([^\s$]|[^\s$][^$\n]*[^\s$])\$(?!\d)/g, (_, pre, tex) =>
    `${pre}<span class="bm-imath" data-tex="${tex}">${tex}</span>`);
  // 1.6 脚注引用 [^id] → 上标
  s = s.replace(/\[\^([^\]\n]+)\](?!\()/g, (_, id) =>
    `<sup class="bm-fnref" data-fn="${id}">${id}</sup>`);
  // 1.7 URL scheme 白名单：javascript:/data: 等可执行 scheme 一律钝化为 #（防注入软防线）
  const safeUrl = u => /^[a-z][a-z0-9+.-]*:/i.test(u) && !/^(https?|mailto|file):/i.test(u) ? "#" : u;
  // 2. 图片（在链接前处理）
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, alt, src, title) =>
      `<img src="${safeUrl(src)}" alt="${alt}"${title ? ` title="${title}"` : ""} loading="lazy">`);
  // 3. 链接
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)(?:\s+&quot;([^&]*)&quot;)?\)/g,
    (_, text, href, title) =>
      `<a href="${safeUrl(href)}"${title ? ` title="${title}"` : ""} target="_blank" rel="noopener">${text}</a>`);
  // 4. 粗体（**x** / __x__；内容允许单 * —— 嵌套强调 **a *b* c** 的外层不能被 [^*] 拦死）
  s = s.replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>");
  s = s.replace(/(^|[\s(])__([^\n]+?)__(?=$|[\s).,!?，。！？])/g, "$1<strong>$2</strong>");
  // 5. 斜体（*x* 或 _x_，避开词中下划线的粗判；在 strong 之后处理内层）
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=$|[\s).,!?，。！？])|(^|[\s(])_([^_\n]+)_(?=$|[\s).,!?，。！？])/g,
    "$1$3<em>$2$4</em>");
  // 6. 还原行内代码
  s = s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${escapeHtml(codes[+i])}</code>`);
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
