// 生成 M3 侧栏 e2e
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let html = readFileSync(join(root, "EditorResources", "index.bundle.html"), "utf8");
const test = String.raw`<script>
window.addEventListener("DOMContentLoaded", () => {
  const r = {};
  try {
    Editor.open("# 一级\n\n正文。\n\n## 二级甲\n\n### 三级\n\n## 二级乙\n\n# 另一级\n");
    const sb = document.getElementById("bm-sidebar");
    r.hasSidebar = !!sb;
    r.hasSearchInput = !!document.getElementById("bm-search-input");
    // 无文档路径 → 文件树提示
    Editor.toggleSidebar(true);
    r.sidebarShown = sb.style.display === "flex";
    r.treeHint = (document.getElementById("bm-sidebar-body").textContent || "").includes("保存文件后可见目录");
    // 大纲 tab
    Editor.setSidebarTab("outline");
    const items = document.querySelectorAll(".bm-outline-item");
    r.outlineCount = items.length === 5;
    r.outlineIndent = items[2] ? items[2].style.paddingLeft === "36px" : false; // h3 = 8+2*14
    const firstCid = items[0] ? items[0].dataset.cid : null;
    // 原生桥回推模拟：onRoot + onDocs
    Bridge.dispatch("library.onRoot", { root: "/tmp/x", current: "/tmp/x/a.md" });
    Bridge.dispatch("library.onDocs", { dir: "/tmp/x", entries: [
      { name: "sub", path: "/tmp/x/sub", isDir: true },
      { name: "a.md", path: "/tmp/x/a.md", isDir: false },
      { name: "b.md", path: "/tmp/x/b.md", isDir: false },
    ]});
    Editor.setSidebarTab("files");
    const files = document.querySelectorAll(".bm-tree-file");
    r.treeFiles = files.length === 2;
    r.treeActive = files[0] && files[0].classList.contains("active");
    r.treeDir = document.querySelectorAll(".bm-tree-dir").length === 1;
    // 搜索结果回推
    Bridge.dispatch("globalSearch.onResults", { results: [
      { path: "/tmp/x/a.md", name: "a.md", line: 3, text: "含 Keyword 的行" },
    ], query: "keyword", seq: 0, done: true });
    r.searchHit = document.querySelectorAll(".bm-search-hit").length === 1;
    r.searchMark = !!document.querySelector(".bm-search-hit-line mark");
    // 大纲点击滚动目标存在
    r.outlineTargetOk = firstCid ? !!document.querySelector('[data-cid="' + firstCid + '"]') : false;
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = JSON.stringify(r);
    document.body.appendChild(pre);
    const ok = r.hasSidebar && r.hasSearchInput && r.sidebarShown && r.treeHint && r.outlineCount &&
               r.outlineIndent && r.treeFiles && r.treeActive && r.treeDir && r.searchHit && r.searchMark;
    document.title = ok ? "M3-E2E PASS" : "M3-E2E FAIL";
  } catch (e) {
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = "ERROR: " + e.message + "|" + (e.stack||"").split("\n")[1];
    document.body.appendChild(pre);
    document.title = "M3-E2E ERROR";
  }
});
</script>
`;
html = html.replace("</body>", () => test + "\n</body>");
writeFileSync(join(root, "EditorResources", "e2e-m3.html"), html);
console.log("generated EditorResources/e2e-m3.html");
