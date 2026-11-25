#!/usr/bin/env python3
"""系统 WebKit 探针台运行器：定向场景 + 定种子随机序列。

用法: run.py [--only NAME] [--fuzz-only] [--no-fuzz] [--seeds N] [--ime] [--html PATH] [--quiet]

- 定向场景：scenarios/*.json 按文件名顺序逐个回放，任一断言失败即该场景 FAIL。
- 随机序列：种子 1..N 逐个回放（见 fuzz.py），统计出现违例的序列。
- --html：指定被测入口页（默认 EditorResources/index.bundle.html）。
  修复前后对比时用它指向修复前快照，种子相同即序列相同。
退出码：任一场景失败或任一序列出现违例 → 1。
"""
import argparse
import glob
import json
import os
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, HERE)
import fuzz  # noqa: E402

PROBE = os.path.join(HERE, "bmh")


def ensure_probe():
    if (not os.path.exists(PROBE)
            or os.path.getmtime(PROBE) < os.path.getmtime(os.path.join(HERE, "main.swift"))):
        subprocess.run([os.path.join(HERE, "build.sh")], check=True, capture_output=True)


def play(html, steps, quiet):
    """回放一份脚本。返回 (违例列表, 输出行)。NO-TARGET 是脚本噪音，不计违例。"""
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False, encoding="utf-8") as f:
        json.dump(steps, f, ensure_ascii=False)
        path = f.name
    try:
        cmd = [PROBE, "--html", html, "--script", path, "--fake-key"] + (["--quiet"] if quiet else [])
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        out, code = r.stdout, r.returncode
    finally:
        os.unlink(path)
    # 探针台正常结束必有 SUMMARY 行且退出码 ∈ {0,1}；否则是工具自身崩溃/超时，绝不能当成通过
    lines = out.splitlines()
    if code not in (0, 1) or not any(l.startswith("SUMMARY") for l in lines):
        tail = (r.stderr.strip().splitlines() or [""])[0][:200]
        return ["PROBE-CRASH exit=%s %s" % (code, tail)], lines
    bad = []
    for line in out.splitlines():
        if line.startswith("{") and not line.startswith("//"):
            d = json.loads(line)
            if not d["ok"] and not d["detail"].startswith("NO-TARGET"):
                st = d.get("state") or ""
                try:
                    s = json.loads(st)
                    st = "editing=%s cell=%s active=%s" % (s.get("editingCid"), s.get("cellEdit"), s.get("active"))
                except ValueError:
                    pass
                bad.append("step %d %s %s | %s" % (d["step"], d["kind"], d["detail"], st))
    return bad, out.splitlines()


def short(steps, index):
    """把脚本前 index 步压缩成可读序列（定位违例用）。"""
    out = []
    for s in steps[:index + 1]:
        if s["kind"] in ("open", "check", "log"):
            continue
        d = {k: v for k, v in s.items() if k not in ("fy", "expect", "replace") and not (k == "hold" and v == 60)}
        out.append(json.dumps(d, ensure_ascii=False))
    return "  ".join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="只跑文件名包含该子串的场景")
    ap.add_argument("--fuzz-only", action="store_true")
    ap.add_argument("--no-fuzz", action="store_true")
    ap.add_argument("--seeds", type=int, default=300)
    ap.add_argument("--ime", action="store_true", help="随机序列里加入输入法组合步骤")
    ap.add_argument("--html", default=os.path.join(ROOT, "EditorResources", "index.bundle.html"))
    ap.add_argument("--quiet", action="store_true")
    ap.add_argument("--out", help="把出现违例的随机序列明细写到该文件（JSON 行，修复前后对比用）")
    a = ap.parse_args()

    ensure_probe()
    failed = 0

    if not a.fuzz_only:
        for path in sorted(glob.glob(os.path.join(HERE, "scenarios", "*.json"))):
            name = os.path.splitext(os.path.basename(path))[0]
            if a.only and a.only not in name:
                continue
            bad, _ = play(a.html, json.load(open(path, encoding="utf-8")), True)
            if bad:
                failed += 1
                print("FAIL  %s (%d)" % (name, len(bad)))
                for b in bad[:8]:
                    print("      " + b)
            else:
                print("PASS  %s" % name)

    if not a.no_fuzz:
        bad_seeds = []
        for seed in range(1, a.seeds + 1):
            steps = fuzz.gen(seed, ime=a.ime)
            bad, _ = play(a.html, steps, True)
            if bad:
                bad_seeds.append((seed, bad, steps))
        kinds = {}
        for seed, bad, _ in bad_seeds:
            for b in bad:
                k = b.split(" | ")[0].split(" ", 2)[2].split(" got ")[0].split(" editing=")[0][:60]
                kinds[k] = kinds.get(k, 0) + 1
        print("FUZZ  seeds=%d with-violations=%d" % (a.seeds, len(bad_seeds)))
        for k, v in sorted(kinds.items(), key=lambda kv: -kv[1]):
            print("      %4d  %s" % (v, k))
        for seed, bad, steps in bad_seeds[:5]:
            print("      seed %d: %s" % (seed, bad[0]))
            print("         seq: %s" % short(steps, int(bad[0].split(" ")[1])))
        if bad_seeds:
            failed += 1
        if a.out:
            with open(a.out, "w", encoding="utf-8") as f:
                for seed, bad, steps in bad_seeds:
                    f.write(json.dumps(dict(seed=seed, bad=bad, steps=steps), ensure_ascii=False) + "\n")

    print("ALL PASS" if not failed else "FAILED (%d)" % failed)
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    main()
