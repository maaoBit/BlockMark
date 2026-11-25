// BlockMark — 系统 WebKit 探针台（开发期测试工具，不进应用包）
//
// 为什么需要它：e2e（Chromium + 合成事件）不触发原生焦点事件与事件默认动作，
// "点击被吞 / 光标丢失 / 状态与焦点不一致"这类缺陷只在真实 WKWebView 里可见
// （项目宪章原则 II）。本工具在离屏无边框窗口里加载与 App 相同的 bundle，
// 直接向 WKWebView 投递真实 NSEvent 鼠标事件，按脚本回放并逐步校验不变量。
//
// 不打扰正在使用电脑的人：不激活应用、窗口离屏、不发送全局键鼠。
// 焦点事件靠"伪造 key 窗口状态 + 手动投递窗口通知"让 WebKit 认为页面已获焦（--fake-key），
// 实测 document.hasFocus() 为真、focus/blur/focusout 正常派发。
//
// 用法: bmh --html <index.bundle.html> --script <steps.json> [--rounds N] [--fake-key] [--out report.jsonl] [--quiet]
// 脚本格式见 specs/*/contracts/editor-click-api.md §5。退出码：任一断言失败或页面无响应 → 1。

import Cocoa
import WebKit

setvbuf(stdout, nil, _IONBF, 0)

enum Failure: Error { case timeout(String) }

// 离屏窗口：对 WebKit 伪装成"可见"与（可选）"key"，自身不参与用户的窗口层级
final class ProbeWindow: NSWindow {
    var fakeKey = false
    override var isKeyWindow: Bool { fakeKey || super.isKeyWindow }
    override var occlusionState: NSWindow.OcclusionState { [.visible] }
}

final class Harness: NSObject, WKScriptMessageHandler, WKUIDelegate, WKNavigationDelegate {
    let win: ProbeWindow
    let wv: WKWebView
    var bridgeLog: [[String: Any]] = []
    var didFinish = false
    private var evNo = 1
    var leftDown = false
    private final class Box { var value: Any?; var error: Error?; var done = false }

    init(fakeKey: Bool) {
        win = ProbeWindow(contentRect: NSRect(x: -6000, y: -6000, width: 880, height: 640),
                          styleMask: [.borderless], backing: .buffered, defer: false)
        win.fakeKey = fakeKey
        win.isReleasedWhenClosed = false
        let cc = WKUserContentController()
        let cfg = WKWebViewConfiguration()
        cfg.userContentController = cc
        wv = WKWebView(frame: NSRect(x: 0, y: 0, width: 880, height: 640), configuration: cfg)
        super.init()
        cc.add(self, name: "bridge")          // 与 App 同名桥通道：页面侧 Bridge.call 有去处
        wv.uiDelegate = self
        wv.navigationDelegate = self
        win.contentView = wv
        win.orderFrontRegardless()            // 不激活应用
        win.makeFirstResponder(wv)
        if fakeKey {
            NotificationCenter.default.post(name: NSWindow.didBecomeKeyNotification, object: win)
            NotificationCenter.default.post(name: NSApplication.didBecomeActiveNotification, object: NSApp)
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) { didFinish = true }

    func userContentController(_ c: WKUserContentController, didReceive m: WKScriptMessage) {
        if let body = m.body as? [String: Any] { bridgeLog.append(body) }
    }

    // 同步桥（prompt 拦截）在 App 里无在用契约：一律回 null，避免页面因等待而挂起
    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?, initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) { completionHandler(nil) }
    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String,
                 initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) { completionHandler() }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
                 for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? { nil }

    // MARK: - 基础动作

    func pump(_ ms: Int) { if ms > 0 { RunLoop.main.run(until: Date().addingTimeInterval(Double(ms) / 1000)) } }

    // 求值兼探活：timeout 秒内不回话 = 页面线程卡死
    func js(_ code: String, timeout: TimeInterval = 4) -> Result<Any?, Error> {
        let box = Box()
        wv.evaluateJavaScript(code) { v, e in box.value = v; box.error = e; box.done = true }
        let deadline = Date().addingTimeInterval(timeout)
        while !box.done && Date() < deadline { RunLoop.main.run(until: Date().addingTimeInterval(0.004)) }
        if !box.done { return .failure(Failure.timeout("JS 无响应")) }
        if let e = box.error { return .failure(e) }
        return .success(box.value)
    }

    func text(_ code: String) -> String? {
        if case .success(let v) = js(code) { return v as? String }
        return nil
    }

    // "meta"/"shift"/"ctrl"/"alt" → 鼠标事件修饰键
    func flags(_ mods: String?) -> NSEvent.ModifierFlags {
        var f: NSEvent.ModifierFlags = []
        let m = mods ?? ""
        if m.contains("meta") { f.insert(.command) }
        if m.contains("shift") { f.insert(.shift) }
        if m.contains("ctrl") { f.insert(.control) }
        if m.contains("alt") { f.insert(.option) }
        return f
    }

    @discardableResult
    func mouse(_ type: NSEvent.EventType, x: CGFloat, y: CGFloat, clicks: Int = 1, mods: String? = nil) -> NSEvent {
        // 视口 CSS 坐标（顶左原点）→ 窗口坐标（底左原点）
        let loc = NSPoint(x: x, y: wv.bounds.height - y)
        let ev = NSEvent.mouseEvent(with: type, location: loc, modifierFlags: flags(mods),
                                    timestamp: ProcessInfo.processInfo.systemUptime,
                                    windowNumber: win.windowNumber, context: nil, eventNumber: evNo,
                                    clickCount: clicks, pressure: type == .leftMouseDown ? 1 : 0)!
        evNo += 1
        switch type {
        case .leftMouseDown: leftDown = true; wv.mouseDown(with: ev)
        case .leftMouseUp: leftDown = false; wv.mouseUp(with: ev)
        case .leftMouseDragged: wv.mouseDragged(with: ev)
        default: wv.mouseMoved(with: ev)
        }
        return ev
    }

    func click(x: CGFloat, y: CGFloat, clicks: Int, hold: Int, jitter: CGFloat, prewait: Int, mods: String?) {
        mouse(.mouseMoved, x: x, y: y)
        pump(prewait)
        mouse(.leftMouseDown, x: x, y: y, clicks: clicks, mods: mods)
        pump(min(hold, 30))
        if jitter > 0 {
            mouse(.leftMouseDragged, x: x + jitter, y: y - jitter * 0.5)
            pump(max(0, hold - 30))
            mouse(.leftMouseUp, x: x + jitter, y: y - jitter * 0.5, clicks: clicks, mods: mods)
        } else {
            pump(max(0, hold - 30))
            mouse(.leftMouseUp, x: x, y: y, clicks: clicks, mods: mods)
        }
    }

    // 视口坐标：pos（JS 表达式，返回 [x, y]）优先；否则取元素矩形（fx, fy 为比例；x/y/dx/dy 为像素覆盖与偏移）
    func point(_ spec: [String: Any]) -> (CGFloat, CGFloat)? {
        if let expr = spec["pos"] as? String {
            // 表达式返回 [x, y]（数值数组）
            guard case .success(let v) = js(expr), let a = v as? [Double], a.count == 2 else { return nil }
            return (a[0] + (spec["dx"] as? Double ?? 0), a[1] + (spec["dy"] as? Double ?? 0))
        }
        guard let sel = spec["sel"] as? String,
              let raw = text("(() => { const e = document.querySelector(\(jstr(sel))); if (!e) return null; " +
                             "const r = e.getBoundingClientRect(); return JSON.stringify({x: r.left, y: r.top, w: r.width, h: r.height}); })()"),
              let r = (try? JSONSerialization.jsonObject(with: raw.data(using: .utf8)!)) as? [String: Double] else { return nil }
        let x = spec["x"] as? Double ?? (r["x"]! + r["w"]! * (spec["fx"] as? Double ?? 0.5))
        let y = spec["y"] as? Double ?? (r["y"]! + r["h"]! * (spec["fy"] as? Double ?? 0.5))
        return (x + (spec["dx"] as? Double ?? 0), y + (spec["dy"] as? Double ?? 0))
    }

    // 真实输入法契约：先问选区（相对焦点编辑根的文本偏移），调用方再带显式替换范围
    func selRange(_ acrossMarked: Bool) -> NSRange {
        let s = text("(() => { const ae = document.activeElement; const sel = getSelection(); if (!ae || !sel.rangeCount) return null; " +
            "const r = sel.getRangeAt(0); if (!ae.contains(r.startContainer)) return null; " +
            "const p = r.cloneRange(); p.selectNodeContents(ae); p.setEnd(r.startContainer, r.startOffset); " +
            "return [p.toString().length, r.toString().length]; })()")
        guard let s, let a = (try? JSONSerialization.jsonObject(with: s.data(using: .utf8)!)) as? [Double], a.count == 2 else {
            return NSRange(location: NSNotFound, length: 0)
        }
        return NSRange(location: Int(a[0]), length: acrossMarked ? Int(a[1]) : 0)
    }
}

func jstr(_ s: String) -> String {
    String(String(data: try! JSONSerialization.data(withJSONObject: [s]), encoding: .utf8)!.dropFirst().dropLast())
}
func jsonText(_ obj: Any) -> String {
    String(data: try! JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]), encoding: .utf8)!
}
func equalJSON(_ a: Any, _ b: Any) -> Bool {
    if let an = a as? NSNumber, let bn = b as? NSNumber { return an == bn }
    if let aStr = a as? String, let bStr = b as? String { return aStr == bStr }
    return jsonText(a) == jsonText(b)
}

// NSTextInputClient 的组合文本入口：WKWebView 私有实现，公开头未暴露，按选择器调用。
// 注意 replacementRange 是 NSRange 结构体参数（不是 NSValue 对象）——ABI 写错会传垃圾值，
// 表现为"标记文本被插到末尾 / 整段被替换"等假象。
func imeCall(_ wv: WKWebView, _ name: String, _ text: String, _ range: NSRange, _ replacement: NSRange) {
    let sel = NSSelectorFromString(name)
    guard wv.responds(to: sel) else { print("// {\"fatal\":\"WKWebView 不响应 \(name)\"}"); exit(3) }
    if name.hasPrefix("insertText:") {
        typealias IMP2 = @convention(c) (AnyObject, Selector, NSString, NSRange) -> Void
        unsafeBitCast(wv.method(for: sel), to: IMP2.self)(wv, sel, text as NSString, replacement)
    } else {
        typealias IMP3 = @convention(c) (AnyObject, Selector, NSString, NSRange, NSRange) -> Void
        unsafeBitCast(wv.method(for: sel), to: IMP3.self)(wv, sel, text as NSString, range, replacement)
    }
}

// 状态快照（每步入档）
let STATE_JS = """
(() => {
  const es = Editor._editingState();
  const ae = document.activeElement;
  const sel = getSelection();
  const r = sel.rangeCount ? sel.getRangeAt(0) : null;
  const blk = n => !n ? null : (n.nodeType === 3 ? n.parentElement.closest('.bm-block') : (n.closest ? n.closest('.bm-block') : null));
  const name = n => !n ? 'null' : (n.nodeType === 3 ? '#text(' + String(n.textContent).slice(0, 14) + ')' :
    n.nodeName + (n.id ? '#' + n.id : '') + (typeof n.className === 'string' && n.className ? '.' + n.className.split(' ').join('.') : '') +
    (n.dataset && n.dataset.cid ? '[' + n.dataset.cid + ']' : ''));
  const off = () => { if (!r) return null; const e = blk(r.startContainer); if (!e) return null;
    const p = r.cloneRange(); p.selectNodeContents(e); p.setEnd(r.startContainer, r.startOffset); return p.toString().length; };
  return JSON.stringify({
    editingCid: es.editingCid, cellEdit: es.cellEdit, hasCm: es.hasCm,
    active: name(ae), selCid: r ? ((blk(r.startContainer) || {}).dataset || {}).cid : null,
    selOff: off(), selLen: r ? r.toString().length : 0, selText: r ? r.toString().slice(0, 24) : null,
    rangeCount: sel.rangeCount, hasFocus: document.hasFocus(),
    md: Editor.getMarkdown(),
  });
})()
"""

// 不变量：状态登记 ↔ 真实焦点 一致
let CHECK_JS = """
(() => {
  const es = Editor._editingState();
  const ae = document.activeElement;
  const sel = getSelection();
  const r = sel.rangeCount ? sel.getRangeAt(0) : null;
  const inside = n => !!n && ae === n && !!r && n.contains(r.startContainer);
  const issues = [];
  if (es.editingCid) {
    const el = document.querySelector('.bm-block[data-cid="' + es.editingCid + '"]');
    if (!el) issues.push('editingCid-no-el');
    else {
      if (!el.isContentEditable) issues.push('editing-not-editable');
      if (ae !== el) issues.push('editing-not-active:' + (ae.nodeName === 'DIV' ? 'DIV.' + ae.className : ae.nodeName));
      else if (!r || !el.contains(r.startContainer)) issues.push('editing-caret-outside');
    }
  }
  if (es.cellEdit) {
    const td = document.querySelector('.bm-cell-editing');
    if (!td) issues.push('cellEdit-no-td');
    else if (ae !== td) issues.push('cell-not-active:' + ae.nodeName);
    else if (!r || !td.contains(r.startContainer)) issues.push('cell-caret-outside');
  }
  for (const e of document.querySelectorAll('.bm-editing')) if (!es.editingCid || e.dataset.cid !== es.editingCid) issues.push('stale-editing-el:' + e.dataset.cid);
  if (!es.cellEdit && document.querySelector('.bm-cell-editing')) issues.push('stale-cell-editing');
  // 幽灵焦点：焦点落在可编辑元素上，但状态层并不知情（输入会被静默丢弃）
  if (ae && ae !== document.body && ae.isContentEditable && !es.editingCid && !es.cellEdit) issues.push('ghost-focus:' + ae.nodeName);
  if (ae && ae.closest && ae.closest('.CodeMirror') && !es.hasCm) issues.push('ghost-cm-focus');
  return issues.join(',') || 'ok';
})()
"""

// 点击生效性：上一次带 expect 的点击，其目标此刻必须处于编辑态并持有光标
let EFFECT_JS = """
(() => {
  const want = window.__bmExpect; if (!want) return 'ok';
  const es = Editor._editingState(); const ae = document.activeElement; const sel = getSelection();
  const r = sel.rangeCount ? sel.getRangeAt(0) : null;
  const focused = n => !!n && ae === n && !!r && n.contains(r.startContainer);
  const st = () => 'editing=' + es.editingCid + ' cell=' + JSON.stringify(es.cellEdit) + ' active=' + (ae ? ae.nodeName : 'null');
  const p = want.expect.split(':');
  if (p[0] === 'block') {
    const el = document.querySelector('.bm-block[data-cid="' + p[1] + '"]');
    return (es.editingCid === p[1] && el && el.isContentEditable && focused(el)) ? 'ok'
           : 'CLICK-EATEN expected block ' + p[1] + ' got ' + st();
  }
  const td = document.querySelector(want.sel);
  return (es.cellEdit && es.cellEdit.r === p[1] && es.cellEdit.c === p[2] && focused(td)) ? 'ok'
         : 'CLICK-EATEN expected cell ' + want.expect + ' got ' + st();
})()
"""

// 页面内取坐标的辅助函数（落点用例需要"第几行第几个字符的左/右半边"这样的精确坐标）
let HELPERS_JS = """
window.__bmChar = (cid, li, ci, side = 0.5) => {
  const el = document.querySelector('.bm-block[data-cid="' + cid + '"]');
  if (!el) return null;
  const lines = [[]]; const started = new Set();
  const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n;
  while ((n = walk.nextNode())) {
    if (n.nodeType === 1) {
      if (n.tagName === 'BR') { lines.push([]); continue; }
      if (/^(P|LI|H[1-6]|DIV|BLOCKQUOTE)$/.test(n.tagName) && !started.has(n)) {
        started.add(n);
        if (lines[lines.length - 1].length) lines.push([]);
      }
      continue;
    }
    if (n.textContent.length && !n.parentElement.closest('.bm-task-box')) lines[lines.length - 1].push(n);
  }
  let k = ci;
  for (const tn of lines[li] || []) {
    if (k < tn.textContent.length) {
      const r = document.createRange(); r.setStart(tn, k); r.setEnd(tn, Math.min(k + 1, tn.textContent.length));
      const b = r.getBoundingClientRect();
      return [b.left + b.width * side, b.top + b.height / 2];
    }
    k -= tn.textContent.length;
  }
  return null;
};
"""

// MARK: - main

let args = CommandLine.arguments
func opt(_ name: String) -> String? { if let i = args.firstIndex(of: name), i + 1 < args.count { return args[i + 1] }; return nil }
guard let html = opt("--html"), let scriptPath = opt("--script") else {
    print("usage: bmh --html <index.bundle.html> --script <steps.json> [--rounds N] [--fake-key] [--out report.jsonl] [--quiet]")
    exit(2)
}
let rounds = Int(opt("--rounds") ?? "1") ?? 1
let fakeKey = args.contains("--fake-key")
let quiet = args.contains("--quiet")
let outPath = opt("--out")

_ = NSApplication.shared
NSApplication.shared.setActivationPolicy(.accessory)   // 无 Dock 图标、不抢前台

let h = Harness(fakeKey: fakeKey)
h.wv.loadFileURL(URL(fileURLWithPath: html), allowingReadAccessTo: URL(fileURLWithPath: "/"))

func pageReady() -> Bool {
    guard h.didFinish else { return false }
    if case .success(let v) = h.js("!!window.Editor && document.readyState === 'complete'", timeout: 1) { return (v as? Bool) == true }
    return false
}
var waited = 0
while !pageReady() && waited < 20000 { h.pump(20); waited += 20 }
if waited >= 20000 { print("FATAL: page did not load"); exit(3) }
h.pump(300)   // 等 KaTeX/mermaid 等异步增强落定
_ = h.js(HELPERS_JS)

let steps = (try? JSONSerialization.jsonObject(with: try! Data(contentsOf: URL(fileURLWithPath: scriptPath)))) as? [[String: Any]] ?? []
if steps.isEmpty { print("FATAL: script empty or unparsable: \(scriptPath)"); exit(3) }

var out = ""
if let p = outPath, FileManager.default.fileExists(atPath: p) { try? FileManager.default.removeItem(atPath: p) }
var anomalies = 0
var pendingExpect: [String: Any]?
var t0 = Date()
func record(_ round: Int, _ i: Int, _ kind: String, _ ok: Bool, _ detail: String) {
    let state = h.text(STATE_JS) ?? "nil"
    let line = jsonText(["round": round, "step": i, "kind": kind, "ms": Int(Date().timeIntervalSince(t0) * 1000),
                         "ok": ok, "detail": detail, "state": state])
    if !quiet || !ok { print(line) }
    out += line + "\n"
}
func note(_ round: Int, _ i: Int, _ kind: String, _ text: String) {
    let line = jsonText(["round": round, "step": i, "kind": kind, "note": text, "state": h.text(STATE_JS) ?? "nil"])
    if !quiet { print("// " + line) }
}

for round in 1...rounds {
    t0 = Date()
    for (i, step) in steps.enumerated() {
        let kind = step["kind"] as? String ?? "?"
        var ok = true, detail = ""
        switch kind {
        case "open":
            h.leftDown = false
            if case .failure(let e) = h.js("Editor.open(\(jstr(step["md"] as? String ?? "")))") { ok = false; detail = "ERR \(e)" }
        case "click", "down", "up", "move":
            guard let (x, y) = h.point(step) else { ok = false; detail = "NO-TARGET \(step["sel"] ?? "")"; break }
            let clicks = step["clicks"] as? Int ?? 1
            let mods = step["mods"] as? String
            switch kind {
            case "click":
                h.click(x: x, y: y, clicks: clicks, hold: step["hold"] as? Int ?? 60,
                        jitter: CGFloat(step["jitter"] as? Double ?? 0), prewait: step["prewait"] as? Int ?? 0, mods: mods)
            case "down":
                h.mouse(.mouseMoved, x: x, y: y)
                h.mouse(.leftMouseDown, x: x, y: y, clicks: clicks, mods: mods)
            case "up":
                h.mouse(.leftMouseUp, x: x, y: y, clicks: clicks, mods: mods)
            default:   // move：按住左键时是拖动
                h.mouse(h.leftDown ? .leftMouseDragged : .mouseMoved, x: x, y: y)
                // WebKit 的 MouseEvent.buttons 取自全局物理按键状态，离屏探针无法伪造。
                // 页面里靠 buttons 判定"正在拖动"的处理器收不到真实值，这里补发一个带 buttons=1 的
                // 页面事件——只补这一件伪造不了的事，坐标仍是真实几何。
                if h.leftDown {
                    _ = h.js("document.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, clientX: \(x), clientY: \(y), buttons: 1}))")
                }
            }
            detail = String(format: "@%.0f,%.0f", x, y)
            if let e = step["expect"] as? String { pendingExpect = ["expect": e, "sel": step["sel"] as? String ?? ""] }
        case "type":
            let before = h.text("JSON.stringify([Editor._editingState(), Editor.getMarkdown()])") ?? ""
            imeCall(h.wv, "insertText:replacementRange:", step["text"] as? String ?? "", NSRange(location: NSNotFound, length: 0),
                    NSRange(location: NSNotFound, length: 0))
            if step["must"] as? Bool ?? true {
                h.pump(30)
                // 打字必须落地：打之前有编辑态（块/单元格）→ 文档内容必须变化
                let probe = "(() => { const b = JSON.parse(\(jstr(before))); const es = Editor._editingState(); " +
                    "const wasEditing = !!(b[0].editingCid || b[0].cellEdit); const changed = Editor.getMarkdown() !== b[1]; " +
                    "return !wasEditing || changed ? 'ok' : 'TYPE-DROPPED editing=' + b[0].editingCid + ' cell=' + JSON.stringify(b[0].cellEdit); })()"
                detail = (h.text(probe) ?? "PROBE-ERR") ; ok = detail == "ok"
            }
        case "commit":   // 只上屏（结束当前组合）：配合 mark 做慢动作排查
            imeCall(h.wv, "insertText:replacementRange:", step["text"] as? String ?? "", NSRange(location: NSNotFound, length: 0), h.selRange(true))
        case "compose", "mark":
            // 只接受真实输入法契约（显式替换范围）；"无替换范围"的调用会整段替换内容，是模拟假象
            guard step["replace"] as? Bool == true else { ok = false; detail = "IME 步骤必须带 replace:true（真实输入法契约）"; break }
            let t = step["text"] as? String ?? ""
            if kind == "compose" {
                // 语义 = 一个词的拼音输入过程：text = "拼音:上屏文本"（"hao:好" → 标记 "hao" → 上屏 "好"）
                let parts = t.split(separator: ":", maxSplits: 1).map(String.init)
                guard parts.count == 2 else { ok = false; detail = "compose 文本须为 拼音:上屏文本"; break }
                let marked = parts[0], committed = parts[1]
                imeCall(h.wv, "setMarkedText:selectedRange:replacementRange:", marked, NSRange(location: (marked as NSString).length, length: 0), h.selRange(false))
                h.pump(step["hold"] as? Int ?? 40)
                if !committed.isEmpty {
                    imeCall(h.wv, "insertText:replacementRange:", committed, NSRange(location: NSNotFound, length: 0), h.selRange(true))
                }
            } else {
                imeCall(h.wv, "setMarkedText:selectedRange:replacementRange:", t, NSRange(location: (t as NSString).length, length: 0), h.selRange(false))
            }
        case "key":
            let mods = step["mods"] as? String ?? ""
            _ = h.js("(() => { const t = document.activeElement || document.body; t.dispatchEvent(new KeyboardEvent('keydown', " +
                "{key: \(jstr(step["key"] as? String ?? "")), bubbles: true, cancelable: true, shiftKey: \(step["shift"] as? Bool ?? false), " +
                "metaKey: \(mods.contains("meta")), ctrlKey: \(mods.contains("ctrl"))})); })()")
        case "wait":
            h.pump(step["ms"] as? Int ?? 0)
        case "appswitch":   // 窗口失去/重获 key（不真的动用户前台）
            h.win.fakeKey = false
            NotificationCenter.default.post(name: NSWindow.didResignKeyNotification, object: h.win)
            NotificationCenter.default.post(name: NSApplication.didResignActiveNotification, object: NSApp)
            h.pump(step["ms"] as? Int ?? 300)
            h.win.fakeKey = true
            NotificationCenter.default.post(name: NSWindow.didBecomeKeyNotification, object: h.win)
            NotificationCenter.default.post(name: NSApplication.didBecomeActiveNotification, object: NSApp)
        case "eval":
            if case .failure(let e) = h.js(step["js"] as? String ?? "0") { ok = false; detail = "ERR \(e)" }
        case "print":
            print("// " + jsonText(["note": step["note"] ?? "print", "value": h.text(step["js"] as? String ?? "0") ?? NSNull(),
                                   "state": h.text(STATE_JS) ?? "nil"]))
        case "expect":
            switch h.js(step["js"] as? String ?? "true", timeout: 3) {
            case .failure(let e): ok = false; detail = "ERR \(e)"
            case .success(let v):
                if let want = step["equals"] {
                    ok = equalJSON(v ?? NSNull(), want)
                    if !ok { detail = "GOT \(jsonText(["got": v ?? NSNull()]))" }
                } else if let truthy = v as? Bool {
                    ok = truthy; if !ok { detail = "FALSE" }
                } else { ok = v != nil && !(v is NSNull); if !ok { detail = "NULL" } }
            }
        case "check":
            switch h.js(CHECK_JS, timeout: 3) {
            case .failure(let e): ok = false; detail = "ERR \(e)"
            case .success(let v):
                detail = (v as? String) ?? "nil"; ok = detail == "ok"
            }
            if let ex = pendingExpect {
                pendingExpect = nil
                _ = h.js("window.__bmExpect = \(jsonText(ex))")
                switch h.js(EFFECT_JS) {
                case .success(let v):
                    let t = (v as? String) ?? "nil"
                    if t != "ok" { ok = false; detail += (detail == "ok" ? "" : " | ") + t }
                case .failure: ok = false; detail += " | EXPECT-ERR"
                }
            }
        case "log":
            note(round, i, kind, step["note"] as? String ?? "")
        default:
            ok = false; detail = "UNKNOWN-STEP"
        }
        // 每步之后探活：JS 4 秒不回话 = 卡死
        if case .failure = h.js("1", timeout: 4) { ok = false; detail += " [JS-HANG]" }
        if !ok { anomalies += 1 }
        if kind != "log" && kind != "print" { record(round, i, kind, ok, detail) }
        h.pump(step["wait"] as? Int ?? 0)
    }
}
if let p = outPath { try? out.write(toFile: p, atomically: true, encoding: .utf8) }
print("SUMMARY rounds=\(rounds) anomalies=\(anomalies)")
exit(anomalies == 0 ? 0 : 1)
