<!--
Sync Impact Report（修订草稿，提交前移除）
- Version change: (无) → 1.0.0（首次订立）
- 新增原则: I 单一事实源 / II 被测物即交付物 / III 回归门禁先行 / IV 手感对标成熟编辑器 / V 原创与精简
- 新增章节: 跨层契约约束 / 开发流程 / Governance
- 删除章节: 无
- 遗留 TODO: 无（订立日期取首次成文日 2026-11-25）
-->

# BlockMark Constitution

## Core Principles

### I. 单一事实源（块源码即文档）
每个块对象的 `source` 字段是唯一事实源，DOM 只是它的派生物。

- 编辑态 DOM 的文本内容 MUST 恒等于对应块的源码。
- 向活 DOM 挂装饰元素（按钮/角标）的增强函数 MUST 排除处于编辑态的块。
- 状态登记（编辑中的块 / 单元格 / 代码编辑器）与真实焦点 MUST 一致：登记了编辑态，
  就 MUST 存在与之对应的、可编辑且持有焦点的元素；二者不一致即缺陷。
- 延时回调（blur / focusout / 定时器）MUST 在触发时校验其作用对象仍是当前事实
  （节点仍连接、身份相等），校验不通过 MUST NOT 提交或改写任何状态。

**理由**：项目历史上多次事故（编辑中保存丢字、陈旧定时器提交新状态、按钮文字被烤进源码）
都源于"DOM/登记状态/真实焦点"三者中有一个走了样。

### II. 被测物即交付物
应用加载的是构建期打平的 bundle，而不是源 ES module。

- 任何 e2e 或探针 MUST 先重新打包再测；MUST NOT 对着陈旧 bundle 下结论。
- 依赖原生行为的能力（焦点切换、光标落点、输入法、事件默认动作、滚轮/手势）
  MUST 在真实 WebKit 引擎里验证；Chromium headless 的合成事件结果不能替代。

**理由**：WKWebView 与 file:// 的组合有独有约束，合成事件不触发焦点事件与默认动作，
接线层缺陷在 Chromium e2e 下不可见。

### III. 回归门禁先行
- 每个缺陷修复 MUST 附带一个能区分"修复前失败 / 修复后通过"的回归用例。
- 变更合入前 MUST 全量通过：单元测试、全部 e2e 套件、应用构建；任何一项失败
  MUST 如实报告，不得表述为通过。
- 观感类断言 MUST 读取计算后的样式或几何（computed style、元素矩形），
  MUST NOT 以 class 名或 DOM 结构存在作为替代判据。

### IV. 手感对标成熟编辑器
编辑器交互以 Typora / Obsidian 一类成熟编辑器为对标。

- 用户点击何处，光标 MUST 落在何处对应的位置；MUST NOT 强制"先转源码态、再二次点击定位"。
- 渲染态与编辑态之间 MUST NOT 产生模式切换式的视觉或操作突兀。
- 同一次点击 MUST 至多产生一次状态切换；MUST NOT 出现"第一次点击被吞、第二次才生效"。
- 交互行为变更 MUST 以真实操作序列（点击/拖动/输入/组合键/输入法组合）验收。

### V. 原创与精简
- 全部代码、样式、图标 MUST 为原创或来自 MIT 许可的第三方库；
  MUST NOT 引入其他商业软件的代码、美术、主题或资源。
- 架构保持"原生薄壳 + 系统 WebKit + 自研块模型"；MUST NOT 引入 Electron 等运行时框架，
  或与编辑核心职责重复的前端框架。

## 跨层契约约束

- JS 与原生之间传递数据 MUST 使用 JSON 字面量序列化，MUST NOT 手写转义拼接。
- 样式表只允许块注释；Swift 源码 MUST NOT 出现弯引号；构建 MUST 显式指定部署目标。
- WKWebView 内的拖拽类交互，move/up 监听 MUST 挂在 window 级并由状态对象分发，
  MUST NOT 绑在会随重排移动的源元素上。
- 动态生成的界面元素 MUST 按类名或显式引用接线，MUST NOT 使用位置选择器。

## 开发流程

- 采用 Spec Kit：每个特性或缺陷修复 MUST 经 specify → plan → tasks → implement，
  产出物落在本仓库 `specs/` 目录下。
- 实施顺序 MUST 为测试先行：先写出会失败的回归用例，再写实现。
- 真机验证只允许定向手段（`open -a`、离屏探针台等）；MUST NOT 发送全局合成键鼠事件，
  MUST NOT 在用户使用机器时抢占前台焦点。

## Governance

- 本宪章约束所有后续 spec / plan / tasks / implement；合规性在 implement 收尾与发版评审时核对。
- 运行时开发指引以本文件与 README 的"已知坑"为准。
- 修订规则：新增原则或实质扩展为 MINOR，重定义或删除原则为 MAJOR，措辞澄清为 PATCH。
  修订 MUST 在文件顶部的同步影响报告（HTML 注释）中说明，提交前移除。
- 推送远端与发布版本 MUST 由仓库所有者明确裁决；自动化流程 MUST NOT 自行推送或发版。

**Version**: 1.0.0 | **Ratified**: 2026-11-25 | **Last Amended**: 2026-11-25
