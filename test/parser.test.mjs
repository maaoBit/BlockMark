// BlockMark 解析器测试：往返一致性 + 分类 + 行内渲染
// 运行: node test/parser.test.mjs
import { parseBlocks, serializeBlocks, tableParse, tableGetCell, tableSetCell } from "../EditorResources/editor/parser.js";
import { renderInline, renderTable } from "../EditorResources/editor/inline.js";

let pass = 0, fail = 0;
const t = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} ${detail}`); }
};

const fixture = `# BlockMark 测试

这是一个段落，含 **粗体**、*斜体*、\`code\` 和 [链接](https://example.com)。

## 特性列表

- 块级实时预览
- 源码模式切换
- 导出 HTML/PDF

1. 第一步
2. 第二步

> 引用第一行
> 引用第二行

\`\`\`js
console.log("hello");
\`\`\`

---

| 列A | 列B |
|:--- | ---:|
| 1 | 2 |
| 3 | 4 |

结尾段落。多行
软换行保留。
`;

console.log("== parseBlocks 分类");
const blocks = parseBlocks(fixture);
t("块数量", blocks.length === 10, `got ${blocks.length}`);
t("标题块", blocks[0].type === "heading" && blocks[0].level === 1);
t("段落块", blocks[1].type === "paragraph");
t("二级标题", blocks[2].type === "heading" && blocks[2].level === 2);
t("无序列表", blocks[3].type === "ul");
t("有序列表", blocks[4].type === "ol");
t("引用", blocks[5].type === "quote");
t("代码块", blocks[6].type === "code" && blocks[6].lang === "js");
t("分隔线", blocks[7].type === "hr");
t("表格", blocks[8].type === "table");
t("每块有 cid", blocks.every(b => /^b\d+$/.test(b.cid)));

console.log("== serializeBlocks 往返");
const out1 = serializeBlocks(parseBlocks(fixture));
const out2 = serializeBlocks(parseBlocks(out1));
t("幂等: serialize(parse(serialize(parse(x)))) === serialize(parse(x))", out1 === out2);
t("往返保留标题", out1.includes("# BlockMark 测试"));
t("往返保留围栏", out1.includes("```js"));
t("往返保留表格行", out1.includes("| 3 | 4 |"));
t("相邻列表不吞并", out1.includes("- 块级实时预览") && out1.includes("1. 第一步"));

console.log("== reclassify 编辑场景");
const { reclassify } = await import("../EditorResources/editor/parser.js");
const para = parseBlocks("普通段落")[0];
para.source = "# 变成标题";
reclassify(para);
t("段落→标题", para.type === "heading" && para.level === 1);
para.source = "- 变成列表";
reclassify(para);
t("段落→列表", para.type === "ul");
para.source = "```python\ncode\n```";
reclassify(para);
t("段落→代码", para.type === "code" && para.lang === "python");

console.log("== renderInline");
t("粗体", renderInline("**bold**") === "<strong>bold</strong>", renderInline("**bold**"));
t("斜体", renderInline("*em*") === "<em>em</em>", renderInline("*em*"));
t("行内代码保护", renderInline("`**not bold**`") === "<code>**not bold**</code>", renderInline("`**not bold**`"));
t("链接", renderInline("[text](https://a.b)") === '<a href="https://a.b" target="_blank" rel="noopener">text</a>', renderInline("[text](https://a.b)"));
t("图片", renderInline("![alt](img.png)").startsWith('<img src="img.png" alt="alt"'));
t("HTML 转义", renderInline("<script>") === "&lt;script&gt;", renderInline("<script>"));
t("混排", renderInline("**a** and `b`").includes("<strong>a</strong>") && renderInline("**a** and `b`").includes("<code>b</code>"));
t("行内代码内容转义（XSS 回归）", renderInline("`<b>`") === "<code>&lt;b&gt;</code>", renderInline("`<b>`"));
t("行内公式 data-tex 单层转义", renderInline("x $a&b$ y").includes('data-tex="a&amp;b"'), renderInline("x $a&b$ y"));
t("双下划线词边界", !renderInline("foo__bar__baz").includes("<strong>") && renderInline("__粗__").includes("<strong>粗</strong>"));

console.log("== renderTable");
const tbl = renderTable("| A | B |\n|:--|--:|\n| 1 | 2 |");
t("含 thead/tbody", tbl.includes("<thead>") && tbl.includes("<tbody>"));
t("右对齐", tbl.includes("text-align:right"));
const tbl2 = renderTable("| A |\n|:-:|\n| 1 |");
t("居中对齐", tbl2.includes("text-align:center"));

console.log("== 表格读写（单元格就地编辑）");
const SRC = "| A | B |\n|:-:|--:|\n| 1 | 2 |\n| 3 | 4 |";
const tp = tableParse(SRC);
t("tableParse 行列", tp && tp.rows.length === 3 && tp.rows[0].length === 2, JSON.stringify(tp));
t("tableParse 对齐", tp.aligns[0] === "center" && tp.aligns[1] === "right", JSON.stringify(tp.aligns));
t("tableGetCell", tableGetCell(SRC, 2, 1) === "4", String(tableGetCell(SRC, 2, 1)));
t("tableGetCell 越界", tableGetCell(SRC, 9, 9) === null);
const set1 = tableSetCell(SRC, 1, 0, "改");
t("tableSetCell 写值", tableGetCell(set1, 1, 0) === "改", set1);
t("tableSetCell 对齐行保留", set1.split("\n")[1].replace(/\s/g, "") === "|:---:|---:|", set1);
const set2 = tableSetCell(SRC, 0, 1, "a|b");
t("竖线转义往返", tableGetCell(set2, 0, 1) === "a|b" && set2.split("\n")[0].includes("a\\|b"), set2);
t("非表格返回原样", tableSetCell("普通段落", 0, 0, "x") === "普通段落");
t("renderTable 单元格坐标", renderTable(SRC).includes('data-r="2" data-c="1"'));

console.log("== 表格结构编辑（右键菜单增删行列）");
const {
  tableInsertRow, tableDeleteRow, tableInsertCol, tableDeleteCol,
} = await import("../EditorResources/editor/parser.js");
// SRC: 表头 A|B（居中|右对齐），数据行 1|2 / 3|4
t("插行(首数据行前)", tableGetCell(tableInsertRow(SRC, 1), 1, 0) === "" && tableGetCell(tableInsertRow(SRC, 1), 2, 0) === "1",
  tableInsertRow(SRC, 1));
t("插行(末行后)", (() => { const s = tableInsertRow(SRC, 3); return tableParse(s).rows.length === 4 && tableGetCell(s, 3, 1) === ""; })(),
  tableInsertRow(SRC, 3));
t("插行守卫: at=0(表头上方)不变", tableInsertRow(SRC, 0) === SRC);
t("插行守卫: 越界不变", tableInsertRow(SRC, 9) === SRC);
t("插行守卫: 非表格不变", tableInsertRow("普通", 1) === "普通");
const delRow = tableDeleteRow(SRC, 1);
t("删数据行", tableParse(delRow).rows.length === 2 && tableGetCell(delRow, 1, 0) === "3", delRow);
t("删行守卫: 表头不可删", tableDeleteRow(SRC, 0) === SRC);
t("删行守卫: 越界不变", tableDeleteRow(SRC, 5) === SRC);
const insCol = tableInsertCol(SRC, 1);
t("插列(右)", (() => { const p = tableParse(insCol); return p.rows[0].length === 3 && tableGetCell(insCol, 0, 0) === "A" && tableGetCell(insCol, 0, 1) === "" && tableGetCell(insCol, 0, 2) === "B"; })(), insCol);
t("插列继承右邻对齐", tableParse(insCol).aligns.join(",") === "center,right,right", tableParse(insCol).aligns.join(","));
const insColAppend = tableInsertCol(SRC, 2);
t("插列(追加)复制末列对齐", tableParse(insColAppend).aligns.join(",") === "center,right,right", tableParse(insColAppend).aligns.join(","));
const insColL = tableInsertCol(SRC, 0);
t("插列(左)继承原首列对齐", tableParse(insColL).aligns.join(",") === "center,center,right", tableParse(insColL).aligns.join(","));
t("插列守卫: 越界不变", tableInsertCol(SRC, 3) === SRC);
const delCol = tableDeleteCol(SRC, 0);
t("删列", (() => { const p = tableParse(delCol); return p.rows[0].length === 1 && tableGetCell(delCol, 0, 0) === "B"; })(), delCol);
t("删列掉对应对齐", tableParse(delCol).aligns.join(",") === "right");
t("删列守卫: 最后一列不可删", tableDeleteCol("| A |\n|---|\n| 1 |", 0) === "| A |\n|---|\n| 1 |");
t("删列守卫: 越界不变", tableDeleteCol(SRC, 5) === SRC);
// 序列化统一转义回归：编辑一格不得丢失其他格的 \| 转义
const pipeSrc = "| a\\|b | B |\n|---|---|\n| 1 | 2 |";
const pipeSet = tableSetCell(pipeSrc, 1, 1, "改");
t("写一格不破坏他格竖线转义", tableGetCell(pipeSet, 0, 0) === "a|b" && pipeSet.split("\n")[0].includes("a\\|b"), pipeSet);
const pipeIns = tableInsertRow(pipeSrc, 1);
t("插行不破坏竖线转义", tableGetCell(pipeIns, 0, 0) === "a|b" && pipeIns.split("\n")[0].includes("a\\|b"), pipeIns);
// 全空行仍可被 parseBlocks 识别为表格行
t("空行表格分类保持", parseBlocks(tableInsertRow(SRC, 1) + "\n")[0].type === "table", tableInsertRow(SRC, 1));

console.log("== 边界");
t("空文档给单空段落", parseBlocks("").length === 1 && parseBlocks("")[0].type === "paragraph");
t("CRLF 归一", parseBlocks("a\r\n\r\nb").length === 2);

console.log("== 评审轮回归（嵌套强调/单元格换行/空块分类/scheme）");
const { classifyBlock } = await import("../EditorResources/editor/parser.js");
t("classifyBlock 已导出", typeof classifyBlock === "function");
t("空块分类为段落", classifyBlock("").type === "paragraph" && classifyBlock("  ").type === "paragraph");
t("纯空白不再误判 quote", classifyBlock("  \n ").type === "paragraph");
const nest = renderInline("**a *b* c**");
t("嵌套强调：外层粗体包裹", nest.startsWith("<strong>") && nest.endsWith("</strong>"), nest);
t("嵌套强调：内层斜体", nest.includes("<strong>a <em>b</em> c</strong>"), nest);
const nest2 = renderInline("__a _b_ c__");
t("下划线嵌套强调", nest2.includes("<strong>a <em>b</em> c</strong>"), nest2);
t("相邻粗体不粘连", renderInline("**a** and **b**").includes("<strong>a</strong>") && renderInline("**a** and **b**").includes("<strong>b</strong>"));
t("孤立 **** 不匹配", !renderInline("****").includes("<strong>"));
const cellNl = tableSetCell("| A | B |\n|---|---|\n| 1 | 2 |", 1, 0, "a\nb");
t("单元格换行归一为空格", tableGetCell(cellNl, 1, 0) === "a b" && tableParse(cellNl).rows.length === 2, cellNl);
const jsLink = renderInline("[点我](javascript:alert(1))");
t("javascript: 钝化为 #", !jsLink.includes("javascript:") && jsLink.includes('href="#"'), jsLink);
t("data: 同样钝化", !renderInline("![x](data:text/html,hi)").includes("data:"));
t("https/mailto/相对路径放行", renderInline("[a](https://x.y)").includes("https://x.y") && renderInline("[b](note.md)").includes("note.md"));

console.log("== P2 清尾轮（setext/转义/链接解析/围栏/守恒）");
t("setext h1", classifyBlock("标题\n===", true).type === "heading" && classifyBlock("标题\n===", true).level === 1);
t("setext h2", classifyBlock("小节\n---", true).level === 2);
t("setext 首行列表不触发", classifyBlock("- a\n---", true).type !== "heading");
t("setext 解析成块", parseBlocks("引言\n\n标题\n===\n")[1].type === "heading");
const escLink = renderInline("\\[x\\](u)");
t("转义链接不成立", !escLink.includes("<a"), escLink);
t("转义星号字面", renderInline("\\*a\\*").includes("*a*") && !renderInline("\\*a\\*").includes("<em>"));
t("转义尖括号安全", renderInline("\\<b\\>").includes("&lt;b&gt;"));
const titleLink = renderInline('[t](https://a.b "Tom & Jerry")');
t("链接 title 含 &", titleLink.includes('title="Tom &amp; Jerry"'), titleLink);
const parenUrl = renderInline("[x](https://en.wikipedia.org/wiki/Foo_(bar))");
t("URL 平衡括号", parenUrl.includes("Foo_(bar)") && !parenUrl.includes("</a>)"), parenUrl);
const fenceInfo = parseBlocks("```\ninner:\n```js\nx\n```\n");
t("带 info 的围栏行是内容", fenceInfo.length === 1 && fenceInfo[0].type === "code" && fenceInfo[0].source.includes("```js"), JSON.stringify(fenceInfo.map(b=>b.type)));
t("hr 优先于列表聚合", parseBlocks("- - -\n- b\n").length === 2 && parseBlocks("- - -\n- b\n")[0].type === "hr" && parseBlocks("- - -\n- b\n")[1].type === "ul");
t("frontmatter 仅首块", classifyBlock("---\ntitle: x\n---", true).type === "frontmatter" && classifyBlock("---\ntitle: x\n---", false).type !== "frontmatter");
const midFm = parseBlocks("正文\n\n---\ntitle: x\n---\n");
t("中部 frontmatter 不守恒修复", midFm.every(b => b.type !== "frontmatter") && serializeBlocks(midFm) === serializeBlocks(parseBlocks(serializeBlocks(midFm))), JSON.stringify(midFm.map(b => b.type)));
t("文档首 frontmatter 仍识别", parseBlocks("---\ntitle: x\n---\n\n正文\n")[0].type === "frontmatter");

console.log(`\n结果: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
