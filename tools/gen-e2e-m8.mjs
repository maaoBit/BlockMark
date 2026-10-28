// 生成 M8 轮 e2e：评审修复回归——三态活文本进 getMarkdown/导出/undo 快照，
// renderAll 前先提交（⌘T/空白点击不丢字），语言框 Enter，Tab 防逃逸，贴图登记找回，单元格换行
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let html = readFileSync(join(root, "EditorResources", "index.bundle.html"), "utf8");
const FB = "\u0060\u0060\u0060";   // 围栏三反引号（模板内以 ${FB} 插值，避开反引号冲突）
const test = `
<script>
window.addEventListener("DOMContentLoaded", async () => {
  const r = {};
  const sleep = ms => new Promise(ok => setTimeout(ok, ms));
  const st = () => Editor._editingState();
  const block = cid => document.querySelector('[data-cid="' + cid + '"]');
  window.addEventListener("error", e => { r.jsErr = (r.jsErr || "") + e.message + ";"; });
  try {
    // ---------- P0-①：三态活文本进 getMarkdown ----------
    Editor.open("段落基线\\n");
    const a1 = document.querySelector(".bm-block").dataset.cid;
    Editor._enterEdit(a1);
    document.execCommand("insertText", false, "活文本甲");
    await sleep(20);
    r.liveBlock = Editor.getMarkdown().includes("活文本甲");
    r.liveExport = Editor.getExportHtml().includes("活文本甲");
    // CM 态
    Editor.open("前段\\n\\n${FB}js\\nconst x = 1;\\n${FB}\\n");
    const c1 = document.querySelector('[data-type="code"]').dataset.cid;
    Editor._enterEdit(c1);
    await sleep(80);
    if (st().hasCm) Editor._setCmValue("const y = 2;");
    await sleep(20);
    r.liveCm = Editor.getMarkdown().includes("const y = 2") && Editor.getMarkdown().includes("${FB}js");
    // 单元格态
    Editor.open("| A | B |\\n|---|---|\\n| 1 | 2 |\\n");
    const t1 = document.querySelector('[data-type="table"]').dataset.cid;
    Editor._enterCellEdit(t1, 1, 0);
    document.querySelector('[data-r="1"][data-c="0"]').textContent = "格中活文本";
    await sleep(20);
    r.liveCell = Editor.getMarkdown().includes("格中活文本");
    Editor._commitCellEdit();

    // ---------- P0-②：编辑中插表格/点空白不丢未提交文字 ----------
    Editor.open("段落一\\n");
    const f1 = document.querySelector(".bm-block").dataset.cid;
    Editor._enterEdit(f1);
    document.execCommand("insertText", false, "现场输入");
    await sleep(20);
    Editor.format("table");
    await sleep(30);
    r.cmdTKept = Editor.getMarkdown().includes("现场输入") && Editor.getMarkdown().includes("列A");

    Editor.open("首块\\n\\n${FB}\\ncode\\n${FB}\\n");
    const b1 = document.querySelector(".bm-block").dataset.cid;
    Editor._enterEdit(b1);
    document.execCommand("insertText", false, "末笔");
    await sleep(20);
    document.getElementById("write").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientY: 900 }));
    await sleep(30);
    r.blankKept = Editor.getMarkdown().includes("末笔");

    // ---------- P0-③：语言输入框 Enter = 提交（不摧毁代码块） ----------
    Editor.open("前段\\n\\n${FB}js\\nconst b = 2;\\n${FB}\\n");
    const c2 = document.querySelector('[data-type="code"]').dataset.cid;
    Editor._enterEdit(c2);
    await sleep(80);
    const langInput = block(c2).querySelector(".bm-lang-input");
    if (langInput) {
      langInput.focus();
      langInput.value = "python";
      langInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      await sleep(60);
    }
    const md3 = Editor.getMarkdown();
    r.langEnterSafe = md3.includes("const b = 2") && md3.includes("${FB}python") && !md3.includes("Esc") && !st().hasCm;

    // ---------- undo 快照活文本一致化（嵌合态修复） ----------
    Editor.open("hello\\n");
    const u1 = document.querySelector(".bm-block").dataset.cid;
    Editor._enterEdit(u1, false);
    document.execCommand("insertText", false, "# ");
    await sleep(30);
    block(u1).dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(30);
    Editor.undo();
    await sleep(30);
    const uel = block(u1);
    r.undoConsistent = !!uel && !uel.querySelector("h1") && !Editor.getMarkdown().includes("# hello");

    // Enter 拆块的 undo 带活文本（快照在活文本化后拍摄）
    Editor.open("AAAABBBB\\n");
    const s1 = document.querySelector(".bm-block").dataset.cid;
    Editor._enterEdit(s1);
    document.execCommand("insertText", false, "追加尾部");
    await sleep(20);
    const el9 = block(s1);
    const rng = document.createRange(); rng.selectNodeContents(el9); rng.collapse(false);
    const sel9 = getSelection(); sel9.removeAllRanges(); sel9.addRange(rng);
    el9.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await sleep(30);
    Editor.undo();
    await sleep(30);
    r.undoLiveKept = Editor.getMarkdown().includes("追加尾部");

    // ---------- Tab 不再把焦点逃进渲染态单元格 ----------
    Editor.open("段落\\n\\n| A |\\n|---|\\n| 1 |\\n");
    const p1 = document.querySelector('[data-type="paragraph"]').dataset.cid;
    Editor._enterEdit(p1);
    await sleep(20);
    block(p1).dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true }));
    await sleep(30);
    r.tabNoEscape = !(document.activeElement && document.activeElement.dataset && document.activeElement.dataset.r !== undefined);

    // ---------- 贴图占位：marker→cid 登记（Chromium ClipboardEvent 构造器吞 clipboardData，
    // 真实 paste 不可合成——按 paste handler 同等语义白盒登记后测 onSaved 找回/清理） ----------
    Editor.open("甲段\\n\\n乙段\\n");
    const cids2 = [...document.querySelectorAll(".bm-block")].map(e => e.dataset.cid);
    Editor._enterEdit(cids2[0]);
    document.execCommand("insertText", false, "![uploading-e2e](uploading-e2e)");
    Editor._pasteTargets().set("uploading-e2e", cids2[0]);
    r.imgRegistered = Editor.getMarkdown().includes("uploading-e2e");
    Editor._enterEdit(cids2[1]);
    await sleep(20);
    Bridge.dispatch("images.onSaved", { marker: "uploading-e2e", url: "" });
    await sleep(30);
    r.imgCleanNoUrl = !Editor.getMarkdown().includes("uploading-");

    // ---------- 单元格换行不拆表 ----------
    Editor.open("| A | B |\\n|---|---|\\n| 1 | 2 |\\n");
    const t2 = document.querySelector('[data-type="table"]').dataset.cid;
    Editor._enterCellEdit(t2, 1, 0);
    document.querySelector('[data-r="1"][data-c="0"]').textContent = "a\\nb";
    document.querySelector('[data-r="1"][data-c="0"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(30);
    const mdT = Editor.getMarkdown();
    r.cellNewlineSafe = mdT.includes("a b") && !mdT.includes("a\\nb") && !!document.querySelector('[data-type="table"]');

    // ---------- javascript: 链接钝化 ----------
    Editor.open("[点我](javascript:alert(1))\\n");
    r.schemeSafe = !document.querySelector("#write a") || document.querySelector("#write a").getAttribute("href") === "#";

    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = JSON.stringify(r);
    document.body.appendChild(pre);
    const ok = Object.values(r).every(Boolean);
    document.title = ok ? "M8-E2E PASS" : "M8-E2E FAIL";
  } catch (e) {
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = "ERROR: " + e.message + "|" + (e.stack||"").split("\\n")[1];
    document.body.appendChild(pre);
    document.title = "M8-E2E ERROR";
  }
});
</script>
`;
html = html.replace("</body>", () => test + "\n</body>");
writeFileSync(join(root, "EditorResources", "e2e-m8.html"), html);
console.log("generated");
