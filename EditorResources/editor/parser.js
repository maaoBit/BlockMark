// BlockMark — markdown 块级解析器（原创实现）
// 文档 = 块数组；每个块携带自己的 markdown 源文本（唯一事实源）。
// 类型: paragraph | heading | quote | ul | ol | code | hr | table
//       | frontmatter | math | footnote（M2b）

const FENCE = /^```\s*([A-Za-z0-9_+-]*)\s*$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const HR = /^([-*_])(\s*\1){2,}\s*$/;
const UL_ITEM = /^(\s*)[-*+]\s+(.*)$/;
const OL_ITEM = /^(\s*)\d+[.)]\s+(.*)$/;
const QUOTE = /^>\s?/;
const TABLE_ROW = /^\s*\|.*\|\s*$/;
const TABLE_SEP = /^\s*\|[\s:|-]+\|\s*$/;
const TASK_ITEM = /^(\s*)[-*+]\s+\[( |x|X)\]\s+(.*)$/;
const FOOTNOTE_DEF = /^\[\^[^\]\n]+\]:\s?.*$/;
const MATH_DELIM = /^\$\$\s*$/;

export function classifyBlock(source, atDocStart = false) {
  if (!source.trim()) return { type: "paragraph" };   // 空/纯空白：quote 的 every(空行) 分支会误吞
  const lines = source.split("\n");
  const first = lines[0];
  const h = first.match(HEADING);
  if (h && lines.length === 1) return { type: "heading", level: h[1].length };
  // setext 标题：单行文本 + =/- 下划线行（首行须是普通文本，排除与 hr/列表/围栏的歧义）
  if (lines.length === 2 && !HEADING.test(first) && !FENCE.test(first) && !HR.test(first) && !UL_ITEM.test(first) &&
      !OL_ITEM.test(first) && !QUOTE.test(first) && !TABLE_ROW.test(first)) {
    if (/^=+\s*$/.test(lines[1])) return { type: "heading", level: 1 };
    if (/^-+\s*$/.test(lines[1])) return { type: "heading", level: 2 };
  }
  if (HR.test(first) && lines.length === 1) return { type: "hr" };
  // 关闭围栏不得带 info string（GFM）：```js 行是内容不是关闭线
  const closesFence = (l) => /^`{3,}\s*$/.test(l);
  if (FENCE.test(first) && closesFence(lines[lines.length - 1]) && lines.length >= 2)
    return { type: "code", lang: first.match(FENCE)[1] || "" };
  // front matter：仅文档首块（中部的 --- 块活体判 frontmatter 会在保存重开时变 hr+段落，不守恒）
  if (atDocStart && /^---\s*$/.test(first) && lines.length >= 2 && /^(-{3}|\.{3})\s*$/.test(lines[lines.length - 1]))
    return { type: "frontmatter" };
  // 公式块：$$ 独占开收尾，或首行 $$ 内容 + 末行 $$ 收
  if (MATH_DELIM.test(first) && MATH_DELIM.test(lines[lines.length - 1]) && lines.length >= 2)
    return { type: "math" };
  if (/^\$\$(.*)\$\$\s*$/.test(source) && lines.length === 1) return { type: "math" };
  // 脚注定义：整块都是 [^id]: 行
  if (lines.every(l => FOOTNOTE_DEF.test(l))) return { type: "footnote" };
  if (lines.every(l => QUOTE.test(l) || l.trim() === "")) return { type: "quote" };
  if (lines.every(l => UL_ITEM.test(l) || l.trim() === "")) {
    const items = lines.filter(l => l.trim());
    const tasks = items.some(l => TASK_ITEM.test(l));
    return tasks ? { type: "ul", tasks: true } : { type: "ul" };
  }
  if (lines.every(l => OL_ITEM.test(l) || l.trim() === "")) return { type: "ol" };
  if (lines.length >= 2 && TABLE_ROW.test(first) && TABLE_SEP.test(lines[1]) &&
      lines.slice(1).every(l => TABLE_ROW.test(l))) return { type: "table" };
  return { type: "paragraph" };
}

// markdown 文本 → 块数组
export function parseBlocks(md) {
  const blocks = [];
  const lines = (md || "").replace(/\r\n?/g, "\n").split("\n");
  let i = 0, cid = 1;
  const push = (source, atStart = false) => {
    if (source.trim() === "") return;
    blocks.push({ cid: "b" + cid++, source, ...classifyBlock(source, atStart) });
  };
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim() === "") { i++; continue; }
    // front matter：仅文档最开头的 --- 块
    if (i === 0 && blocks.length === 0 && /^---\s*$/.test(line)) {
      let j = 1;
      while (j < lines.length && !/^(-{3}|\.{3})\s*$/.test(lines[j])) j++;
      if (j < lines.length) {
        push(lines.slice(0, j + 1).join("\n"), true);   // 文档首块（frontmatter 位置语义）
        i = j + 1;
        continue;
      }
      // 未闭合则按普通段落走
    }
    // 公式块：$$ 围栏（独占行开/收）
    if (MATH_DELIM.test(line)) {
      let j = i + 1;
      while (j < lines.length && !MATH_DELIM.test(lines[j])) j++;
      if (j < lines.length) {
        push(lines.slice(i, j + 1).join("\n"));
        i = j + 1;
        continue;
      }
    }
    // 脚注定义：连续 [^id]: 行聚合
    if (FOOTNOTE_DEF.test(line)) {
      const start = i;
      while (i < lines.length && FOOTNOTE_DEF.test(lines[i])) i++;
      push(lines.slice(start, i).join("\n"));
      continue;
    }
    // 围栏代码块：独占扫描（关闭线须裸 ```——带 info 的是内容行）
    const fence = line.match(FENCE);
    if (fence) {
      const start = i;
      i++;
      while (i < lines.length && !/^`{3,}\s*$/.test(lines[i])) i++;
      i = Math.min(i + 1, lines.length);
      push(lines.slice(start, i).join("\n"));
      continue;
    }
    // 表格：表头 + 分隔行 + 连续表格行
    if (TABLE_ROW.test(line) && i + 1 < lines.length && TABLE_SEP.test(lines[i + 1])) {
      const start = i;
      i += 2;
      while (i < lines.length && TABLE_ROW.test(lines[i])) i++;
      push(lines.slice(start, i).join("\n"));
      continue;
    }
    // 标题 / 分隔线：单行成块（先于列表聚合——"- - -\n- b" 首行是 hr 而非列表项）
    if (HEADING.test(line) || HR.test(line)) { push(line); i++; continue; }
    // 引用 / 列表：聚合同类连续行
    if (QUOTE.test(line)) {
      const start = i;
      while (i < lines.length && (QUOTE.test(lines[i]) || lines[i].trim() === "")) i++;
      push(lines.slice(start, i).join("\n"));
      continue;
    }
    if (UL_ITEM.test(line) || OL_ITEM.test(line)) {
      const isUl = UL_ITEM.test(line);
      const start = i;
      while (i < lines.length && ((isUl ? UL_ITEM : OL_ITEM).test(lines[i]) || lines[i].trim() === "")) i++;
      // 列表后若紧跟普通文本行且非列表项，回退一格避免吞段
      push(lines.slice(start, i).join("\n"));
      continue;
    }
    // 段落：到空行为止
    const start = i;
    while (i < lines.length && lines[i].trim() !== "") i++;
    push(lines.slice(start, i).join("\n"));
  }
  if (blocks.length === 0) blocks.push({ cid: "b1", source: "", type: "paragraph" });
  return blocks;
}

// 块数组 → markdown 文本（与 parseBlocks 互逆）
export function serializeBlocks(blocks) {
  const parts = blocks.map(b => b.source.replace(/\s+$/, ""));
  const out = [];
  for (const p of parts) {
    if (p === "") continue;
    if (out.length) {
      const prev = out[out.length - 1];
      const prevIsList = /^(\s*[-*+]\s|\s*\d+[.)]\s)/.test(prev);
      const curIsList = /^(\s*[-*+]\s|\s*\d+[.)]\s)/.test(p);
      // 两个列表块相邻时插入空行，防止合并；其余块间单空行
      out.push(prevIsList && curIsList ? "\n" : "");
    }
    out.push(p);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// 编辑中重分类：用户把段落改成了 "# 标题" 等场景
export function reclassify(block, atDocStart = false) {
  const info = classifyBlock(block.source, atDocStart);
  block.type = info.type;
  if (info.type === "heading") block.level = info.level; else delete block.level;
  if (info.type === "code") block.lang = info.lang; else delete block.lang;
  if (info.tasks) block.tasks = true; else delete block.tasks;
  return block;
}

// 公式块源文本 → TeX 内容
export function mathTex(source) {
  const lines = source.split("\n");
  if (lines.length === 1) return source.replace(/^\$\$/, "").replace(/\$\$\s*$/, "");
  return lines.slice(1, lines.length - 1).join("\n");
}

// 任务列表项切换：定位第 index 个任务项，翻转 [ ]/[x]
export function toggleTaskItem(source, index) {
  let n = 0;
  const out = source.split("\n").map(l => {
    const m = l.match(/^(\s*[-*+]\s+)\[( |x|X)\](\s+)(.*)$/);
    if (!m) return l;
    const cur = n++;
    if (cur !== index) return l;
    const mark = m[2] === " " ? "x" : " ";
    return `${m[1]}[${mark}]${m[3]}${m[4]}`;
  });
  return n === 0 ? source : out.join("\n");
}

// 表格读写（M-长尾：单元格就地编辑）
export function tableParse(source) {
  const lines = source.trim().split("\n").map(l => l.trim());
  if (lines.length < 2) return null;
  // \| 是转义竖线：先占位保护再 split
  const cells = l => l.replace(/^\|/, "").replace(/\|$/, "")
    .replace(/\\\|/g, "\u0001").split("|").map(c => c.trim().replace(/\u0001/g, "|"));
  const aligns = cells(lines[1]).map(c =>
    /^:-+:$/.test(c) ? "center" : /^-+:$/.test(c) ? "right" : "left");
  if (!aligns.length || !aligns.every(a => ["left", "center", "right"].includes(a))) return null;
  const rows = [cells(lines[0])].concat(lines.slice(2).map(cells));
  return { rows, aligns };
}

export function tableGetCell(source, r, c) {
  const t = tableParse(source);
  if (!t || !t.rows[r]) return null;
  return t.rows[r][c] ?? "";
}

// 表对象 → 源文本。parse 时已还原 \| → 序列化统一重转义每格
// （旧实现只转义被写的那格，其余含 \| 的格会在重拼时丢失转义被拆列）
// 换行归一为空格：GFM 表格单元格不承载换行，混入会解体表格结构
function tableSerialize(t) {
  const width = Math.max(...t.rows.map(row => row.length));
  const aligns = t.aligns.slice();
  while (aligns.length < width) aligns.push("left");
  if (aligns.length > width) aligns.length = width;
  const clean = cell => (cell ?? "").replace(/[\r\n]+/g, " ").replace(/\|/g, "\\|");
  const lines = t.rows.map(row => {
    const padded = row.slice();
    while (padded.length < width) padded.push("");
    return "| " + padded.map(clean).join(" | ") + " |";
  });
  const alignLine = "| " + aligns.map(a =>
    a === "center" ? ":---:" : a === "right" ? "---:" : "---").join(" | ") + " |";
  return [lines[0], alignLine, ...lines.slice(1)].join("\n");
}

// 写单元格（cells 存未转义原文，转义统一由 tableSerialize 收口）
export function tableSetCell(source, r, c, text) {
  const t = tableParse(source);
  if (!t || !t.rows[r]) return source;
  t.rows[r][c] = text;
  return tableSerialize(t);
}

// ---------- 表格结构编辑（右键菜单增删行列） ----------
// 行坐标同单元格编辑：r=0 表头，数据行从 1；表头不可删、不可在其上方插行

export function tableInsertRow(source, at) {
  const t = tableParse(source);
  if (!t || !Number.isInteger(at) || at < 1 || at > t.rows.length) return source;
  const width = Math.max(...t.rows.map(row => row.length));
  t.rows.splice(at, 0, new Array(width).fill(""));
  return tableSerialize(t);
}

export function tableDeleteRow(source, r) {
  const t = tableParse(source);
  if (!t || !Number.isInteger(r) || r < 1 || r >= t.rows.length) return source;
  t.rows.splice(r, 1);
  return tableSerialize(t);
}

export function tableInsertCol(source, at) {
  const t = tableParse(source);
  if (!t || !Number.isInteger(at) || at < 0) return source;
  const width = Math.max(...t.rows.map(row => row.length));
  if (at > width) return source;
  for (const row of t.rows) {
    while (row.length < width) row.push("");
    row.splice(at, 0, "");
  }
  // 新列继承右邻对齐（追加时复制末列）
  const ref = t.aligns[Math.min(at, t.aligns.length - 1)] || "left";
  t.aligns.splice(at, 0, ref);
  return tableSerialize(t);
}

export function tableDeleteCol(source, c) {
  const t = tableParse(source);
  if (!t || !Number.isInteger(c) || c < 0) return source;
  const width = Math.max(...t.rows.map(row => row.length));
  if (width <= 1 || c >= width) return source;   // 最后一列不可删
  for (const row of t.rows) row.splice(c, 1);
  t.aligns.splice(c, 1);
  return tableSerialize(t);
}
