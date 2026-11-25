#!/bin/zsh
# BlockMark — 系统 WebKit 探针台：打包 → 编译探针 → 定向场景 + 定种子随机序列
# 用法: ./tools/run-webkit.sh [--only NAME] [--fuzz-only] [--no-fuzz] [--seeds N] [--ime] [--html PATH]
# 探针台离屏运行：不激活应用、不发送全局键鼠（不打断正在使用电脑的人）。
set -uo pipefail
cd "$(dirname "$0")/.."

# 先打包：探针台读的是 bundle 产物而不是源码（宪章原则 II：被测物即交付物）
node tools/bundle.mjs || exit 1

python3 tools/webkit-probe/run.py "$@"
