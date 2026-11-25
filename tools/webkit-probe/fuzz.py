#!/usr/bin/env python3
"""定种子随机操作序列生成（供 run.py 使用）。

序列只由种子决定：修复前后用同一批种子各跑一遍，即可严格对比（specs/001-reliable-click-caret 的 SC-003）。
生成时避开已知的"合法但不可断言"的情况，避免把脚本噪音记成违例：
- 表格旁空白的点击避开右上角悬停「放大」按钮区（点到会打开浮层，其后点击全被浮层拦下）；
- 块外空白点击不带生效性断言（目标取决于落点，可能是相邻块或新建段落）；
- 目标元素此刻不存在的点击（表格源码态下没有单元格）由运行器按 NO-TARGET 跳过。
"""
import random

DOC = ("# 标题\n\n第一段落，随便写点字。\n\n- 列表甲\n- 列表**乙**\n\n> 引用文字\n\n"
       "| A | B |\n|---|---|\n| a1 | a2 |\n| b1 | b2 |\n\n"
       "表后正文段落，用来测试点击落点。\n\n末尾段落，再写一些文字。\n")

B = dict(h="b1", q="b2", list="b3", quote="b4", t="b5", p="b6", r="b7")
SEL = {
    "h": ".bm-block[data-cid=b1] h1", "q": ".bm-block[data-cid=b2] p",
    "list": ".bm-block[data-cid=b3] li:nth-child(2)", "quote": ".bm-block[data-cid=b4] blockquote",
    "p": ".bm-block[data-cid=b6] p", "r": ".bm-block[data-cid=b7] p",
}
T = ".bm-block[data-cid=b5]"
WRAP = T + " .bm-table-wrap"
CELL = T + " [data-r='%d'][data-c='1']"


def _click(sel, expect, fx, fy, rng, **kw):
    d = dict(kind="click", sel=sel, fx=round(fx, 3), fy=round(fy, 3))
    if expect:
        d["expect"] = expect
    if rng.random() < 0.5:
        d["hold"] = rng.choice([5, 20, 60, 120, 250, 450])
    if rng.random() < 0.3:
        d["jitter"] = rng.choice([1, 2])
    d.update(kw)
    return d


def gen(seed, n=14, ime=False):
    rng = random.Random(seed)
    steps = [dict(kind="open", md=DOC)]
    for _ in range(n):
        pool = ["para", "para", "cell", "wrap", "blank", "type", "key", "dbl", "dblcell", "switch"]
        if ime:
            pool += ["compose", "mark"]
        a = rng.choice(pool)
        if a == "para":
            k = rng.choice(["h", "q", "list", "quote", "p", "r"])
            steps.append(_click(SEL[k], "block:" + B[k], rng.choice([0.08, 0.3, 0.6, 0.97, rng.random()]), 0.5, rng))
        elif a == "cell":
            r = rng.randint(0, 2)
            steps.append(_click(CELL % r, "cell:%d:1" % r, rng.choice([0.05, 0.1, 0.5, 0.9, 0.95]), rng.choice([0.1, 0.5, 0.9]), rng))
        elif a == "wrap":   # 避开右上角按钮区：fx ≤ 0.9 且 fy ≥ 0.3
            steps.append(_click(WRAP, "block:" + B["t"], rng.choice([0.6, 0.75, 0.9]), rng.choice([0.3, 0.5, 0.7]), rng))
        elif a == "blank":  # 表格块正下方的块外空白
            steps.append(_click(T, None, 0.5, 1.0, rng, dy=rng.choice([3, 7, 12, 20])))
        elif a == "type":
            steps.append(dict(kind="type", text=rng.choice(["Z", "abc", " x", "9"])))
        elif a == "key":
            steps.append(dict(kind="key", key=rng.choice(["Enter", "Escape", "Tab", "Backspace", "ArrowUp", "ArrowDown"]),
                              shift=rng.random() < 0.2))
        elif a == "dbl":
            k = rng.choice(["q", "p", "r"])
            steps.append(_click(SEL[k], "block:" + B[k], 0.4, 0.5, rng, hold=8))
            steps.append(_click(SEL[k], "block:" + B[k], 0.4, 0.5, rng, hold=8, clicks=2))
        elif a == "dblcell":
            r = rng.randint(0, 2)
            steps.append(_click(CELL % r, "cell:%d:1" % r, 0.4, 0.5, rng, hold=8))
            steps.append(_click(CELL % r, "cell:%d:1" % r, 0.4, 0.5, rng, hold=8, clicks=2))
        elif a == "switch":
            steps.append(dict(kind="appswitch", ms=rng.choice([80, 400])))
        elif a == "compose":
            steps.append(dict(kind="compose", text=rng.choice(["ni:你", "hao:好", "biao:表", "nihao:你好"]), replace=True, hold=rng.choice([10, 80, 300])))
        elif a == "mark":
            steps.append(dict(kind="mark", text=rng.choice(["ni", "hao"]), replace=True))
        if rng.random() < 0.7:
            steps.append(dict(kind="wait", ms=rng.choice([0, 5, 30, 120, 260, 420, 700])))
        steps.append(dict(kind="check"))
    # 收尾探针：有编辑态时打字必须落地
    steps.append(dict(kind="type", text="W", must=True))
    steps.append(dict(kind="check"))
    return steps
