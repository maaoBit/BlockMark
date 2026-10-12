// 生成 M1 冒烟 e2e（bundle 基建版：原 test/e2e-harness.html 的 ES module 直连在
// headless file:// 下加载竞态 flaky，且与 app 实际加载方式不符）
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let html = readFileSync(join(root, "EditorResources", "index.bundle.html"), "utf8");
const test = String.raw`<script>
window.addEventListener("DOMContentLoaded", () => {
  const F = String.fromCharCode(96);
  const FIXTURE = "# BlockMark 冒烟\n\n这是一个段落，含 **粗体**、*斜体*、" + F + "code" + F +
    " 和 [链接](https://example.com)。\n\n## 特性\n\n- 块级实时预览\n- 源码模式切换\n- 导出 HTML/PDF\n\n" +
    "> 引用一行\n> 引用两行\n\n" + F + F + F + "js\nconsole.log(\"hello\");\n" + F + F + F + "\n\n---\n\n" +
    "| 列A | 列B |\n|:--- | ---:|\n| 1 | 2 |\n| 3 | 4 |\n\n结尾段落。";
  const r = {};
  try {
    Editor.open(FIXTURE);
    const round1 = Editor.getMarkdown();
    Editor.open(round1);
    const round2 = Editor.getMarkdown();
    r.rendered = document.querySelectorAll("#write .bm-block").length;
    r.cidOk = [...document.querySelectorAll("[data-cid]")].every(e => /^b\d+$/.test(e.dataset.cid));
    r.idempotent = round1 === round2;
    r.exportHasTable = Editor.getExportHtml().includes("<table>");
    // 源码模式（M2 起 CM 优先）：切换生效且内容不丢
    Editor.toggleSourceMode(true);
    const cmActive = !!document.querySelector("#bm-source-cm .CodeMirror");
    const srcText = window.CodeMirror
      ? (document.querySelector("#bm-source-cm .CodeMirror") && round1) || round1
      : document.getElementById("bm-source").value;
    Editor.toggleSourceMode(false);
    r.sourceRoundtrip = cmActive && Editor.getMarkdown().trim() === round1.trim();
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = JSON.stringify(r);
    document.body.appendChild(pre);
    const ok = r.rendered === parseBlocks(FIXTURE).length && r.cidOk && r.idempotent && r.exportHasTable && r.sourceRoundtrip;
    document.title = ok ? "E2E PASS" : "E2E FAIL";
  } catch (e) {
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = "ERROR: " + e.message;
    document.body.appendChild(pre);
    document.title = "E2E ERROR";
  }
});
</script>
`;
html = html.replace("</body>", () => test + "\n</body>");
writeFileSync(join(root, "EditorResources", "e2e-m1.html"), html);
console.log("generated EditorResources/e2e-m1.html");
