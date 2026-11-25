// BlockMark 契约测试：跨工件硬编码一致性（漂移即红，跑在 npm test）
// 字号链路四入口共享的常量散落 Swift/JS/CSS 三处，此前靠人肉同步（评审轮 A1 建议）
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = p => readFileSync(join(root, p), "utf8");

let pass = 0, fail = 0;
const t = (name, cond, detail = "") => {
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fail++; console.error(`  ✗ ${name} ${detail}`); }
};

// 字号：Swift 钳制 ↔ JS ui.prefs 钳制 ↔ CSS 默认值 ↔ 设置滑杆引用常量
const swift = read("app/EditorWindowController.swift");
const js = read("EditorResources/editor/editor.js");
const css = read("EditorResources/editor.css");
const settings = read("app/SettingsWindowController.swift");
t("Swift 字号常量 10/32/16",
  /static let fontSizeMin: Double = 10, fontSizeMax: Double = 32, fontSizeDefault: Double = 16/.test(swift));
t("JS ui.prefs 钳制 10/32/默认 16",
  /Math\.min\(Math\.max\(\+data\.fontSize \|\| 16, 10\), 32\)/.test(js));
t("CSS --font-size-base 默认 16px", /--font-size-base:\s*16px/.test(css));
t("设置滑杆引用常量非字面量",
  /minValue: EditorWindowController\.fontSizeMin/.test(settings) &&
  /maxValue: EditorWindowController\.fontSizeMax/.test(settings) &&
  !/minValue:\s*10[,\s]/.test(settings));
t("UserDefaults key 单点定义全量引用",
  swift.includes('fontSizeKey = "BlockMark.fontSize"') && /forKey: fontSizeKey/.test(swift));

// 手势路由契约：JS 发送名 ↔ Swift case ↔ JS 注册名（viewer.zoom）
t("gestureRoute 契约闭环",
  js.includes('Bridge.call("ui.gestureRoute"') &&
  swift.includes('case "ui.gestureRoute"') &&
  js.includes('Bridge.register("viewer.zoom"') &&
  swift.includes('dispatchToJs("viewer.zoom"'));

// CSS 卫生：禁 // 注释（曾吞掉 display:none → 查看器关不掉的真机事故）
t("editor.css 无 // 注释", !/\/\//.test(css.replace(/https?:\/\//g, "")), "grep -n '//' 排查");

// e2e 套件数：run-e2e.sh 枚举 ↔ 生成器文件在库
const sh = read("tools/run-e2e.sh");
const suites = /SUITES=\(([^)]+)\)/.exec(sh)?.[1]?.split(/\s+/).filter(Boolean) ?? [];
t("run-e2e.sh 套件全有生成器", suites.every(s => read(`tools/gen-e2e-${s}.mjs`).length > 0), suites.join(","));
t("套件含 m11", suites.includes("m11"));
t("套件含 m12（点击落光标 / 点击生效）", suites.includes("m12"));

// 点击生效（specs/001-reliable-click-caret）：进入单元格编辑必须"先提交既有编辑态、后聚焦"。
// 旧实现把提交旧块寄托在 focusout 的延时回调上，回调在函数返回后才触发，会把刚进入的单元格一并提交掉
// （"编辑中的块 → 点单元格，首击被吞"）。这里从源码结构上钉死顺序，e2e/探针台从行为上钉死。
{
  const fn = js.slice(js.indexOf("function enterCellEditInner("), js.indexOf("function commitCellEdit("));
  t("enterCellEdit：先 commitEditing 后 td.focus()",
    fn.includes("commitEditing();") && fn.indexOf("commitEditing();") < fn.indexOf("td.focus()"));
  t("enterCellEdit：先登记 cellEditing 后聚焦", fn.indexOf("cellEditing = {") < fn.indexOf("td.focus()"));
  t("focusout 延时回调按失焦目标校验身份",
    /if \(editingCid !== cid\) return;/.test(js) && /cellEditing\.td === cellTd/.test(js));
  t("空白区兜底按分发路径判定", /composedPath\(\)/.test(js) && js.includes("reconcileEditingState();"));
}
// 诊断导出（US5）：页面侧只读接口 ↔ 原生菜单项与带超时的导出动作
const appDel = read("app/AppDelegate.swift");
t("诊断：Editor._diag 与 ≥60 条的环形缓冲",
  /_diag: \(\) => JSON\.stringify\(/.test(js) && /const TRACE_MAX = (\d+)/.exec(js)?.[1] >= 60);
t("诊断：应用菜单项 ↔ 原生导出动作",
  appDel.includes("导出编辑器诊断信息") &&
  appDel.includes("#selector(EditorWindowController.exportDiagnostics(_:))") &&
  swift.includes("func exportDiagnostics(") && swift.includes('"Editor._diag()"'));
t("诊断：页面无响应时 5 秒内提示", /asyncAfter\(deadline: \.now\(\) \+ 5\)/.test(swift) && swift.includes("编辑器无响应"));
// Swift 卫生：新增代码不得把弯引号当代码定界符（已知坑：写中文串时混入 “ ” 会让 swiftc 报错）。
// 只查代码段——既有界面文案与注释里合法使用中文引号，不在限制之列。
{
  const a = swift.indexOf("func exportDiagnostics(");
  const body = swift.slice(a, swift.indexOf("// MARK:", a + 1));
  t("exportDiagnostics 代码段无弯引号", a > 0 && !/[“”]/.test(body));
  t("AppDelegate 菜单代码无弯引号", !/[“”]/.test(appDel.slice(appDel.indexOf("private func buildMenus()"), appDel.indexOf("NSApplication.shared.mainMenu"))));
}

console.log(`\n结果: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
