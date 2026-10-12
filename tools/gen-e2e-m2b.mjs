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
    setTimeout(() => {
      r.mermaidSvg = document.querySelectorAll(".bm-mermaid svg").length === 1;
      const pre = document.createElement("pre");
      pre.id = "e2e-result";
      pre.textContent = JSON.stringify(r);
      document.body.appendChild(pre);
      const ok = r.frontmatter && r.fnref && r.fndef && r.taskBoxes && r.taskDone &&
                 r.katexInline && r.katexBlock && r.mermaidSvg;
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
