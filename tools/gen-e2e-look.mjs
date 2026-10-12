// 生成观感对齐 e2e：字号节奏/无黄底/粗斜体渲染（getComputedStyle 为静态计算值，dump-dom 可用）
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let html = readFileSync(join(root, "EditorResources", "index.bundle.html"), "utf8");
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
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = JSON.stringify(r);
    document.body.appendChild(pre);
    const ok = r.h1Big && r.h2Mid && r.noYellow && r.hoverTint && r.editFsKept &&
               r.bold && r.italic && r.noAsterisk && r.colWidth;
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
html = html.replace("</body>", () => test + "\n</body>");
writeFileSync(join(root, "EditorResources", "e2e-look.html"), html);
console.log("generated");
