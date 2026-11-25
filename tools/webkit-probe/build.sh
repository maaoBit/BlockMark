#!/bin/zsh
# WebKit 探针台编译（仅开发期；产出 tools/webkit-probe/bmh，已 gitignore）
# 钉 target：swiftc 默认 target 跳到 macosx28.0（同 app/build.sh 的说明）
set -euo pipefail
cd "$(dirname "$0")"
swiftc -O -target arm64-apple-macos13.0 main.swift -o bmh -framework Cocoa -framework WebKit
echo "built: $PWD/bmh"
