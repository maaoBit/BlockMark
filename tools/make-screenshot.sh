#!/bin/zsh
# BlockMark — 生成 README 截图（docs/screenshot.png）
# 用 headless Chromium 内核渲染 index.bundle.html（与 e2e 同基建），比截 app 窗口更干净
# （WKWebView 窗口直截是黑块：web 进程独立合成）
# 用法: ./tools/make-screenshot.sh [浏览器路径] [宽x高]
set -euo pipefail
cd "$(dirname "$0")/.."

BROWSER="${1:-}"
[[ -z "$BROWSER" ]] && for c in \
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"; do
  [[ -x "$c" ]] && BROWSER="$c" && break
done
[[ -x "$BROWSER" ]] || { echo "未找到 Chromium 内核浏览器"; exit 1; }
SIZE="${2:-1280x860}"

node tools/bundle.mjs

python3 - <<'EOF'
import json
html = open("EditorResources/index.bundle.html").read()
doc = """# BlockMark

macOS 原生壳 + WKWebView 的**所见即所得** Markdown 编辑器。块编辑、公式、图表、侧栏一应俱全。

## 数学与图表

$$
E = mc^2
$$

行内公式 $a^2 + b^2 = c^2$ 与 `code`、**加粗**、*斜体* 混排。

| 特性 | 状态 |
|:--|--:|
| 块编辑 | ✓ |
| 公式 | ✓ |

- [x] 任务列表
- [ ] 待办

```python
def hello():
    print("Hello, BlockMark!")
```

> 引用块：轻量、快速、原生。
"""
script = "<script>\nwindow.addEventListener(\"DOMContentLoaded\", () => {\n  Editor.open(" + json.dumps(doc) + ");\n});\n</script>"
assert html.count("</body>") == 1
html = html.replace("</body>", script + "\n</body>")
open("EditorResources/e2e-shot.html", "w").write(html)
print("shot page generated")
EOF

"$BROWSER" --headless --disable-gpu --allow-file-access-from-files \
  --window-size="${SIZE%x,}" --window-size="$SIZE" \
  --screenshot --virtual-time-budget=6000 \
  "file://$PWD/EditorResources/e2e-shot.html" >/dev/null 2>&1
rm -f EditorResources/e2e-shot.html
mkdir -p docs && mv screenshot.png docs/screenshot.png
file docs/screenshot.png
