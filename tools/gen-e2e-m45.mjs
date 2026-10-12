// 生成 M4.5 e2e：打字机/专注/图片占位/主题
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let html = readFileSync(join(root, "EditorResources", "index.bundle.html"), "utf8");
const test = String.raw`<script>
window.addEventListener("DOMContentLoaded", async () => {
  const r = {};
  try {
    Editor.open("# T\n\n段落一\n\n段落二\n");
    // 打字机
    Editor.toggleTypewriter();
    r.typewriter = document.getElementById("write").classList.contains("bm-typewriter");
    Editor.toggleTypewriter();
    r.typewriterOff = !document.getElementById("write").classList.contains("bm-typewriter");
    // 专注
    Editor.toggleFocusMode();
    Editor._enterEdit("b2");
    r.focusAttr = document.getElementById("write").getAttribute("data-focus-cid") === "b2";
    r.focusOn = !!document.querySelector('[data-cid="b2"].bm-focus-on');
    // dump-dom 无渲染循环 → 结构断言：仅当前编辑块带高亮 class（CSS 规则由样式表 grep 保证）
    r.focusDim = document.querySelectorAll(".bm-focus-on").length === 1;
    Editor.toggleFocusMode();
    r.focusOff = !document.getElementById("write").hasAttribute("data-focus-cid");
    // 图片占位替换（模拟原生回推）
    Editor._enterEdit("b3");
    const el = document.querySelector('[data-cid="b3"]');
    el.textContent = "![uploading-1](uploading-1)";
    Bridge.dispatch("images.onSaved", { marker: "uploading-1", url: "assets/pasted-9.png" });
    r.imgReplaced = el.textContent === "![](assets/pasted-9.png)";
    // 主题注入
    Bridge.dispatch("theme.apply", { name: "dark", css: ":root{--bg:#111}" });
    r.themeTag = !!document.getElementById("theme_css");
    r.themeAttr = document.documentElement.dataset.theme === "dark";
    Bridge.dispatch("theme.apply", { name: "default", css: "" });
    r.themeReset = document.documentElement.dataset.theme === "default";
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = JSON.stringify(r);
    document.body.appendChild(pre);
    const ok = r.typewriter && r.typewriterOff && r.focusAttr && r.focusOn && r.focusDim &&
               r.focusOff && r.imgReplaced && r.themeTag && r.themeAttr && r.themeReset;
    document.title = ok ? "M45-E2E PASS" : "M45-E2E FAIL";
  } catch (e) {
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = "ERROR: " + e.message + "|" + (e.stack||"").split("\n")[1];
    document.body.appendChild(pre);
    document.title = "M45-E2E ERROR";
  }
});
</script>
`;
html = html.replace("</body>", () => test + "\n</body>");
writeFileSync(join(root, "EditorResources", "e2e-m45.html"), html);
console.log("generated");
