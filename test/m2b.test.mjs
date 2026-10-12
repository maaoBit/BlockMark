// M2b：front matter / $$ 公式块 / 脚注 / 任务列表 / 行内公式
import { parseBlocks, serializeBlocks, reclassify, mathTex, toggleTaskItem } from "../EditorResources/editor/parser.js";
import { renderInline } from "../EditorResources/editor/inline.js";

let pass = 0, fail = 0;
const t = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} ${detail}`); }
};

// --- front matter ---
{
  const md = "---\ntitle: Hi\nauthor: me\n---\n\n# T\n\nbody\n";
  const bs = parseBlocks(md);
  t("frontmatter 识别", bs[0].type === "frontmatter", JSON.stringify(bs[0]));
  t("frontmatter 后续块正常", bs[1].type === "heading" && bs[1].level === 1);
  t("frontmatter 往返", serializeBlocks(bs) === md.replace(/\n*$/, "\n"), serializeBlocks(bs));
  // 未闭合 --- 不当 frontmatter
  const bs2 = parseBlocks("---\nnot closed\n\npara");
  t("未闭合 --- 不识别为 frontmatter", bs2[0].type !== "frontmatter", bs2[0].type);
}

// --- $$ 公式块 ---
{
  const md = "# T\n\n$$\nE = mc^2\n\\int_0^1 x dx\n$$\n\nafter\n";
  const bs = parseBlocks(md);
  const m = bs.find(b => b.type === "math");
  t("公式块识别", !!m);
  t("公式块内容", m && mathTex(m.source) === "E = mc^2\n\\int_0^1 x dx", m && mathTex(m.source));
  t("公式块后块", bs[bs.length - 1].source === "after");
  t("单行 $$x$$ 识别", parseBlocks("$$a+b$$\n")[0].type === "math");
  t("mathTex 单行", mathTex("$$a+b$$") === "a+b");
}

// --- 脚注 ---
{
  const md = "# T\n\n正文[^1]继续。\n\n[^1]: 脚注一\n[^2]: 脚注二\n\ntail\n";
  const bs = parseBlocks(md);
  const fn = bs.find(b => b.type === "footnote");
  t("脚注块识别", !!fn, JSON.stringify(bs.map(b => b.type)));
  t("脚注块聚合两行", fn && fn.source.split("\n").length === 2);
  t("脚注后块", bs[bs.length - 1].source === "tail");
  t("脚注往返", serializeBlocks(bs).includes("[^1]: 脚注一"));
}

// --- 任务列表 ---
{
  const md = "# T\n\n- [ ] 待办甲\n- [x] 已办乙\n- 普通项\n\nafter\n";
  const bs = parseBlocks(md);
  t("混合任务列表 tasks 标记", bs[1].type === "ul" && bs[1].tasks === true, JSON.stringify(bs[1]));
  const all = parseBlocks("- [ ] a\n- [x] b\n")[0];
  t("全任务列表 tasks 标记", all.tasks === true);
  const plain = parseBlocks("- a\n- b\n")[0];
  t("普通列表无 tasks", plain.tasks !== true);
  const toggled = toggleTaskItem("- [ ] a\n- [x] b\n- [ ] c\n", 1);
  t("toggleTaskItem 翻转指定项", toggled === "- [ ] a\n- [ ] b\n- [ ] c\n", toggled);
  const toggled2 = toggleTaskItem(toggled, 0);
  t("toggleTaskItem 再翻回", toggled2.startsWith("- [x] a"));
}

// --- 行内公式渲染 ---
{
  const html = renderInline("质能 $E=mc^2$ 公式");
  t("行内公式 span", html.includes('class="bm-imath"') && html.includes('data-tex="E=mc^2"'), html);
  t("行内公式原文兜底", html.includes("E=mc^2"));
  const no = renderInline("价格 5$ 和 $6 之间");
  t("裸 $ 不误判", !no.includes("bm-imath"), no);
  const no2 = renderInline("$ spaced $两侧空格不匹配");
  t("内侧空格不匹配", !no2.includes("bm-imath"), no2);
  const code = renderInline("`$x$` 代码内不渲染");
  t("行内代码内 $ 保护", !code.includes("bm-imath"), code);
}

// --- 脚注引用渲染 ---
{
  const html = renderInline("见[^note1]处");
  t("脚注引用 sup", html.includes('class="bm-fnref"') && html.includes('data-fn="note1"'), html);
  const link = renderInline("[文本](https://x.com)");
  t("普通链接不受影响", link.includes('<a href="https://x.com"'), link);
}

// --- reclassify 新字段 ---
{
  const b = { cid: "b1", source: "- [ ] a\n", type: "paragraph" };
  reclassify(b);
  t("reclassify 识别任务列表", b.type === "ul" && b.tasks === true);
  const b2 = { cid: "b1", source: "- a\n", type: "ul", tasks: true };
  reclassify(b2);
  t("reclassify 清除 tasks", b2.tasks !== true);
}

console.log(`\nm2b: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
