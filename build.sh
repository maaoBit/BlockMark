#!/bin/zsh
# BlockMark — 一键构建 .app（无 Xcode 工程，纯 swiftc）
set -euo pipefail
cd "$(dirname "$0")"

APP="build/BlockMark.app"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"

echo "== swiftc =="
swiftc -O \
  -o "$APP/Contents/MacOS/BlockMark" \
  app/main.swift app/AppDelegate.swift app/Document.swift app/DocumentFileWatcher.swift app/EditorWindowController.swift app/Updater.swift \
  -framework Cocoa -framework WebKit

echo "== bundle editor (WKWebView file:// 不支持 ES module 导入) =="
node tools/bundle.mjs

echo "== bundle app =="
cp app/Info.plist "$APP/Contents/Info.plist"
# 图标：仓库内置 app/AppIcon.icns；仅在显式重生成后用 build/ 覆盖
if [[ -f build/AppIcon.icns && build/AppIcon.icns -nt app/AppIcon.icns ]]; then
  cp build/AppIcon.icns app/AppIcon.icns
fi
cp app/AppIcon.icns "$APP/Contents/Resources/AppIcon.icns"
# 排除 e2e 测试文件与源 ES module（app 只用 bundle 产物）
rsync -a --exclude 'e2e-*.html' --exclude 'editor/' --exclude 'index.html' \
      EditorResources/ "$APP/Contents/Resources/EditorResources/"

echo "== codesign (ad-hoc) =="
codesign --force --sign - "$APP"

echo "== done: $APP"
