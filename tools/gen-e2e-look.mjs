// 生成观感对齐 e2e：字号节奏/无黄底/粗斜体渲染（getComputedStyle 为静态计算值，dump-dom 可用）
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let html = readFileSync(join(root, "EditorResources", "index.bundle.html"), "utf8");
// 新主题回归门：三个内置主题文件必须存在且含变量与 CM 语法段（缺失/残缺 → 生成即失败）
const THEMES = {};
for (const t of ["one-dark", "dracula", "nord"]) {
  const css = readFileSync(join(root, "EditorResources", "themes", t + ".css"), "utf8");
  if (!css.includes("--accent") || !css.includes(".bm-cm-host .cm-header")) {
    throw new Error("theme css incomplete: " + t);
  }
  THEMES[t] = css;
}
const test = String.raw`<script>
window.addEventListener("DOMContentLoaded", async () => {
  const r = {};
  try {
    Editor.open("# 试用回归\n\n普通段落文本样本\n\n## 二级标题\n\n> 引用块一行\n");
    const cs = (sel) => getComputedStyle(document.querySelector(sel));
    // 1) 标题字号节奏：h1 明显大于正文（1.9em vs 1em，取阈值 1.5）
    const bodyFs = parseFloat(cs('.bm-block[data-type="paragraph"] > p').fontSize);
    const h1Fs = parseFloat(cs('.bm-block[data-type="heading"][data-level="1"] > h1').fontSize);
    const h2Fs = parseFloat(cs('.bm-block[data-type="heading"][data-level="2"] > h2').fontSize);
    r.h1Ratio = +(h1Fs / bodyFs).toFixed(2);
    r.h1Big = r.h1Ratio >= 1.5;
    r.h2Mid = +(h2Fs / bodyFs).toFixed(2) >= 1.3 && h2Fs < h1Fs;
    // 2) 编辑态底色 = var(--block-hover) 淡蓝而非黄底
    Editor._enterEdit("b2");
    const bg = cs('.bm-block.bm-editing').backgroundColor;
    r.editBg = bg;
    const m = bg.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    r.noYellow = !m || !(+m[1] > 200 && +m[2] > 180 && +m[3] < 120); // 排除黄系
    r.hoverTint = m && +m[2] > +m[1];                                  // 蓝系：G 分量高于 R
    // 3) 编辑态字号不塌缩（段落编辑时仍 16px 级）
    r.editFsKept = parseFloat(cs('.bm-block.bm-editing').fontSize) >= bodyFs * 0.9;
    // 4) 粗体/斜体渲染（非源码星号）
    Editor.open("段落 **加粗** 与 *斜体* 尾\n");
    r.bold = cs('.bm-block strong').fontWeight >= "600";
    r.italic = cs('.bm-block em').fontStyle === "italic";
    r.noAsterisk = !document.querySelector(".bm-block").textContent.includes("**");
    // 5) 内容列宽收敛（820px 上限 → 视口足够时 .write 宽度 ≈ 820）
    r.writeWidth = document.getElementById("write").getBoundingClientRect().width;
    r.colWidth = r.writeWidth >= 700 && r.writeWidth <= 860;
    // 6) 滚动职责分离（全屏右侧空白可滚的回归门）：.bm-main 持滚动，.write 只限宽居中
    const mainEl = document.getElementById("bm-main");
    const mainCs = getComputedStyle(mainEl), writeCs = getComputedStyle(document.getElementById("write"));
    r.mainIsScroller = mainCs.overflowY === "auto" || mainCs.overflowY === "scroll";
    r.writeNotScroller = writeCs.overflowY === "visible";
    // 行为级：长文档下 .bm-main 可滚，且视口右缘空白落点在 .bm-main 上（旧实现 .write 自滚，壳不可滚）
    Editor.open(Array.from({length: 80}, (_, i) => "第" + i + "行：滚动职责分离样例段落文本。").join("\n\n"));
    r.mainScrollable = mainEl.scrollHeight > mainEl.clientHeight;
    r.gutterHit = mainEl.contains(document.elementFromPoint(innerWidth - 8, Math.floor(innerHeight / 2)));
    // 7) 新内置主题（one-dark/dracula/nord）：注入后底色与 accent 变量生效，data-theme 正确
    r.themes = {};
    for (const [name, css] of Object.entries(BM_THEMES)) {
      Bridge.dispatch("theme.apply", { name, css });
      const bg = getComputedStyle(document.body).backgroundColor;
      const acc = getComputedStyle(document.documentElement).getPropertyValue("--accent").trim();
      r.themes[name] = bg !== "rgb(255, 255, 255)" && acc.length > 0 &&
                       document.documentElement.dataset.theme === name;
    }
    Bridge.dispatch("theme.apply", { name: "default", css: "" });
    r.newThemes = Object.values(r.themes).every(Boolean);
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = JSON.stringify(r);
    document.body.appendChild(pre);
    const ok = r.h1Big && r.h2Mid && r.noYellow && r.hoverTint && r.editFsKept &&
               r.bold && r.italic && r.noAsterisk && r.colWidth &&
               r.mainIsScroller && r.writeNotScroller && r.mainScrollable && r.gutterHit && r.newThemes;
    document.title = ok ? "LOOK-E2E PASS" : "LOOK-E2E FAIL";
  } catch (e) {
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = "ERROR: " + e.message + "|" + (e.stack||"").split("\n")[1];
    document.body.appendChild(pre);
    document.title = "LOOK-E2E ERROR";
  }
});
</script>
`;
html = html.replace("</body>", () => "<script>const BM_THEMES=" + JSON.stringify(THEMES).replace(/</g, "\\u003c") + ";</script>\n" + test + "\n</body>");
writeFileSync(join(root, "EditorResources", "e2e-look.html"), html);
console.log("generated");
