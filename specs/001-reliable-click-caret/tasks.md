# Tasks: 可靠点击与点击落光标

**Input**: Design artifacts from `/specs/001-reliable-click-caret/`
**Prerequisites**: plan.md (required), spec.md (required), research.md, data-model.md, contracts/editor-click-api.md, quickstart.md

**Tests**: 本特性要求测试先行（项目宪章原则 III）：每个用户故事先写会失败的用例，再写实现。

**Organization**: 按用户故事组织。每个故事可独立实现与验证；故事内部测试先于实现。

## Format: `[ID] [P?] [Story] Description`

- 所有任务遵守 `- [ ] T### [P?] [US?] 描述 + 文件路径` 格式；`[P]` 表示可与同阶段其他任务并行（不同文件、无未完成依赖）。
- 完成后把 `[ ]` 改为 `[x]`。

## Path Conventions

- 源码：`EditorResources/editor/`（页面）、`app/`（原生壳）
- 测试：`test/`（单测）、`tools/gen-e2e-*.mjs`（e2e 生成器）、`tools/webkit-probe/`（系统 WebKit 探针台）
- 规格与设计：`specs/001-reliable-click-caret/`

## Phase 1: Setup (Shared Infrastructure)

- [x] T001 初始化 Spec Kit（ZCode 集成）并订立项目宪章：`.specify/memory/constitution.md`、`.specify/`、`.zcode/skills/speckit-*`
- [x] T002 [P] 系统 WebKit 探针台入库：整理调查用原型为 `tools/webkit-probe/main.swift` 与 `tools/webkit-probe/build.sh`（离屏窗口、伪造 key 窗口状态、真实 NSEvent 鼠标事件、按 `contracts/editor-click-api.md` §5 的脚本格式回放；输入法只保留真实契约；每步探活与一致性校验）
- [x] T003 [P] 探针台运行器：`tools/webkit-probe/run.py`（跑全部场景 + 定种子随机序列，任一违例非零退出）与一键脚本 `tools/run-webkit.sh`（打包 → 编译 → 运行）
- [x] T004 [P] 收口基建配置：`.gitignore` 忽略探针台二进制；`package.json` 的 `test` 纳入 `test/caret-map.test.mjs`

## Phase 2: Foundational (Blocking Prerequisites)

- [x] T005 落点映射单测（先红）：`test/caret-map.test.mjs` —— `plainTextOf`、`visibleIndexMap`（完整性、单调、与真实行内渲染逐字对拍、各类行内语法与中文）、`inlinePrefix`（标题/列表/任务/引用/延续行）
- [x] T006 实现落点映射纯函数层：`EditorResources/editor/inline.js` 导出 `plainTextOf` / `visibleIndexMap` / `inlinePrefix`，复用现有定界符识别逻辑（正则提为模块级常量），对齐不完整即 `ok=false`；使 T005 转绿且 `npm test` 全绿

---

## Phase 3: User Story 1 - 一次点击一次生效 (Priority: P1) 🎯 MVP

**Goal**: 从任意编辑状态单击表格单元格或别处可编辑目标，一次点击完成切换，旧内容保留，新目标持焦可输入。

**Independent Test**: 正文编辑态 → 单击单元格 → 单元格立即持焦，输入进入单元格；同样覆盖"→ 表格旁空白""单元格编辑态 → 别处""表格源码态 → 正文"。

### Tests for User Story 1

- [x] T007 [US1] 探针台场景（先红）：`tools/webkit-probe/scenarios/eaten-click.json` —— 编辑中的块 → 点单元格 / → 点表格旁空白；单元格编辑态 → 点正文；表格源码态 → 点正文；每条带点击生效性断言与"打字必落地"
- [x] T008 [P] [US1] e2e 用例（先红）：`tools/gen-e2e-m12.mjs` 的"块内容点击只触发一次进入编辑"断言（空白区兜底不得二次进入并把光标拽回块尾）；`tools/run-e2e.sh` 套件清单加 `m12`

### Implementation for User Story 1

- [x] T009 [US1] 显式化状态切换：`EditorResources/editor/editor.js` 的 `enterCellEdit` 先提交所有既有编辑态、按坐标重解析目标、先登记后聚焦；`focusout` 延时回调按登记时的标识校验，程序化切换期间忽略焦点事件（依据 `data-model.md` 的 EditingSession 不变量与迁移规则）
- [x] T010 [US1] 空白区兜底改用分发路径判定：`EditorResources/editor/editor.js` 滚动容器的 mousedown 处理器改用 `composedPath()` 判断点击是否发生在块内
- [x] T011 [US1] 一致性校验与自愈：`EditorResources/editor/editor.js` 新增 `reconcileEditingState()`（每次左键按下处理前调用；不满足 `data-model.md` 的 EditingSession 不变量 ⇒ 先读 DOM 活文本提交再清除登记）与测试钩子 `Editor._reconcile()`；同时建立诊断环形缓冲的最小埋点（进入/提交编辑）

**Checkpoint**: `./tools/run-webkit.sh` 中 eaten-click 场景全绿；`node tools/gen-e2e-m12.mjs` 生成套件通过。

---

## Phase 4: User Story 2 - 点哪里，光标落在哪里 (Priority: P1)

**Goal**: 单击渲染态文本的任意位置，光标落在对应源码位置，可立即输入。

**Independent Test**: 对标题/列表/引用/多行段落/粗体/行内代码/链接/表格旁空白逐例单击并输入一个字符，核对文档内容与光标位置。

### Tests for User Story 2

- [x] T012 [US2] e2e 用例（先红）：`tools/gen-e2e-m12.mjs` 的落点用例 —— 段落前/中/后、标题前缀之后、粗体定界符两侧、多行列表第二行、引用行、行内代码之后、链接文字内、行尾空白、单击链接不打开且 ⌘点击打开
- [x] T013 [P] [US2] 探针台场景（先红）：`tools/webkit-probe/scenarios/click-caret.json` —— 真实鼠标坐标点击 + 打字验证落点（同上用例集 + 表格旁空白落在被点击行行尾 + 块下边缘归入该行）

### Implementation for User Story 2

- [x] T014 [US2] DOM 侧落点定位：`EditorResources/editor/editor.js` 新增 `resolveCaretTarget(blockEl, x, y)`（枚举块内渲染行、把命中位置换算为可见字符索引与前/后半亲和、调用 `visibleIndexMap` 与 `inlinePrefix` 拼出源码偏移；表格按被点击行取行尾；失败退化行尾）与钩子 `Editor._resolveCaretOffset`（对应 `data-model.md` 的 CaretMap）
- [x] T015 [US2] 按偏移进入编辑：`EditorResources/editor/editor.js` 的 `enterEdit` 增加光标偏移参数；mousedown 分发在改写 DOM 前取样命中并换算，再进入编辑并按偏移放置光标；链接改为 ⌘/Ctrl 点击打开、单击落光标
- [x] T016 [US2] 按下手势记录：`EditorResources/editor/editor.js` 在首次按下使块进入编辑态时创建 PressGesture（字段见 `data-model.md`：cid、startedAt、anchor、lineMap、lineText），松开或超时失效

**Checkpoint**: `./tools/run-e2e.sh` 的 m12 通过；`./tools/run-webkit.sh` 的 click-caret 场景通过。

---

## Phase 5: User Story 3 - 连续手势不打断 (Priority: P2)

**Goal**: 首次按下即可拖选；双击选中被双击的词（含中文）。

**Independent Test**: 未点击过的渲染态段落：按下拖过几个字松开，选区恰为这几个字；双击中文词，选区恰为该词。

### Tests for User Story 3

- [x] T017 [US3] 探针台场景（先红）：`tools/webkit-probe/scenarios/gestures.json` —— 真实按下/拖动/松开的选区断言；真实双击的选词断言（中文词与英文词）
- [x] T018 [P] [US3] e2e 用例（先红）：`tools/gen-e2e-m12.mjs` 的拖选与双击选词断言

### Implementation for User Story 3

- [x] T019 [US3] 拖动选择：`EditorResources/editor/editor.js` 在手势有效且鼠标按住移动时，以 anchor 为基点、用源码 DOM 上的命中测试扩展选区；松开/取消时清理
- [x] T020 [US3] 双击选词：`EditorResources/editor/editor.js` 监听 `dblclick`，用 `Intl.Segmenter` 在手势记录的 `lineText` 上分词，经 `lineMap` 换算源码区间并设置选区

**Checkpoint**: gestures 场景与 m12 的手势用例通过。

---

## Phase 6: User Story 4 - 输入法友好 (Priority: P2)

**Goal**: 拼音连续输入、组合中切走、提交后点击别处，均保持内容与光标正确。

**Independent Test**: 按真实输入法协议模拟"标记→标记→提交"三次，每步后输入一个字母，核对内容与光标。

### Tests for User Story 4

- [x] T021 [US4] 探针台场景（守卫用例）：`tools/webkit-probe/scenarios/ime.json` —— 三词连续输入、组合未提交时点击别处、表格源码内输入后点击正文；全部带"打字必落地"与焦点一致性断言

### Implementation for User Story 4

- [x] T022 [US4] （验证后撤销原计划的改动）`EditorResources/editor/editor.js` 的 `compositionend` 保持现状。原计划"重绘推迟一个宏任务"是基于对引擎时序的怀疑；按真实输入法契约实测（修正探针台调用约定后）：段尾/段中/单元格内/表格源码内连续 6 个拼音词、各档上屏节奏全部正确，光标始终在位——现有实现没有缺陷，没有证据就不动正常工作的代码。FR-014 改为"已验证的性质"，以 `tools/webkit-probe/scenarios/ime.json` 作回归守卫；本任务只补了组合起止的诊断留痕

**Checkpoint**: ime 场景通过；已有 e2e 套件全部保持通过。

---

## Phase 7: User Story 5 - 偶发问题可追溯 (Priority: P3)

**Goal**: 一键导出编辑器诊断信息；页面无响应时 5 秒内明确提示。

**Independent Test**: 做几次点击与输入后执行菜单命令，剪贴板得到含时间戳的 JSON；（人工核对）无响应提示文案存在。

### Tests for User Story 5

- [x] T023 [P] [US5] 契约断言：`test/contract.test.mjs` 新增 —— `Editor._diag` 在源码中定义并导出；`app/AppDelegate.swift` 含「导出编辑器诊断信息」菜单项；`app/EditorWindowController.swift` 含对应动作与 5 秒超时

### Implementation for User Story 5

- [x] T024 [US5] 诊断记录与导出接口：`EditorResources/editor/editor.js` 扩充环形缓冲埋点（单元格进出、焦点进出、输入法组合起止、一致性修复、鼠标按下摘要，字段见 `data-model.md` 的 TraceEntry）并实现 `Editor._diag()`（含一致性检查结果，纯读取）
- [x] T025 [US5] 原生导出：`app/AppDelegate.swift` 应用菜单加「导出编辑器诊断信息」；`app/EditorWindowController.swift` 实现动作——求值 `Editor._diag()`，成功写入剪贴板并提示，5 秒未返回则提示"编辑器无响应"

**Checkpoint**: `./build.sh` 成功；契约测试通过。

---

## Phase 8: Polish & Cross-Cutting Concerns

- [x] T026 全量回归门禁（2026-11-25 13:12，一条命令串跑，GATE EXIT=0）：单测 217 项全过（105/20/27/46/19）；e2e 14 套全 PASS；
      系统 WebKit 探针台 4 个场景文件全 PASS、300 条随机序列 0 条违例；`build.sh` 成功，App 包内编辑器脚本与被测 bundle 校验和一致
- [x] T027 修复前后对比（同一批随机种子，种子相同即序列相同）：

      | 指标 | 修复前（快照） | 修复后 |
      |------|----------------|--------|
      | 定向场景违例数（落点 / 点击生效 / 手势 / 输入法） | 21 / 19 / 6 / 1 | 0 / 0 / 0 / 0 |
      | 300 条随机点击序列中出现违例的序列数 | 134（约 45%） | 0 |
      | Chromium e2e m12（修复前 28 项可比断言） | 23 项失败 | 35 项全过 |

      修复前的违例全部是"点击被吞"（CLICK-EATEN）。已把实测基线回填 `spec.md` 的 SC-001 与 `research.md` 的 RQ-003。
- [x] T028 [P] 文档：`README.md` 更新特性描述（点击落光标、单击链接行为）、测试说明（单测/e2e 套数、探针台用法）、开发流程（Spec Kit）；校对 `specs/001-reliable-click-caret/quickstart.md` 与实际命令一致
- [ ] T029 真机冒烟（不部署 /Applications）——**本次未执行，留给仓库所有者**：启动 App 会把窗口弹到前台抢焦点，自动化代做可能打断正在使用电脑的人。
      已备好带验收步骤的测试文档，一条命令即可：`open build/BlockMark.app tools/webkit-probe/fixtures/点击落点验收.md`
      （逐项核对见 `quickstart.md` 第 4 节）。未在真机确认过的部分只有原生菜单项「导出编辑器诊断信息」的实际点击；
      页面侧行为已在系统 WebKit 探针台里用真实鼠标事件验证。

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 已完成；T002–T004 互不依赖
- **Foundational (Phase 2)**: T005 → T006（先红后绿）；阻塞 US2
- **User Stories**: US1 依赖 T002/T003（需要探针台才能证明"先红"）；US2 依赖 Phase 2 与 US1 的 T011（一致性校验）；US3 依赖 US2 的 T016（手势记录）；US4、US5 只依赖 Phase 1
- **Polish**: 依赖全部故事完成

### User Story Dependencies

- **US1 (P1)**: 独立可测；其中 T010/T011 是 US2 的前置
- **US2 (P1)**: 依赖 Phase 2（映射）与 US1 的状态切换修复
- **US3 (P2)**: 依赖 US2 的手势记录
- **US4 (P2)**: 独立
- **US5 (P3)**: 独立（T011 已建最小埋点）

### Within Each User Story

- 测试先写并确认失败，再写实现
- 每个故事完成后在其 Checkpoint 上独立验证，再进入下一个

### Parallel Opportunities

- T002、T003、T004 互不依赖
- T007 与 T008（不同文件）；T012 与 T013；T017 与 T018
- US4（T021/T022）与 US5（T023–T025）可与 US2/US3 并行

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. T002–T004：探针台与配置入库
2. T007：eaten-click 场景在修复前快照上失败（红）
3. T009–T011：显式化切换 + 空白区判定 + 一致性自愈
4. **STOP and VALIDATE**: eaten-click 场景转绿；既有套件全绿

### Incremental Delivery

1. US1 → 点击不再被吞
2. US2 → 点击即落光标
3. US3 → 拖选与双击
4. US4 → 输入法加固
5. US5 → 诊断导出
6. 收尾：全量门禁、前后对比、文档

---

## Notes

- `[P]` = 不同文件、无未完成依赖，可并行
- 每个故事独立可测；在其 Checkpoint 验证后再进入下一个
- 验证测试在实现前确实失败（红→绿）
- 本轮不提交、不推送、不部署到 /Applications，由仓库所有者裁决
