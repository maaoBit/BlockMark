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

console.log("== 边界");
t("空文档给单空段落", parseBlocks("").length === 1 && parseBlocks("")[0].type === "paragraph");
t("CRLF 归一", parseBlocks("a\r\n\r\nb").length === 2);
console.log(`\n结果: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
