// 生成 M2b e2e：以 index.bundle.html 为底（KaTeX/mermaid/CM 已由 bundle 注入）
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let html = readFileSync(join(root, "EditorResources", "index.bundle.html"), "utf8");
const test = String.raw`<script>
window.addEventListener("DOMContentLoaded", () => {
  const F = String.fromCharCode(96).repeat(3);
  const FIXTURE = [
    "---", "title: M2B", "---", "",
    "# M2B e2e", "",
    "质能 $E=mc^2$ 方程", "",
    "$$", "E = mc^2", "$$", "",
    "- [ ] todo a", "- [x] done b", "- plain c", "",
    "正文[^1]注脚", "",
    "[^1]: 注释内容", "",
    F + "mermaid", "graph TD; A-->B;", F, "",
  ].join("\n");
  const r = {};
  try {
    Editor.open(FIXTURE);
    r.frontmatter = !!document.querySelector(".bm-frontmatter");
    r.fnref = document.querySelectorAll(".bm-fnref").length === 1;
    r.fndef = document.querySelectorAll(".bm-fndef").length === 1;
    r.taskBoxes = document.querySelectorAll(".bm-task-box").length === 2;
    r.taskDone = document.querySelectorAll(".bm-task.bm-task-done").length === 1;
    r.katexInline = document.querySelectorAll(".bm-imath .katex").length === 1;
    r.katexBlock = document.querySelectorAll(".bm-math .katex").length === 1;
    // —— 多行列表项渲染（缩进延续行并入上一项；用户实报：延续行后的 marker 曾被吞成段落）——
    const BT = String.fromCharCode(96);
    const MULTI = [
      "- 甲：首项", "",
      "- 乙：编辑", "",
      "  " + BT + "gw.yaml" + BT + "，复核", "  " + BT + "label" + BT + "；验证。", "- 丙：填写 <" + BT + "X" + BT + ">", "  和可选 <" + BT + "Y" + BT + ">。", "",
    ].join("\n");
    Editor.open(MULTI);
    const lis = [...document.querySelectorAll("#write .bm-render li")];
    r.multiLiCount = lis.length === 3;
    r.multiNoStrayDash = lis.every(li => !/^- /.test(li.textContent));
    r.multiSecondLiText = lis[1] && lis[1].innerHTML.includes("乙：编辑<br>") &&
      lis[1].textContent.includes("gw.yaml") && lis[1].textContent.includes("label");
    r.multiThirdLiText = lis[2] && lis[2].textContent.includes("丙：填写") &&
      lis[2].textContent.includes("和可选");
    r.multiNotParagraph = ![...document.querySelectorAll("#write .bm-block")].some(b => b.dataset.type === "paragraph");
    Editor.open(FIXTURE);
    setTimeout(() => {
      r.mermaidSvg = document.querySelectorAll(".bm-mermaid svg").length === 1;
      const pre = document.createElement("pre");
      pre.id = "e2e-result";
      pre.textContent = JSON.stringify(r);
      document.body.appendChild(pre);
      const ok = r.frontmatter && r.fnref && r.fndef && r.taskBoxes && r.taskDone &&
                 r.katexInline && r.katexBlock && r.mermaidSvg &&
                 r.multiLiCount && r.multiNoStrayDash && r.multiSecondLiText && r.multiThirdLiText && r.multiNotParagraph;
      document.title = ok ? "M2B-E2E PASS" : "M2B-E2E FAIL";
    }, 1500);
  } catch (e) {
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = "ERROR: " + e.message;
    document.body.appendChild(pre);
    document.title = "M2B-E2E ERROR";
  }
});
</script>
`;
html = html.replace("</body>", () => test + "\n</body>");
writeFileSync(join(root, "EditorResources", "e2e-m2b.html"), html);
console.log("generated EditorResources/e2e-m2b.html");
