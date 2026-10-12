#!/bin/zsh
# BlockMark — 从 assets_src/icon/ 原图生成 build/AppIcon.icns
# 流程：PIL 做 macOS superellipse（n=5 连续圆角）遮罩 + 各尺寸重采样 → iconset → iconutil
# 依赖：python3 + Pillow（pip3 install Pillow）、macOS 自带 iconutil
set -euo pipefail
cd "$(dirname "$0")/.."

SRC="assets_src/icon/jimeng_20261011_091715_1.png"
OUT="app/AppIcon.icns"
[[ -f "$SRC" ]] || { echo "missing $SRC"; exit 1; }

ICONSET="build/icon.iconset"
rm -rf "$ICONSET"; mkdir -p "$ICONSET"

python3 - "$SRC" "$ICONSET" <<'EOF'
import sys
from PIL import Image, ImageDraw

src_path, iconset = sys.argv[1], sys.argv[2]
img = Image.open(src_path).convert("RGBA")

def superellipse_mask(size, n=5):
    # macOS 图标连续圆角：|x/a|^n + |y/a|^n = 1（squircle）
    # 参数化：x = a·sign(cos t)·|cos t|^(2/n), y = a·sign(sin t)·|sin t|^(2/n)
    import math
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    a = size / 2
    pts = []
    for i in range(-180, 181):
        t = math.radians(i)
        ct, st = math.cos(t), math.sin(t)
        x = a + math.copysign(abs(ct) ** (2 / n), ct) * a * 0.98
        y = a + math.copysign(abs(st) ** (2 / n), st) * a * 0.98
        pts.append((x, y))
    d.polygon(pts, fill=255)
    return m

# Apple iconset 规范成员：16/32/128/256/512 的 1x + @2x（1024 即 512@2x）
for s in [16, 32, 128, 256, 512]:
    im = img.resize((s, s), Image.LANCZOS)
    im.putalpha(superellipse_mask(s))
    im.save(f"{iconset}/icon_{s}x{s}.png")
    im.resize((s * 2, s * 2), Image.LANCZOS).save(f"{iconset}/icon_{s}x{s}@2x.png")
print("iconset done")
EOF

iconutil -c icns "$ICONSET" -o "$OUT"
rm -rf "$ICONSET"
echo "done: $OUT"
