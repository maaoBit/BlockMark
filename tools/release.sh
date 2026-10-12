#!/bin/zsh
# BlockMark — 发布脚本：build → zip → tag → GitHub Release（自动更新的更新源）
# 用法: ./tools/release.sh [版本号]   缺省读 app/Info.plist 的 CFBundleShortVersionString
# 依赖: gh 已登录
set -euo pipefail
cd "$(dirname "$0")/.."

VER="${1:-$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' app/Info.plist)}"
TAG="v$VER"
ZIP="build/BlockMark-$VER.zip"

echo "== build $VER =="
./build.sh

echo "== zip =="
rm -f "$ZIP"
ditto -c -k --keepParent build/BlockMark.app "$ZIP"

echo "== release $TAG =="
NOTES=$(mktemp /tmp/bm-notes.XXXX.md)
cat > "$NOTES" <<EOF
BlockMark $VER

- 安装：解压后将 BlockMark.app 拖入 /Applications。
- 首次打开若被 Gatekeeper 拦截（应用未做公证签名）：右键 App → 打开。
- 已安装旧版本的用户：应用内菜单 BlockMark → 检查更新… 可自动更新。
EOF
gh release create "$TAG" "$ZIP" --title "BlockMark $TAG" --notes-file "$NOTES"
rm -f "$NOTES"
echo "== done: $TAG → $ZIP"
