// 生成 M6 轮 e2e：空文档/空白区可编辑 + 表格右键菜单（插删行列/删表/进格粘贴）
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
let html = readFileSync(join(root, "EditorResources", "index.bundle.html"), "utf8");
const test = String.raw`<script>
window.addEventListener("DOMContentLoaded", async () => {
  const r = {};
  const sleep = ms => new Promise(ok => setTimeout(ok, ms));
  const st = () => Editor._editingState();
  try {
    // ---------- 空文档：空白区点击可编辑（新建/直接打开 APP 的死区修复） ----------
    Editor.open("");
    document.getElementById("write").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientY: 400 }));
    r.blankEmptyEdits = !!st().editingCid;
    const el1 = document.querySelector(".bm-editing");
    r.blankEmptyFocused = !!(el1 && document.activeElement === el1);
    document.execCommand("insertText", false, "落笔");
    r.blankEmptyTyped = !!(el1 && el1.textContent.includes("落笔"));
    el1.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(30);
    r.blankEmptyCommitted = Editor.getMarkdown().includes("落笔");

    // ---------- 文档中部/上方空白点击定位 ----------
    Editor.open("首段\n\n中段\n\n| T |\n|---|\n| 1 |\n");
    const cids = [...document.querySelectorAll(".bm-block")].map(e => e.dataset.cid);
    // 点末块(表格)下方 → 表格后补空段并进入
    document.getElementById("write").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientY: 580 }));
    r.blankAfterTable = st().editingCid !== null && st().editingCid !== cids[2] &&
                        document.querySelectorAll(".bm-block").length === 4;
    Editor.undo();
    await sleep(30);
    // 点首段上方 padding → 进首段开头
    document.getElementById("write").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientY: 10 }));
    r.blankAboveFirst = st().editingCid === cids[0];
    // 点在第二块竖直范围内的左右留白 → 进第二块
    const mid = document.querySelector('[data-cid="' + cids[1] + '"]').getBoundingClientRect();
    document.getElementById("bm-main").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientY: (mid.top + mid.bottom) / 2 }));
    r.blankBesideSecond = st().editingCid === cids[1];
    // 空段复用：文档末尾已是空段时不再叠加
    Editor.open("内容\n");
    Editor._enterEdit(document.querySelector(".bm-block").dataset.cid);
    document.querySelector(".bm-editing").dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    await sleep(30);   // 拆出末尾空段
    const before = document.querySelectorAll(".bm-block").length;
    document.getElementById("write").dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientY: 500 }));
    r.blankReuseEmpty = st().editingCid !== null && document.querySelectorAll(".bm-block").length === before;

    // ---------- 右键不再闪现源码编辑态 ----------
    Editor.open("普通段\n");
    const pCid = document.querySelector(".bm-block").dataset.cid;
    document.querySelector('[data-cid="' + pCid + '"]').dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 2 }));
    r.rightClickNoEdit = st().editingCid === null;

    // ---------- 右键菜单：表格项收集 ----------
    Editor.open("| A | B |\n|:-:|--:|\n| a1 | a2 |\n| b1 | b2 |\n");
    const tCid = document.querySelector('[data-type="table"]').dataset.cid;
    const origCall = Bridge.call.bind(Bridge);
    let cap = null;
    Bridge.call = (n, d) => { if (n === "menu.showContext") cap = d; else origCall(n, d); };
    document.querySelector('[data-r="1"][data-c="0"]').dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    const cmds = () => new Set((cap && cap.items || []).map(i => i.cmd).filter(Boolean));
    r.ctxDataCell = cmds().has("table.insertRowAbove") && cmds().has("table.insertRowBelow") &&
                    cmds().has("table.deleteRow") && cmds().has("table.insertColLeft") &&
                    cmds().has("table.insertColRight") && cmds().has("table.deleteCol") &&
                    cmds().has("table.deleteTable");
    r.ctxCoords = !!(cap && cap.tr === 1 && cap.tc === 0 && cap.cid === tCid);
    document.querySelector('[data-r="0"][data-c="0"]').dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    r.ctxHeaderGuard = !cmds().has("table.insertRowAbove") && !cmds().has("table.deleteRow") &&
                       cmds().has("table.insertRowBelow");
    Editor.open("| 只有一列 |\n|---|\n| 1 |\n");
    document.querySelector('[data-r="1"][data-c="0"]').dispatchEvent(new MouseEvent("contextmenu", { bubbles: true }));
    r.ctxSingleColGuard = !cmds().has("table.deleteCol") && cmds().has("table.deleteTable");
    Bridge.call = origCall;

    // ---------- 表格命令：插行 ----------
    Editor.open("| A | B |\n|:-:|--:|\n| a1 | a2 |\n| b1 | b2 |\n");
    const src = Editor.getMarkdown();
    const run = (cmd, tr, tc, cid) => Bridge.dispatch("menu.onCommand", { cmd, cid: cid || document.querySelector('[data-type="table"]').dataset.cid, tr, tc });
    // 语义比较：增删操作会重拼表格源码（紧凑 |-:-| 规范化为 | :---: |），文本直比必假
    const tblOf = md => tableParse(md.split("\n").filter(l => l.trim().startsWith("|")).join("\n"));
    run("table.insertRowBelow", 1, 0);
    await sleep(30);
    r.insRowBelow = Editor.getMarkdown().split("\n").length === src.split("\n").length + 1 &&
                    st().cellEdit && st().cellEdit.r === "2" && st().cellEdit.c === "0";
    r.insRowKeepData = tableRowHas("a1", 1) && tableRowHas("b1", 3);   // 原行下移
    Editor.undo();
    await sleep(30);
    r.insRowUndo = Editor.getMarkdown() === src;
    run("table.insertRowAbove", 1, 0);
    await sleep(30);
    r.insRowAbove = tableRowHas("a1", 2);
    run("table.deleteRow", 1, 0);   // 删掉刚插的空行
    await sleep(30);
    const tDel = tblOf(Editor.getMarkdown());
    r.delRow = tDel.rows.length === 3 && tDel.rows[1][0] === "a1" && tDel.aligns.join() === "center,right";

    // ---------- 插列/删列（对齐继承） ----------
    run("table.insertColRight", 0, 1);
    await sleep(30);
    r.insColFocus = st().cellEdit && st().cellEdit.r === "0" && st().cellEdit.c === "2";
    const cols = document.querySelectorAll('[data-r="1"]').length;
    r.insColCount = cols === 3;
    r.insColAlign = tblOf(Editor.getMarkdown()).aligns.join() === "center,right,right";   // 新列继承右邻(原B列右对齐)
    run("table.deleteCol", 0, 2);
    await sleep(30);
    const tDelCol = tblOf(Editor.getMarkdown());
    r.delCol = tDelCol.rows[0].length === 2 && tDelCol.rows[0][0] === "A" && tDelCol.aligns.join() === "center,right";

    // ---------- 守卫：表头行/越界直发命令无操作 ----------
    const before6 = Editor.getMarkdown();
    run("table.insertRowAbove", 0, 0);
    run("table.deleteRow", 0, 0);
    run("table.deleteCol", 9, 9);
    await sleep(30);
    r.guardNoop = Editor.getMarkdown() === before6;

    // ---------- 删表 ----------
    run("table.deleteTable", 1, 0);
    await sleep(30);
    r.delTable = !document.querySelector('[data-type="table"]') &&
                 document.querySelectorAll(".bm-block").length === 1 &&
                 !Editor.getMarkdown().includes("|");

    // ---------- 右键进格粘贴 ----------
    Editor.open("| A | B |\n|---|---|\n| a1 | a2 |\n");
    const pc = document.querySelector('[data-type="table"]').dataset.cid;
    Bridge.dispatch("menu.onCommand", { cmd: "paste", text: "贴入", cid: pc, tr: 1, tc: 1 });
    await sleep(30);
    r.pasteCellEditing = st().cellEdit && st().cellEdit.r === "1" && st().cellEdit.c === "1";
    r.pasteCellText = document.querySelector('[data-r="1"][data-c="1"]').textContent.includes("贴入");
    document.querySelector('[data-r="1"][data-c="1"]').dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(30);
    r.pasteCellCommit = Editor.getMarkdown().includes("| a1 | 贴入 |");

    // ---------- 右键段落粘贴（无编辑态兜底） ----------
    Editor.open("目标段\n");
    const pCid2 = document.querySelector(".bm-block").dataset.cid;
    Bridge.dispatch("menu.onCommand", { cmd: "paste", text: "追加", cid: pCid2 });
    await sleep(80);
    r.pastePara = document.querySelector('[data-cid="' + pCid2 + '"]').textContent.includes("追加");

    function tableRowHas(text, r) {
      const row = [...document.querySelectorAll('[data-r="' + r + '"]')].map(e => e.textContent);
      return row.some(c => c.includes(text));
    }

    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = JSON.stringify(r);
    document.body.appendChild(pre);
    const ok = Object.values(r).every(Boolean);
    document.title = ok ? "M6-E2E PASS" : "M6-E2E FAIL";
  } catch (e) {
    const pre = document.createElement("pre");
    pre.id = "e2e-result";
    pre.textContent = "ERROR: " + e.message + "|" + (e.stack||"").split("\n")[1];
    document.body.appendChild(pre);
    document.title = "M6-E2E ERROR";
  }
});
</script>
`;
html = html.replace("</body>", () => test + "\n</body>");
writeFileSync(join(root, "EditorResources", "e2e-m6.html"), html);
console.log("generated");
