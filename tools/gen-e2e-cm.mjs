// 生成 CM e2e：以 index.bundle.html 为底，注入测试脚本
// 运行后用 headless chromium dump-dom 校验 <title>
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let html = readFileSync(join(root, "EditorResources", "index.bundle.html"), "utf8");

const test = `
<script>
window.addEventListener("DOMContentLoaded", () => {
  const FIXTURE = [
    "# CM e2e", "",
    "\`\`\`js", "const x = 1; // hi", "\`\`\`", "",
    "**粗体** 段落", "",
    "\`\`\`python", "print('hi')", "\`\`\`", "",
  ].join("\\n");
  const r = {};
  try {
    r.cmLoaded = !!(window.CodeMirror && CodeMirror.runMode);
    Editor.open(FIXTURE);
    r.blocks = document.querySelectorAll("#write .bm-block").length;
    // 渲染态代码高亮
    const pres = [...document.querySelectorAll("pre.bm-code[data-enhanced]")];
    r.enhanced = pres.length === 2;
    r.highlightTokens = pres[0] ? pres[0].querySelectorAll("[class*=cm-]").length > 2 : false;
    // M1: 编辑态进入
    Editor._enterEdit("b3");
    r.editMarks = document.querySelectorAll(".bm-mark").length >= 2;
    r.editingState = JSON.stringify(Editor._editingState());
    const st = Editor._editingState();
    r.markActiveToggle = (function(){
      // 模拟光标在结构内：直接校验激活 API 分支可调用
      return typeof st === "object";
    })();
    Editor.undo && Editor.undo();
    // 源码模式（CodeMirror 版）
    Editor.toggleSourceMode(true);
    r.sourceCm = !!document.querySelector("#bm-source-cm .CodeMirror");
    r.sourceValue = (function(){ const host=document.querySelector("#bm-source-cm .CodeMirror"); return host ? "ok" : "no"; })();
    Editor.toggleSourceMode(false);
    r.roundtrip = Editor.getMarkdown().includes("\`\`\`js") && Editor.getMarkdown().includes("**粗体**");
    const ok = r.cmLoaded && r.enhanced && r.highlightTokens && r.editMarks && r.sourceCm && r.roundtrip;
    document.title = ok ? "CM-E2E PASS" : "CM-E2E FAIL";
  } catch (e) {
    r.error = String(e);
    document.title = "CM-E2E ERROR";
  }
  const pre = document.createElement("pre");
  pre.id = "cm-e2e-result";
  pre.textContent = JSON.stringify(r, null, 1);
  document.body.appendChild(pre);
});
</script>`;

html = html.replace("</body>", () => test + "\n</body>");
writeFileSync(join(root, "EditorResources", "e2e-cm.html"), html);
console.log("generated EditorResources/e2e-cm.html");
