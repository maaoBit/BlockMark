// M1 编辑态高亮测试：不变量 stripTags(highlight(src)) === escapeHtml(src)
// 以及定界符标记的存在性与激活窗口数值
import { highlightEditableSource, escapeHtml } from "../EditorResources/editor/inline.js";

let pass = 0, fail = 0;
const t = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} ${detail}`); }
};
const strip = h => h.replace(/<[^>]*>/g, "");
const marks = h => (h.match(/<span class="bm-mark[^"]*"[^>]*>/g) || []).length;
const attr = (h, i, name) => {
  const all = [...h.matchAll(/<span class="bm-mark[^"]*"([^>]*)>/g)];
  return all[i] ? (all[i][1].match(new RegExp(`${name}="(-?\\d+)"`)) || [])[1] : null;
};

console.log("== 不变量: 去标签 == 转义源码");
const cases = [
  "**粗体** 和普通",
  "*斜* 文本",
  "`code` 内 **不高亮**",
  "[链接](https://a.b) 与 ![图](img.png)",
  "# 标题 **内联**",
  "- 列表 *斜体*",
  "含 & < > \" 转义字符",
  "无标记普通段落",
  "嵌套 **粗 *斜*** 组合",
  "",
];
for (const [i, src] of cases.entries()) {
  const h = highlightEditableSource(src);
  t(`case ${i}: "${src.slice(0, 16)}"`, strip(h) === escapeHtml(src), `\n  got:  ${strip(h)}\n  want: ${escapeHtml(src)}`);
}

console.log("== 标记覆盖");
t("粗体定界符×2", marks(highlightEditableSource("**b** x")) === 2);
t("行内代码定界符×2", marks(highlightEditableSource("`c` x")) === 2);
t("链接三段标记", marks(highlightEditableSource("[t](u) x")) === 3, `got ${marks(highlightEditableSource("[t](u) x"))}`);
t("图片三段标记", marks(highlightEditableSource("![a](s) x")) === 3);
t("代码内粗体不标记", marks(highlightEditableSource("`**x**`")) === 2);
t("标题前缀标记", /bm-mark-prefix/.test(highlightEditableSource("# H1")));
t("列表前缀标记", /bm-mark-prefix/.test(highlightEditableSource("- item")));
t("普通段落无前缀标记", !/bm-mark-prefix/.test(highlightEditableSource("普通")));

console.log("== 激活窗口数值");
const hb = highlightEditableSource("**bold**");
t("粗体结构范围 cs=0 ce=8", attr(hb, 0, "data-cs") === "0" && attr(hb, 0, "data-ce") === "8", JSON.stringify([attr(hb, 0, "data-cs"), attr(hb, 0, "data-ce")]));
const hc = highlightEditableSource("a `cd` b");
t("代码窗口 cs=2 ce=6", attr(hc, 0, "data-cs") === "2" && attr(hc, 0, "data-ce") === "6", JSON.stringify([attr(hc, 0, "data-cs"), attr(hc, 0, "data-ce")]));

console.log(`\n结果: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
