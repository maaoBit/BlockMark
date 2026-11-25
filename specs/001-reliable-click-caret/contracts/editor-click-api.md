# Interface Contracts: 可靠点击与点击落光标

**Date**: 2026-11-25
**Feature**: [spec.md](./spec.md)
**Scope**: 行内模块导出、编辑器对外对象、JS↔原生诊断通道、探针台脚本格式

## 1. 行内模块（`EditorResources/editor/inline.js`）新增导出

所有函数为纯函数，不触碰 DOM。签名以参数与返回值为准，调用方不依赖内部实现。

```text
plainTextOf(html: string) -> string
  把行内渲染产出的 HTML 还原为"可见文本"（等价于该 HTML 的 textContent）。
  约束：只剥离标签并解码 &lt; &gt; &quot; &amp;，不做其他改写。

visibleIndexMap(body: string) -> { ok: boolean, visible: string, toSrc: Int32Array }
  body：某一行去掉块级前缀后的源码正文。
  返回：visible = plainTextOf(renderInline(body))；toSrc[i] = 第 i 个可见字符在 body 中的起始下标。
  约束：
    - ok 为真 ⇔ toSrc 覆盖 visible 的全部字符；
    - ok 为真时 toSrc 严格单调递增，且 body[toSrc[i]] === visible[i]；
    - ok 为假时调用方必须退化为行尾/行首，不得使用 toSrc。
  漂移守卫：对拍语料里 visible 必须与真实渲染结果逐字相同（见单测）。

blockLineMap(block) -> Array<{ start, text, prefix }> | null
  block：块对象（含 type 与 source）。返回该块的渲染行清单，按渲染顺序：
    - start：该行在块源码中的起始下标；text：该行源码；prefix：该行渲染后不可见的前缀长度
      （标题的 "# "、列表符号与任务框、引用符；列表延续行被渲染裁掉的行首空白）；
    - 段落/引用/表格逐行对应；标题只一行（setext 的下划线行不占）；列表的空行不占渲染行；
    - 代码/公式/分隔线等不提供落点的块返回 null。

caretSourceOffset(lines, li, v, preferPrev) -> number | null
  lines：blockLineMap 的结果；li：渲染行下标；v：该行内可见字符下标（光标落在第 v 个可见字符之前，
  v 等于行长即行尾）；preferPrev：点击落在前一个可见字符的后半。
  返回块源码中的光标偏移。两侧可见字符之间夹着不可见语法时，preferPrev 为真落在语法之前，否则落在语法之后。
  行尾不含尾部空白；映射不完整时退化为行尾；行号越界或 lines 为 null 时返回 null。

## 2. 编辑器对外对象（`window.Editor`）

现有成员签名不变。新增：

```text
Editor._diag() -> string
  返回 JSON 文本的诊断报告：{ app, now, ua, state, issues, trace }。
  - state：{ editingCid, cellEdit, hasCm, sourceMode, blocks, active, hasFocus, rangeCount, caretInEditing }
  - issues：只读一致性检查发现的问题（与探针台的 check 同一套判据）；
  - trace：最近的状态切换与焦点变化记录 [{ t, ev, ... }]，不含正文内容。
  - 纯读取，不改变任何编辑器状态；
  - 必须能在任意状态（含无编辑、源码模式、浮层打开）下调用且不抛异常；
  - 原生侧以 5 秒为超时调用；超时即视为页面线程无响应。
```

测试钩子新增（仅供自动化，不属于产品接口）：

```text
Editor._resolveCaretOffset(cid: string, x: number, y: number) -> number | null
  在不改变编辑器状态的前提下，返回"若此刻在视口坐标 (x,y) 点击块 cid，光标应落到的源码偏移"；
  块不存在或正处于编辑态时返回 null。
Editor._reconcile() -> string[]
  执行一次一致性校验与修复，返回被修复的项："block" / "cell" / "cm"。
```

## 3. JS ↔ 原生

| 方向 | 名称 | 载荷 | 语义 |
|------|------|------|------|
| 原生 → JS | `Editor._diag()` 求值 | 无 | 返回上述 JSON 文本；原生负责 5 秒超时与剪贴板写入 |

不新增 JS → 原生消息；不改动既有桥命令。

## 4. 事件行为契约（面向用户，探针台与 e2e 据此断言）

| 输入 | 期望 |
|------|------|
| 左键单击渲染态文本块 | 该块进入编辑态、成为焦点元素；光标位于被点击字符对应的源码位置 |
| 左键单击渲染态单元格（无论此前何种编辑状态） | 该单元格进入编辑态并持焦；此前会话已提交 |
| 左键单击表格行范围内、单元格之外 | 整表进入源码编辑态；光标位于被点击行的行尾 |
| 左键单击链接文字 | 落光标，不打开链接 |
| ⌘/Ctrl + 左键单击链接文字 | 打开链接，不改变编辑状态 |
| 左键单击块内行尾右侧空白或块的下边缘 | 光标在该行行尾 |
| 左键单击块外空白 | 沿用既有空白区行为 |
| 按下并拖动（块原为渲染态） | 选区从按下点扩展到当前位置 |
| 双击（块原为渲染态） | 选中被双击的词 |
| 任一时刻 | 不存在"登记为编辑中但不持有焦点/光标"的状态；下一次左键单击必使其恢复一致 |

## 5. 探针台脚本格式（`tools/webkit-probe/scenarios/*.json`）

JSON 数组，每个元素一步，按序执行；每步之后探针台自动探活并校验焦点一致性。

| kind | 字段 | 语义 |
|------|------|------|
| `open` | `md` | 载入文档 |
| `click` / `down` / `up` / `move` | 见下 | 投递真实鼠标事件；`expect` 取 `block:<cid>` 或 `cell:<r>:<c>` 时，随后的 `check` 核验点击是否生效 |
| `type` | `text`、`must` | 经文本输入通道输入；`must` 为真且有编辑态时，文档必须发生变化 |
| `compose` | `text`、`hold`、`replace` | 一个词的拼音输入过程：`text` 为 `"拼音:上屏文本"`（如 `"hao:好"`）；`replace` 必须为真 |
| `mark` / `commit` | `text`、`replace` | 只标记拼音 / 只上屏（慢动作排查用）；`mark` 的 `replace` 必须为真 |
| `key` | `key`、`shift`、`mods` | 向焦点元素派发按键事件 |
| `wait` | `ms` | 等待 |
| `appswitch` | `ms` | 模拟窗口失去/重获 key |
| `eval` / `print` | `js`、`note` | 求值 / 求值并输出一行日志 |
| `expect` | `js`、`equals` | 断言表达式结果 |
| `check` | — | 焦点一致性 + 最近一次点击的生效性断言 |

鼠标步骤的坐标：`pos`（页面内 JS 表达式，返回 `[x, y]` 视口坐标）优先；否则取 `sel` 元素矩形按 `fx`、`fy` 比例定位，
`x`、`y` 可直接给定，`dx`、`dy` 为像素偏移。其余字段：`hold`（按住毫秒数）、`jitter`（按住期间微移像素）、
`clicks`（点击计数，2 表示双击的第二下）、`mods`（`meta`/`shift`/`ctrl`/`alt`）。`move` 在左键按住期间是拖动。
页面内辅助函数 `__bmChar(cid, li, ci, side)` 返回块内第 li 行第 ci 个字符的坐标（side 0 = 左缘，1 = 右缘）。

关于拖动：WebKit 的 `MouseEvent.buttons` 取自全局物理按键状态，离屏探针无法伪造；探针台在投递原生拖动事件的同时，
会补发一个 `buttons: 1` 的页面 `mousemove`，坐标仍为真实几何。

退出码：任一 `check`/`expect`/`must` 失败或页面无响应 → 非零；探针台自身崩溃 → 运行器判为失败（绝不计为通过）。
