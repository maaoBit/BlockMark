# Quickstart: 可靠点击与点击落光标

**Date**: 2026-11-25
**Feature**: [spec.md](./spec.md)

本文件是验证/运行指南：怎样从零把本特性完整验证一遍。
实现细节见 [tasks.md](./tasks.md)，接口见 [contracts/editor-click-api.md](./contracts/editor-click-api.md)。

## 前置

- Xcode 命令行工具（swiftc）、Node.js
- Chromium 内核浏览器（Edge / Chrome），供 e2e
- homebrew bash（Spec Kit 脚本需要 bash 4+；系统自带 3.2 不够）

所有命令在仓库根目录执行。

## 一键全量

```bash
node tools/bundle.mjs          # 先打包：e2e 与探针台读的是 bundle，不是源码
npm test                       # 单元测试（含新增的落点映射测试）
./tools/run-e2e.sh             # 14 套 e2e（含新增的 m12）
./tools/run-webkit.sh          # 系统 WebKit 探针台：定向场景 + 定种子随机序列
./build.sh                     # 应用构建（含原生菜单改动）
```

四条命令全部以 0 退出即为通过。

## 分项验证

### 1. 落点映射（纯函数）

```bash
node test/caret-map.test.mjs
```

期望：全部 ✓。其中"对拍"一组会用真实行内渲染函数验证映射结果与渲染逐字一致。

### 2. 点击落光标（Chromium e2e）

```bash
node tools/bundle.mjs && node tools/gen-e2e-m12.mjs
"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  --headless --disable-gpu --allow-file-access-from-files \
  --dump-dom --virtual-time-budget=6000 "file://$PWD/EditorResources/e2e-m12.html" \
  | grep -o "<title>[^<]*</title>"
```

期望：`<title>M12-E2E PASS</title>`。结果 JSON 在 `#e2e-result`，逐项可读。

### 3. 焦点级行为（系统 WebKit 探针台）

```bash
./tools/run-webkit.sh                 # 全部场景 + 300 条定种子随机序列
./tools/run-webkit.sh --fuzz-only     # 只跑随机序列
./tools/run-webkit.sh --seeds 1000    # 加大随机量
```

期望：每个场景 `-- no violation`，末行 `ALL PASS`。探针台离屏运行，不抢焦点、不发全局键鼠。

只跑一个场景（调试用）：

```bash
tools/webkit-probe/bmh --html "$PWD/EditorResources/index.bundle.html" \
  --script tools/webkit-probe/scenarios/eaten-click.json --fake-key
```

### 4. 手工验收（真实应用）

```bash
./build.sh && open build/BlockMark.app <某个含表格与多种行内语法的 .md>
```

逐项核对，对应规格的验收场景：

1. 点一段正文进入编辑态 → 单击表格某单元格：单元格立即出现光标，打字进入单元格。
2. 单击标题文字中间：光标在该位置（`# ` 之后）。
3. 单击粗体文字左侧：光标落在 `**` 与文字之间，继续输入为粗体。
4. 单击列表第二行中间：光标在第二行，不在列表末尾。
5. 单击表格第二行右侧空白：整表源码态，光标在第二行行尾。
6. 在未点击过的段落上按下并拖过几个字：选中这几个字。
7. 双击某个中文词：选中该词。
8. 单击链接文字：落光标、不跳转；⌘点击：打开链接。
9. 中文输入法连续输入三个词，每次提交后继续输入，光标与内容正确。
10. 应用菜单（BlockMark 子菜单）→「导出编辑器诊断信息」：出现"已复制"提示，剪贴板为 JSON（会覆盖剪贴板原内容）。

可直接用仓库自带的验收文档：`open build/BlockMark.app tools/webkit-probe/fixtures/点击落点验收.md`。

### 修复前后对比（定种子随机序列）

```bash
./tools/run-webkit.sh --fuzz-only --seeds 300                        # 修复后
./tools/run-webkit.sh --fuzz-only --seeds 300 --html <修复前的 index.bundle.html> --out before.jsonl
```

## 已知边界（不属于缺陷）

- 源码态下不可见定界符变为可见，被点击行右侧的文字会向右位移；落点以逻辑位置为准。
- 代码块、公式块、分隔线、脚注定义的点击行为未变。
- 图片单击仍为预览；任务勾选框单击仍为切换完成状态。
