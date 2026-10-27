#!/bin/zsh
# BlockMark — e2e 运行器：bundle → 生成七套 → headless 浏览器断言 <title>
# 用法: ./tools/run-e2e.sh [浏览器路径]
#   浏览器需 Chromium 内核（Edge/Chrome 均可）；缺省按序探测。
set -uo pipefail
cd "$(dirname "$0")/.."

BROWSER="${1:-}"
if [[ -z "$BROWSER" ]]; then
  for c in \
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge" \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
    [[ -x "$c" ]] && BROWSER="$c" && break
  done
fi
[[ -x "$BROWSER" ]] || { echo "未找到 Chromium 内核浏览器（Edge/Chrome），请作为参数传入"; exit 1; }

node tools/bundle.mjs || exit 1

SUITES=(m1 cm m2b m3 m45 look tail m6)
fail=0
for g in $SUITES; do
  node "tools/gen-e2e-$g.mjs" >/dev/null || { echo "$g: GEN-FAIL"; fail=1; continue; }
  title=$("$BROWSER" --headless --disable-gpu --allow-file-access-from-files \
    --dump-dom --virtual-time-budget=6000 \
    "file://$PWD/EditorResources/e2e-$g.html" 2>/dev/null | grep -o '<title>[^<]*</title>' | head -1)
  echo "$g: ${title:-<no title>}"
  [[ "$title" == *"PASS"* ]] || fail=1
done
exit $fail
