# Implementation Plan: 可靠点击与点击落光标

**Branch**: `001-reliable-click-caret`（规格目录；在 `main` 上开发，未建分支——Spec Kit 1.4.4 默认不建分支，分支与提交由仓库所有者决定） | **Date**: 2026-11-25 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/001-reliable-click-caret/spec.md`

## Summary

修复编辑器点击交互的两类缺陷并补齐"点击即落光标"能力：
(1) 从编辑中的块去点表格时点击被吞——根因是"提交旧会话"寄生在焦点事件的延时回调里；
(2) 点击渲染态内容光标恒落块尾——根因是按下事件吞掉原生落点后总按"块尾"放置，且空白区兜底会把光标二次拽回块尾。
方案：状态切换显式化并加一致性自愈；以真实渲染结果为锚做字符对齐，把渲染态命中位置换算成源码偏移；
配套拖选、双击选词与诊断导出；输入法处理经实测无缺陷，以回归用例守卫。测试先行，并新增系统 WebKit 探针台覆盖焦点级行为。

## Technical Context

**Language/Version**: JavaScript（ES2020，构建期由 `tools/bundle.mjs` 打平为经典脚本）；Swift 6（swiftc，部署目标 macOS 13.0）；Bash / Python 3 仅用于测试工具

**Primary Dependencies**: 无新增。沿用 CodeMirror 5.65 / KaTeX 0.16 / mermaid 9；分词使用平台自带的 `Intl.Segmenter`

**Storage**: N/A（无持久化数据）

**Testing**: `node` 单元测试；headless Chromium e2e（Edge，`--dump-dom` 断言 `<title>`）；新增系统 WebKit 探针台（离屏 WKWebView + 真实 NSEvent 鼠标事件）

**Target Platform**: macOS 13+（WKWebView）

**Project Type**: desktop-app（原生薄壳 + 系统 WebKit + 自研块模型编辑器）

**Performance Goals**: 单击处理耗时 < 50ms（不含系统渲染）；不引入可感知的输入延迟

**Constraints**: 不引入运行时框架或第三方库；不改"整块显示源码"的编辑模型；探针台不得抢占前台焦点或发送全局键鼠

**Scale/Scope**: 改动集中在 `EditorResources/editor/`（两个文件）与 `app/`（两个文件各加一小段），新增测试与工具

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| 原则 | 结论 | 依据 |
|------|------|------|
| I. 单一事实源 | ✅ 满足 | 落点映射以真实渲染输出为锚并有对拍单测守漂移；一致性不变量（FR-012）落到每次鼠标按下与延时回调的校验上；提交前一律读取 DOM 活文本 |
| II. 被测物即交付物 | ✅ 满足 | 所有 e2e 与探针台在 `node tools/bundle.mjs` 之后运行；焦点级行为在系统 WebKit 里验证，Chromium 合成事件只覆盖不涉及原生焦点事件的部分 |
| III. 回归门禁先行 | ✅ 满足 | 每个缺陷先写"修复前失败"的用例再改实现；收尾全量跑单测 + 14 套 e2e + 探针台 + 构建；落点断言读取真实选区位置 |
| IV. 手感对标成熟编辑器 | ✅ 满足 | 点击即落光标、首次按下即可拖选、双击选词、单击链接不跳转；以真实操作序列验收 |
| V. 原创与精简 | ✅ 满足 | 零新增依赖；分词用平台 API；探针台是开发期工具，不进应用包 |

**Phase 1 复查**：设计未偏离以上结论。无需要豁免的违规项。

## Project Structure

### Documentation (this feature)

```text
specs/001-reliable-click-caret/
├── plan.md              # 本文件
├── research.md          # 调研决策（RQ-001 ~ RQ-009）
├── data-model.md        # 编辑会话 / 按下手势 / 落点映射 / 诊断记录
├── quickstart.md        # 验证与运行指南
├── contracts/
│   └── editor-click-api.md   # 模块导出、Editor 对象、JS↔原生、事件行为、探针台脚本格式
└── tasks.md             # 任务清单
```

### Source Code (repository root)

```text
EditorResources/editor/
├── inline.js            # 改：新增 plainTextOf / visibleIndexMap / blockLineMap / caretSourceOffset；正则提为模块级常量供复用
└── editor.js            # 改：落点换算(DOM 侧)、按下分发、enterEdit 偏移参数、enterCellEdit 显式提交、
                         #      focusout 加固、一致性校验与自愈、拖选、双击选词、诊断记录与 _diag
app/
├── AppDelegate.swift    # 改：应用菜单加「导出编辑器诊断信息」
└── EditorWindowController.swift   # 改：导出动作（5 秒超时 → 剪贴板 / 无响应提示）
test/
├── caret-map.test.mjs   # 新：落点映射单测（含与真实渲染的对拍）
└── contract.test.mjs    # 改：新增契约断言
tools/
├── gen-e2e-m12.mjs      # 新：点击落光标 e2e 套件
├── run-e2e.sh           # 改：套件清单加 m12
├── run-webkit.sh        # 新：探针台一键（打包 → 编译探针 → 场景 + 定种子随机）
└── webkit-probe/        # 新：探针台本体与场景脚本
    ├── main.swift
    ├── build.sh
    ├── run.py
    └── scenarios/*.json
package.json             # 改：test 脚本纳入新单测
.gitignore               # 改：忽略探针台二进制
README.md                # 改：特性描述、测试说明、Spec Kit 流程
```

**Structure Decision**: 沿用仓库既有的单项目结构（`EditorResources/editor/` 源码、`app/` 原生壳、`test/` 单测、`tools/` 生成器与工具）。
不为探针台另立包：它是本仓库专用的开发期工具，与 e2e 生成器同级放在 `tools/`，二进制不进版本库与应用包。

## 设计要点（实现依据）

1. **落点换算分两层**：纯函数层（`inline.js`）负责"一行正文 → 可见字符↔源码下标表"；
   DOM 层（`editor.js`）负责把点击坐标定位到"块内第几行、第几个可见字符、字符前半还是后半"，
   再用纯函数层的结果拼出源码偏移。纯函数层可在 Node 里穷举测试。
2. **一次迁移一个任务**：进入任何新会话前先 `reconcile`（修复不一致）再 `commitEditing`（提交当前会话），
   然后登记、聚焦。聚焦过程中派发的焦点事件一律忽略；延时回调按登记时的标识校验。
3. **空白区兜底改用分发路径判定**，不再依赖冒泡时的 DOM 查询。
4. **手势**：首次按下创建手势记录（锚点 + 该行映射）；`mousemove`（按住）扩展选区；`dblclick` 用映射选词。
5. **输入法**：不改 `compositionend` 的处理（实测现有实现满足 FR-014，见 research.md RQ-006），只以探针台场景守卫。
6. **诊断**：页面侧环形记录 + `Editor._diag()`；原生侧菜单项带 5 秒超时。

## 测试策略

| 层 | 覆盖 | 基建 |
|----|------|------|
| 纯函数 | 映射完整性/单调性/与渲染逐字一致；各类前缀长度 | `test/caret-map.test.mjs` |
| 交互（不涉焦点事件） | 点击落点、链接单击/⌘点击、空白区只进一次编辑、拖选、双击 | `tools/gen-e2e-m12.mjs`（Chromium） |
| 交互（涉焦点事件） | 点击生效性、状态↔焦点一致性、输入法契约、切换应用 | `tools/webkit-probe/`（系统 WebKit） |
| 随机 | 不变量：有编辑态必有焦点与光标；点击必生效；有编辑态则打字必落地 | 探针台定种子随机序列，修复前后同种子对比 |

## 风险与对策

| 风险 | 对策 |
|------|------|
| 用户的原始"卡住"路径未被覆盖 | 一致性自愈保证"下一次点击必恢复"；诊断导出区分线程卡死与状态不一致 |
| 映射与渲染规则随时间漂移 | 对拍单测进 `npm test`；对齐不完整即退化，不产生错误落点 |
| 源码态文字位移造成视觉错位 | 属既有模型，规格中明示不在范围；落点以逻辑位置为准 |
| 探针台模拟输入法失真 | 只用真实契约（显式替换范围）；契约写进 contracts，脚本带 `replace` 校验 |
| 改动触及编辑核心 | 不改渲染函数与提交语义；全部既有套件必须保持通过 |

## Complexity Tracking

无违规项，无需记录。
