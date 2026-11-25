// 落点映射测试：渲染态可见文字 ↔ 源码偏移（点击落光标的纯函数层）
// 不变量：visible === plainTextOf(renderInline(body))（映射以真实渲染结果为锚），
// 且 ok 时 body[toSrc[i]] === visible[i] 并严格单调。
import {
  renderInline, plainTextOf, visibleIndexMap, blockLineMap, caretSourceOffset,
} from "../EditorResources/editor/inline.js";

let pass = 0, fail = 0;
const t = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} ${detail}`); }
};

console.log("== plainTextOf: 渲染 HTML → 可见文本");
t("粗体只留文字", plainTextOf(renderInline("a**b**c")) === "abc");
t("链接只留文字", plainTextOf(renderInline("[t](https://a.b)")) === "t");
t("图片不占文本", plainTextOf(renderInline("x![a](s)y")) === "xy");
t("实体解码", plainTextOf(renderInline("a & b < c")) === "a & b < c");
t("源码实体原样显示", plainTextOf(renderInline("a &amp; b")) === "a &amp; b");
t("行内公式去美元符", plainTextOf(renderInline("a $x$ b")) === "a x b");
t("脚注引用只留编号", plainTextOf(renderInline("文[^1]字")) === "文1字");

console.log("== visibleIndexMap: 具体落点");
const map = body => visibleIndexMap(body);
const seq = body => [...map(body).toSrc].join(",");
t("纯文本逐字对应", seq("你好世界") === "0,1,2,3");
t("粗体定界符不占位", seq("前面**粗体**后面") === "0,1,4,5,8,9");
t("行内代码反引号不占位", seq("`代码`后") === "1,2,4");
t("链接地址不占位", seq("[链接文字](https://x.y)尾巴") === "1,2,3,4,19,20", seq("[链接文字](https://x.y)尾巴"));
t("链接地址与后文字母相同也不串位", seq("[a](b)b") === "1,6", seq("[a](b)b"));
t("图片整段不可见", seq("![a](s) x") === "7,8");
t("转义：反斜杠不占位、字符占位", seq("a\\*b") === "0,2,3");
t("转义后的星号仍是可见字符（此处斜体不成立，按字面）", seq("*a*\\*") === "0,1,2,4", seq("*a*\\*"));
t("脚注：方括号与尖号不占位", seq("脚注[^1]引用") === "0,1,4,6,7");
t("行内公式：美元符不占位", seq("$x+y$ 公式") === "1,2,3,5,6,7");
t("公式定界符不与转义美元符混淆", map("a$x$\\$").ok && [...map("a$x$\\$").toSrc][2] === 5, seq("a$x$\\$"));
t("嵌套粗斜体", map("嵌套 **粗 *斜*** 组合").ok);
t("代码内定界符保持可见", seq("`**x**`") === "1,2,3,4,5");
t("未闭合定界符按字面可见", seq("尾部**") === "0,1,2,3");
t("空串", map("").ok && map("").visible === "");
t("仅空白", seq("  ") === "0,1");
t("emoji 的代理对逐单元对应（与 DOM 偏移同单位）", seq("a👍b") === "0,1,2,3", seq("a👍b"));

console.log("== visibleIndexMap: 对拍语料（与真实渲染逐字一致 + 单调）");
const corpus = [
  "普通段落文字", "Hello world", "你好世界", "前面**粗体**后面", "**粗体** 和普通", "*斜* 文本",
  "嵌套 **粗 *斜*** 组合", "`code` 内 **不高亮**", "a `cd` b", "`**x**`", "[链接](https://a.b) 与 ![图](img.png)",
  "[a](b)b", "[a](a)b", "[t](u) x", "![a](s) x", "[文字](https://example.com/path?q=1)",
  '![图](assets/pic.png "标题")', "含 & < > \" 转义字符", "&amp; 实体", "a\\*b 与 \\_c\\_", "**a\\***", "***b***",
  "$x+y$ 公式", "a$x$\\$", "$E=mc^2$ 后文", "脚注[^1]引用", "行内公式 $a_1$ 与 [链](u)", "开头 **加粗结尾**",
  "__下划线粗__ x", "_斜体_ x", "snake_case_name 不斜", "a *b* c", "尾部**", "未闭合 *x", "**[链接粗](u)**",
  "[`代码链`](u)", "多**个**粗**体**", "中文**粗体**中文", "中文`代码`中文", "！**粗**！", "（*斜*）",
  "  前导空格", "tab\there", "<br> 原样", "[^note]: x", "https://auto.link x", "a\\`b", "**a**b**c**",
  "中文，标点。英文,punct!「引号」（括号）【方头】《书名》", "混合 **粗 `代 [链](u) 粗** 结束",
  "**空格开头 ** 不算粗体", "*a_b*", "**a****b**", "`Unclosed code", "[unclosed](u", "![only image](s)",
  "行尾转义\\", "\\ 反斜杠空格", "$$双美元$$", "$ 两侧空格 不算公式$", "a$1$b", "x^2_1 与 $a_1$",
];
let bad = [];
for (const body of corpus) {
  const m = map(body);
  let good = m.ok && m.visible === plainTextOf(renderInline(body));
  for (let k = 0; good && k < m.toSrc.length; k++) {
    if (body[m.toSrc[k]] !== m.visible[k] || (k && m.toSrc[k] <= m.toSrc[k - 1])) good = false;
  }
  if (!good) bad.push(body);
}
t(`${corpus.length} 条语料全部完整且单调`, bad.length === 0, JSON.stringify(bad));

console.log("== blockLineMap: 块内渲染行 ↔ 源码行");
const bm = (type, source, extra) => blockLineMap({ type, source, ...extra });
const shape = lines => (lines || []).map(L => [L.start, L.prefix, L.text]);
t("多行段落逐行", JSON.stringify(shape(bm("paragraph", "一\n二\n三"))) === JSON.stringify([[0, 0, "一"], [2, 0, "二"], [4, 0, "三"]]));
t("ATX 标题：一行、前缀含井号与空格", JSON.stringify(shape(bm("heading", "### 标题文字", { level: 3 }))) === JSON.stringify([[0, 4, "### 标题文字"]]));
t("setext 标题：下划线行不占渲染行", JSON.stringify(shape(bm("heading", "标题\n===", { level: 1 }))) === JSON.stringify([[0, 0, "标题"]]));
t("引用逐行、空行保留", JSON.stringify(shape(bm("quote", "> 甲\n>\n> 乙"))) === JSON.stringify([[0, 2, "> 甲"], [4, 1, ">"], [6, 2, "> 乙"]]));
t("无序列表：空行不占渲染行；延续行渲染时行首空白被裁掉，计入前缀",
  JSON.stringify(shape(bm("ul", "- 甲\n- 乙\n  延续\n\n- 丙"))) === JSON.stringify([[0, 2, "- 甲"], [4, 2, "- 乙"], [8, 2, "  延续"], [14, 2, "- 丙"]]));
t("有序列表前缀含序号", JSON.stringify(shape(bm("ol", "10) 文字"))) === JSON.stringify([[0, 4, "10) 文字"]]));
t("任务列表前缀含勾选框", JSON.stringify(shape(bm("ul", "- [x] 任务", { tasks: true }))) === JSON.stringify([[0, 6, "- [x] 任务"]]));
t("表格逐行、无前缀", shape(bm("table", "| a |\n| --- |")).length === 2);
t("代码/公式/分隔线不提供落点", bm("code", "```\nx\n```") === null && bm("math", "$$\nx\n$$") === null && bm("hr", "---") === null);

console.log("== caretSourceOffset: 可见边界 → 源码偏移");
const lines = bm("paragraph", "前面**粗体**后面");
const at = (v, preferPrev) => caretSourceOffset(lines, 0, v, preferPrev);
t("行首", at(0) === 0);
t("相邻可见字符：前后取舍结果相同", at(3) === 5 && at(3, true) === 5, [at(3), at(3, true)]);
t("夹着不可见定界符：点在『粗』左半 → 落在开定界符之后", at(2) === 4, at(2));
t("夹着不可见定界符：点在『面』右半 → 落在开定界符之前", at(2, true) === 2, at(2, true));
t("闭合定界符：点在『体』右半 → 落在闭定界符之前", caretSourceOffset(bm("paragraph", "**粗体**后"), 0, 2, true) === 4);
t("行尾跳过尾部空白", caretSourceOffset(bm("paragraph", "文字  "), 0, 9) === 2);
t("第二行", caretSourceOffset(bm("paragraph", "一\n二X三"), 1, 2) === 4);
t("标题前缀之后", caretSourceOffset(bm("heading", "# 标题", { level: 1 }), 0, 0) === 2);
t("列表延续行：可见下标不含被裁掉的缩进", caretSourceOffset(bm("ul", "- 甲\n  延续"), 1, 1) === 7,
  caretSourceOffset(bm("ul", "- 甲\n  延续"), 1, 1));
t("列表延续行：行尾", caretSourceOffset(bm("ul", "- 甲\n  延续"), 1, 2) === 8);
t("越界行号 → null", caretSourceOffset(lines, 5, 0) === null);
t("不提供落点的块 → null", caretSourceOffset(null, 0, 0) === null);

console.log(`\n结果: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
