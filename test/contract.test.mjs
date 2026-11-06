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

console.log(`\n结果: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
