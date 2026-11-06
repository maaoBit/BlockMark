// BlockMark — 窗口控制器：WKWebView 壳 + 双向桥
// 桥契约：
//   JS→原生(异步): WKScriptMessage {name, data}
//   JS→原生(同步): prompt("__bridge__", json) 拦截（WKWebView 无同步通道的经典解法）
//   原生→JS:      evaluateJavaScript("Editor.xxx()")
import Cocoa
import WebKit

// MARK: - 拖拽打开（.md 拖入窗口 → 原生 odoc 打开；NSWindow 拖拽方法不可 override，用 contentView 作 destination）

final class DropView: NSView {
    var dropHandler: ((URL) -> Void)?

    override init(frame frameRect: NSRect) {
        super.init(frame: frameRect)
        registerForDraggedTypes([.fileURL])
    }
    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private func droppedMd(_ sender: NSDraggingInfo) -> URL? {
        let opts: [NSPasteboard.ReadingOptionKey: Any] = [.urlReadingFileURLsOnly: true]
        guard let urls = sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: opts) as? [URL] else { return nil }
        return urls.first { ["md", "markdown", "mdown", "mkd"].contains($0.pathExtension.lowercased()) }
    }

    override func draggingEntered(_ sender: NSDraggingInfo) -> NSDragOperation {
        return droppedMd(sender) != nil ? .copy : []
    }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        guard let url = droppedMd(sender) else { return false }
        dropHandler?(url)
        return true
    }
}

// MARK: - 手势 webview（双指捏合/⌘滚轮 = 正文字号缩放；mermaid 查看器打开期间手势直推查看器）
// WKWebView 事件缺口（Chromium e2e 测不到的接线层）：不给页面合成 gesturechange、
// 滚轮可能被滚动树吞掉滚穿到背后文档、全屏下 Esc 被系统抢去退全屏——
// 查看器打开期间（gestureRoutedToPage）三事件一律原生转译成桥命令。

final class PinchWebView: WKWebView {
    weak var gestureOwner: EditorWindowController?

    override func magnify(with event: NSEvent) {
        guard let owner = gestureOwner else { super.magnify(with: event); return }
        if owner.gestureRoutedToPage {
            owner.pushViewerZoom(1 + Double(event.magnification), event.locationInWindow)
        } else {
            owner.pinchFontSize(event.magnification)
        }
    }

    override func scrollWheel(with event: NSEvent) {
        guard let owner = gestureOwner else { super.scrollWheel(with: event); return }
        if owner.gestureRoutedToPage {
            // 查看器开：滚轮=缩放图；原生消费，防滚穿到背后文档
            let k: Double
            if event.hasPreciseScrollingDeltas {
                k = exp(-Double(event.scrollingDeltaY) * 0.0025)   // 触控板连续增量：平滑指数
            } else {
                k = event.scrollingDeltaY >= 0 ? 1 / 1.12 : 1.12   // 鼠标滚轮离散格
            }
            owner.pushViewerZoom(k, event.locationInWindow)
        } else if event.modifierFlags.contains(.command) {
            owner.cmdWheelFontSize(event.scrollingDeltaY)
        } else {
            super.scrollWheel(with: event)
        }
    }

    override func keyDown(with event: NSEvent) {
        // 查看器开的 Esc 在原生层先截（全屏时 WebKit 未消费的 Esc 会被系统当退出全屏）
        if event.keyCode == 53, let owner = gestureOwner, owner.gestureRoutedToPage {
            owner.pushJs("Editor._closeMermaidZoom()")
            return
        }
        super.keyDown(with: event)
    }
}

final class EditorWindowController: NSWindowController {

    /// NSWindowController.document 为 assign（unsafe）：文档释放后经 wc 读它会悬垂。
    /// 文档 → strongEditorWC 强持有 wc；wc → 文档只持 weak（无环，且回调安全）。
    private weak var docRef: MarkdownDocument?
    private var mdDocument: MarkdownDocument? { docRef }

    private(set) lazy var webView: WKWebView = {
        let contentController = WKUserContentController()
        contentController.add(BridgeSink(controller: self), name: "bridge")
        let config = WKWebViewConfiguration()
        config.userContentController = contentController
        let wv = PinchWebView(frame: .zero, configuration: config)
        wv.gestureOwner = self
        wv.uiDelegate = self
        wv.navigationDelegate = self
        wv.autoresizingMask = [.width, .height]
        if let resDir = Bundle.main.resourceURL?.appendingPathComponent("EditorResources", isDirectory: true) {
            // 读权限给根目录：文档图片（assets/ 等）在任意用户目录，EditorResources 之外
            wv.loadFileURL(resDir.appendingPathComponent("index.bundle.html"), allowingReadAccessTo: URL(fileURLWithPath: "/"))
        }
        return wv
    }()

    init(document doc: MarkdownDocument) {
        let window = NSWindow(
            contentRect: NSRect(x: 0, y: 0, width: 880, height: 640),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered, defer: false)
        window.title = doc.displayName ?? "未标记"
        window.titlebarAppearsTransparent = true
        window.isReleasedWhenClosed = false
        super.init(window: window)
        self.document = doc
        docRef = doc
        window.delegate = self
        // 程序化窗口不会触发 windowDidLoad（那是 nib 钩子），这里直接挂视图
        let drop = DropView(frame: NSRect(x: 0, y: 0, width: 880, height: 640))
        drop.autoresizingMask = [.width, .height]
        drop.dropHandler = { url in
            NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { _, _, _ in }
        }
        window.contentView = drop
        drop.addSubview(webView)
        webView.frame = NSRect(x: 0, y: 0, width: 880, height: 640)
        window.center()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }

    private static var pasteSeq = 0

    // MARK: - 正文字号（全局唯一值：捏合/⌘滚轮/⌘+−/设置窗口共用一条 ui.prefs 下发链，UserDefaults 持久化）

    static let fontSizeMin: Double = 10, fontSizeMax: Double = 32, fontSizeDefault: Double = 16
    private static let fontSizeKey = "BlockMark.fontSize"

    /// mermaid 查看器打开期间：捏合手势归还页面（ui.gestureRoute 路由，缩放图表而非字号）
    var gestureRoutedToPage = false

    static func currentFontSize() -> Double {
        let raw = UserDefaults.standard.object(forKey: fontSizeKey) as? Double ?? fontSizeDefault
        return min(fontSizeMax, max(fontSizeMin, raw))
    }

    static func allEditorWindowControllers() -> [EditorWindowController] {
        NSApp.windows.compactMap { $0.windowController as? EditorWindowController }
    }

    /// 钳制 → 持久化 → 广播全部编辑器窗口 + 回填设置窗口滑杆。
    /// quantized：手势类高频事件按 0.5px 量化；量化值不变则跳过（捏合高频去抖）。
    static func setFontSizeAll(_ raw: Double, quantized: Bool = false) {
        var v = min(fontSizeMax, max(fontSizeMin, raw))
        if quantized { v = (v * 2).rounded() / 2 } else { v = v.rounded() }
        if v == currentFontSize() { return }
        UserDefaults.standard.set(v, forKey: fontSizeKey)
        for wc in allEditorWindowControllers() {
            wc.dispatchToJs("ui.prefs", ["fontSize": v])
        }
        SettingsWindowController.shared.syncFontSize(v)
    }

    /// 双指捏合：事件增量乘法累积（整体捏合 2 倍 ≈ 字号 2 倍）
    @objc fileprivate func pinchFontSize(_ delta: CGFloat) {
        Self.setFontSizeAll(Self.currentFontSize() * (1 + Double(delta)), quantized: true)
    }

    /// ⌘+双指滚动： deltaY 向上为负 → 放大
    @objc fileprivate func cmdWheelFontSize(_ deltaY: CGFloat) {
        Self.setFontSizeAll(Self.currentFontSize() - Double(deltaY) * 0.12, quantized: true)
    }

    /// 查看器手势直推：窗口坐标 → 视口 CSS 坐标（WKWebView 顶左原点，翻 y）
    func pushViewerZoom(_ k: Double, _ locationInWindow: NSPoint) {
        let p = webView.convert(locationInWindow, from: nil)
        dispatchToJs("viewer.zoom", ["k": k, "x": p.x, "y": webView.bounds.height - p.y])
    }

    @objc func zoomInAction(_ sender: Any?) { Self.setFontSizeAll(Self.currentFontSize() + 1) }
    @objc func zoomOutAction(_ sender: Any?) { Self.setFontSizeAll(Self.currentFontSize() - 1) }
    @objc func zoomResetAction(_ sender: Any?) { Self.setFontSizeAll(Self.fontSizeDefault) }

    // MARK: - 桥：JS → 原生（异步消息）

    fileprivate func handleBridgeMessage(_ name: String, _ data: [String: Any]) {
        switch name {
        case "editor.ready":
            // 页面重载（WebContent 崩溃后自动恢复）后 JS 状态归零：手势路由必须复位，
            // 否则滚轮被原生截走推给不存在的查看器 → 文档滚不动、捏合不缩放
            gestureRoutedToPage = false
            if let md = mdDocument?.markdown, !md.isEmpty { sendMarkdown(md) }
            if let dir = mdDocument?.fileURL?.deletingLastPathComponent() {
                // 图片相对路径基准（file URL string 已编码，含中文/空格安全）
                dispatchToJs("doc.baseDir", ["base": dir.absoluteString + "/"])
            }
            if UserDefaults.standard.bool(forKey: "BlockMark.openSidebar") {
                pushJs("Editor.toggleSidebar(true)")
            }
            let savedTheme = UserDefaults.standard.string(forKey: "BlockMark.theme") ?? "default"
            applyTheme(savedTheme)
            dispatchToJs("ui.prefs", ["fontSize": Self.currentFontSize()])
        case "document.syncContent":
            if let content = data["content"] as? String { mdDocument?.contentDidChange(content) }
        case "document.updateChangeCount":
            mdDocument?.markEdited()
        case "path.openURL":
            if let s = data["url"] as? String { openUserLink(s) }
        case "images.savePasted":
            handleSavePasted(data)
        case "library.listDocs":
            handleListDocs(data)
        case "library.openFile":
            guard let p = data["path"] as? String else { return }
            // 点的就是当前文档 → JS 乐观高亮已正确，无需动作
            if mdDocument?.fileURL?.path == p { return }
            if data["newWindow"] as? Bool == true || mdDocument == nil || window == nil {
                // ⌘点击（或异常链路兜底）：显式开新窗
                NSDocumentController.shared.openDocument(withContentsOf: URL(fileURLWithPath: p),
                                                          display: true) { _, _, _ in }
            } else {
                // 默认：当前窗口原地换文档
                replaceCurrentDocument(with: URL(fileURLWithPath: p))
            }
        case "library.search":
            handleGlobalSearch(data)
        case "menu.showContext":
            handleContextMenu(data)
        case "ui.gestureRoute":
            // mermaid 查看器开/关：捏合手势在"缩放图表"与"缩放字号"间切换归属
            gestureRoutedToPage = (data["route"] as? String == "viewer")
        case "logger.debug":
            NSLog("[BlockMark JS] %@", String(describing: data))
        default:
            NSLog("[BlockMark] unhandled bridge message: %@", name)
        }
    }

    // MARK: - 桥：JS → 原生（同步 prompt 拦截）

    fileprivate func handleSyncBridge(_ name: String, _ data: [String: Any]) -> String {
        // 同步桥通道保留（prompt 拦截机制常驻）；暂无在用契约——相对路径解析已内联在
        // saveImageAs/openUserLink（Swift 侧直解，不再经 JS 往返）
        return encodeSyncResult(nil)
    }

    // MARK: - 图片粘贴（占位符 → 原生落盘 assets/ → 回推替换）

    private func handleSavePasted(_ data: [String: Any]) {
        let marker = data["marker"] as? String ?? ""
        let ext = data["ext"] as? String ?? "png"
        guard !marker.isEmpty,
              let dataUrl = data["dataUrl"] as? String,
              let comma = dataUrl.firstIndex(of: ","),
              let raw = Data(base64Encoded: String(dataUrl[dataUrl.index(after: comma)...])),
              let docDir = mdDocument?.fileURL?.deletingLastPathComponent() else {
            dispatchToJs("images.onSaved", ["marker": marker, "url": ""])
            return
        }
        let assetsDir = docDir.appendingPathComponent("assets", isDirectory: true)
        try? FileManager.default.createDirectory(at: assetsDir, withIntermediateDirectories: true)
        let name = "pasted-\(Int(Date().timeIntervalSince1970 * 1000))-\(Self.pasteSeq).\(ext)"
        Self.pasteSeq += 1
        let url = assetsDir.appendingPathComponent(name)
        do {
            try raw.write(to: url, options: .atomic)
            dispatchToJs("images.onSaved", ["marker": marker, "url": "assets/\(name)"])
        } catch {
            NSLog("[BlockMark] save pasted image failed: %@", String(describing: error))
            dispatchToJs("images.onSaved", ["marker": marker, "url": ""])
        }
    }

    // MARK: - M3 侧栏数据

    /// 列目录一层：path 为空 → 当前文档父目录（先回 onRoot）
    private func handleListDocs(_ data: [String: Any]) {
        let path = data["path"] as? String ?? ""
        let dir: URL
        if !path.isEmpty {
            dir = URL(fileURLWithPath: path)
        } else if let base = mdDocument?.fileURL?.deletingLastPathComponent() {
            dir = base
            dispatchToJs("library.onRoot", ["root": base.path,
                                            "current": mdDocument?.fileURL?.path ?? ""])
        } else {
            dispatchToJs("library.onRoot", ["root": "", "current": ""])
            return
        }
        let keys: [URLResourceKey] = [.isDirectoryKey]
        let raw = (try? FileManager.default.contentsOfDirectory(at: dir, includingPropertiesForKeys: keys,
                                                                 options: [.skipsHiddenFiles])) ?? []
        let entries: [[String: Any]] = raw
            .filter { !$0.lastPathComponent.hasPrefix(".") }
            .map { url in
                let isDir = (try? url.resourceValues(forKeys: Set(keys)))?.isDirectory ?? false
                return ["name": url.lastPathComponent, "path": url.path, "isDir": isDir] as [String: Any]
            }
            .filter { e in
                guard let isDir = e["isDir"] as? Bool else { return false }
                guard let name = e["name"] as? String else { return false }
                return isDir || name.hasSuffix(".md") || name.hasSuffix(".markdown")
            }
            .sorted { a, b in
                let ad = a["isDir"] as? Bool ?? false, bd = b["isDir"] as? Bool ?? false
                if ad != bd { return ad && !bd }
                return (a["name"] as? String ?? "") < (b["name"] as? String ?? "")
            }
        dispatchToJs("library.onDocs", ["dir": dir.path, "entries": entries])
    }

    /// 全局搜索（纯 Swift 目录扫描，流式分批回推；不捆绑外部二进制）
    private func handleGlobalSearch(_ data: [String: Any]) {
        let query = data["query"] as? String ?? ""
        let seq = data["seq"] as? Int ?? 0
        guard !query.isEmpty, let dir = mdDocument?.fileURL?.deletingLastPathComponent() else {
            dispatchToJs("globalSearch.onResults", ["results": [], "query": query, "seq": seq, "done": true])
            return
        }
        DispatchQueue.global(qos: .userInitiated).async { [weak self] in
            var batch: [[String: Any]] = []
            var total = 0
            let flush: (Bool) -> Void = { done in
                guard !batch.isEmpty || done else { return }
                let payload: [String: Any] = ["results": batch, "query": query, "seq": seq, "done": done]
                DispatchQueue.main.async { self?.dispatchToJs("globalSearch.onResults", payload) }
                batch = []
            }
            let fm = FileManager.default
            let en = fm.enumerator(at: dir, includingPropertiesForKeys: [.isDirectoryKey],
                                   options: [.skipsHiddenFiles, .skipsPackageDescendants])
            while let url = en?.nextObject() as? URL {
                if total >= 300 { break }
                let isDir = (try? url.resourceValues(forKeys: [.isDirectoryKey]))?.isDirectory ?? false
                if isDir { continue }
                let name = url.lastPathComponent
                guard name.hasSuffix(".md") || name.hasSuffix(".markdown") else { continue }
                guard let text = try? String(contentsOf: url, encoding: .utf8) else { continue }
                for (i, line) in text.components(separatedBy: .newlines).enumerated() {
                    let trimmed = line.trimmingCharacters(in: .whitespaces)
                    guard trimmed.count <= 300,
                          trimmed.range(of: query, options: .caseInsensitive) != nil else { continue }
                    batch.append(["path": url.path, "name": name, "line": i + 1, "text": trimmed])
                    total += 1
                    if batch.count >= 30 { flush(false); if total >= 300 { break } }
                }
            }
            flush(true)
        }
    }

    // MARK: - 右键菜单（JS 收集上下文，原生弹 NSMenu，命令分发）

    private var ctxLink = ""
    private var ctxImg = ""
    private var ctxCid = ""
    private var ctxTr = -1   // 右键落在表格格内时的行/列（-1 = 非表格）
    private var ctxTc = -1

    private func handleContextMenu(_ data: [String: Any]) {
        ctxLink = data["link"] as? String ?? ""
        ctxImg = data["img"] as? String ?? ""
        ctxCid = data["cid"] as? String ?? ""
        ctxTr = data["tr"] as? Int ?? -1
        ctxTc = data["tc"] as? Int ?? -1
        let items = data["items"] as? [[String: Any]] ?? []
        let menu = NSMenu()
        for it in items {
            if it["sep"] as? Bool == true { menu.addItem(.separator()); continue }
            let item = NSMenuItem(title: it["label"] as? String ?? "",
                                   action: #selector(contextAction(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = it["cmd"] as? String ?? ""
            menu.addItem(item)
        }
        // 用右键事件自身的窗口坐标弹出（不依赖 JS 页面坐标换算）
        if let event = NSApp.currentEvent {
            menu.popUp(positioning: nil, at: event.locationInWindow, in: webView)
        }
    }

    @objc func contextAction(_ sender: NSMenuItem) {
        switch sender.representedObject as? String ?? "" {
        case "cut":
            pushJs("document.execCommand('cut')")
        case "copy":
            pushJs("document.execCommand('copy')")
        case "paste":
            let text = NSPasteboard.general.string(forType: .string) ?? ""
            var payload: [String: Any] = ["cmd": "paste", "text": text, "cid": ctxCid]
            if ctxTr >= 0 && ctxTc >= 0 { payload["tr"] = ctxTr; payload["tc"] = ctxTc }
            dispatchToJs("menu.onCommand", payload)
        case "openLink":
            if let url = URL(string: ctxLink),
               ["http", "https", "file"].contains(url.scheme?.lowercased() ?? "") {
                NSWorkspace.shared.open(url)
            }
        case "copyLink", "copyImg":
            let s = sender.representedObject as? String == "copyImg" ? ctxImg : ctxLink
            NSPasteboard.general.clearContents()
            NSPasteboard.general.setString(s, forType: .string)
        case "saveImg":
            saveImageAs()
        case "bold", "italic":
            dispatchToJs("menu.onCommand", ["cmd": sender.representedObject ?? "", "cid": ctxCid])
        case let cmd where cmd.hasPrefix("table."):
            // 表格结构命令（插行/删行/插列/删列/删表），JS 侧按 tr/tc 定位
            var payload: [String: Any] = ["cmd": cmd, "cid": ctxCid]
            if ctxTr >= 0 && ctxTc >= 0 { payload["tr"] = ctxTr; payload["tc"] = ctxTc }
            dispatchToJs("menu.onCommand", payload)
        case "mermaid.preview":
            dispatchToJs("menu.onCommand", ["cmd": "mermaid.preview", "cid": ctxCid])
        default:
            break
        }
    }

    /// 链接打开：http(s)/file 直接开；相对路径按文档目录解析——.md 走应用内打开（知识库跳转），其余交系统
    private func openUserLink(_ s: String) {
        if let url = URL(string: s), let scheme = url.scheme?.lowercased(),
           ["http", "https", "file"].contains(scheme) {
            NSWorkspace.shared.open(url)
            return
        }
        guard !s.isEmpty, let base = mdDocument?.fileURL?.deletingLastPathComponent() else {
            toast("无法打开链接：\(s)")
            return
        }
        let abs = URL(fileURLWithPath: s, relativeTo: base).absoluteURL
        if ["md", "markdown", "mdown", "mkd"].contains(abs.pathExtension.lowercased()) {
            NSDocumentController.shared.openDocument(withContentsOf: abs, display: true) { _, _, _ in }
        } else {
            NSWorkspace.shared.open(abs)
        }
    }

    private func saveImageAs() {
        // 相对路径（贴图 assets/… 等）按文档目录解析为绝对 file URL；远程/无文档仍提示
        var imgURL = URL(string: ctxImg)
        if let u = imgURL, u.scheme == nil, !ctxImg.isEmpty,
           let base = mdDocument?.fileURL?.deletingLastPathComponent() {
            imgURL = URL(fileURLWithPath: ctxImg, relativeTo: base).absoluteURL
        }
        guard let url = imgURL, url.isFileURL,
              let data = try? Data(contentsOf: url) else {
            toast("无法读取图片（仅支持本地文件）")
            return
        }
        let name = url.lastPathComponent
        writePanel(defaultName: name) { target in
            do { try data.write(to: target) } catch { self.toast("存储失败：\(error.localizedDescription)") }
        }
    }

    // MARK: - 关闭审查（未保存文档关窗必须过审：存储…/取消/不存储；Typora/TextEdit 惯例）
    // 程序化窗口链路上 AppKit 默认的 canCloseDocument 审查不生效（实证：edited 未命名文档点红叉直接关窗丢内容）
    // —— 这里显式接管：先拉最新内容+冲刷文件型自动保存，仍有未保存变更才弹表单。

    private var closeFlowDone = false       // completeClose 内 window.close() 的放行标志（防审查重入）
    private var closeReviewInFlight = false // 异步拉取/表单期间的二次红叉防重入（否则双 sheet 双 completeClose）

    func windowShouldClose(_ sender: NSWindow) -> Bool {
        guard let doc = mdDocument, !closeFlowDone else { return true }
        guard !closeReviewInFlight else { return false }
        closeReviewInFlight = true
        reviewUnsavedChanges(reason: "关闭") { [weak self] proceed in
            guard let self else { return }
            self.closeReviewInFlight = false
            if proceed { self.completeClose() }
        }
        return false
    }

    /// 未保存审查（关窗 / 原地换文档共用）：拉最新内容 + 冲刷自动保存，仍有未保存变更弹表单。
    /// done(true) = 可安全放弃当前文档（已落盘或用户选“不存储”）；false = 用户取消或写失败。
    private func reviewUnsavedChanges(reason: String, done: @escaping (Bool) -> Void) {
        guard let doc = mdDocument else { done(true); return }
        pullLatestMarkdown { [weak self] in
            guard let self, let win = self.window, self.mdDocument === doc else { return }
            doc.flushAutosave()   // 文件型：防抖尾巴落盘并清 edited；未命名/写失败 → 保持 edited 过审
            if !doc.isDocumentEdited { done(true); return }
            let alert = NSAlert()
            alert.messageText = "要把对“\(doc.displayName ?? "未标记")”的更改存储吗？"
            alert.informativeText = "\(reason)前存储更改，或选择“不存储”放弃。"
            alert.addButton(withTitle: "存储…")
            alert.addButton(withTitle: "取消")
            alert.addButton(withTitle: "不存储")
            alert.beginSheetModal(for: win) { [weak self] response in
                guard let self else { return }
                switch response {
                case .alertFirstButtonReturn: self.saveReviewed(reason: reason, done: done)   // 存储…
                case .alertThirdButtonReturn: done(true)                                 // 不存储
                default: done(false)                                                     // 取消 → 留在编辑器
                }
            }
        }
    }

    /// 审查表单“存储…”的落盘；done(false) = 写失败，操作取消留在编辑器
    private func saveReviewed(reason: String, done: @escaping (Bool) -> Void) {
        guard let doc = mdDocument else { done(true); return }
        let write: (URL) -> Void = { [weak self] url in
            guard let data = doc.markdown.data(using: .utf8),
                  (try? data.write(to: url, options: .atomic)) != nil else {
                self?.toast("写入失败，\(reason)已取消")
                done(false)
                return   // 写失败保持开窗，内容不丢
            }
            done(true)
        }
        if let url = doc.fileURL { write(url); return }
        writePanel(defaultName: (doc.displayName ?? "未标记") + ".md") { url in write(url) }
    }

    // MARK: - 原地换文档（侧栏默认点击行为；⌘点击仍开新窗）

    private var replaceInFlight = false   // 双击文件项防重入（审查/打开均异步，防双表单双替换）

    /// 当前窗口原地换文档：未保存审查 → 静默打开新文档 → wc 转移——窗口/webview/侧栏 DOM
    /// 全不动，只重载编辑器内容（Obsidian 式无整窗刷新）。旧文档解绑注销，窗口不重建，
    /// 也就没有”先显新窗再关旧窗”的 lastWindow 退出时序问题。
    private func replaceCurrentDocument(with url: URL) {
        guard !replaceInFlight else { return }
        replaceInFlight = true
        // 已在别的窗口打开 → 把那扇窗带前来即可（不动当前文档，无需审查）
        if let existing = NSDocumentController.shared.documents.first(where: {
            ($0 as? MarkdownDocument)?.fileURL == url
        }) as? MarkdownDocument, existing !== mdDocument {
            replaceInFlight = false
            if let w = existing.editorWC?.window {
                if w.isMiniaturized { w.deminiaturize(nil) }
                w.makeKeyAndOrderFront(nil)
            }
            restoreSidebarHighlight()
            return
        }
        reviewUnsavedChanges(reason: "切换文档") { [weak self] proceed in
            guard let self else { return }
            guard proceed else { self.abortReplace(); return }   // 取消审查 → 拨回高亮
            NSDocumentController.shared.openDocument(withContentsOf: url, display: false) { [weak self] doc, _, _ in
                guard let self else { return }
                guard let newDoc = doc as? MarkdownDocument, newDoc !== self.mdDocument else {
                    self.abortReplace()   // 打开失败/去重回流同一文档 → 保持现状
                    return
                }
                self.replaceInFlight = false
                self.adopt(document: newDoc)
            }
        }
    }

    /// wc 转移：旧文档解绑注销（审查已过），本 wc 绑定新文档并只重载编辑器内容
    private func adopt(document newDoc: MarkdownDocument) {
        if let old = mdDocument { old.detachWindowControllerAndClose(self) }
        self.document = newDoc
        docRef = newDoc
        window?.title = newDoc.displayName ?? "未标记"
        newDoc.attachExistingWindowController(self)
        if let dir = newDoc.fileURL?.deletingLastPathComponent() {
            // 图片相对路径基准（file URL string 已编码，含中文/空格安全）
            dispatchToJs("doc.baseDir", ["base": dir.absoluteString + "/"])
        }
        sendMarkdown(newDoc.markdown)   // Editor.open：清撤销栈/编辑态并重渲染
        if let p = newDoc.fileURL?.path {
            dispatchToJs("library.onCurrent", ["current": p])   // 侧栏高亮切换，根目录不动
        }
    }

    /// 替换取消/失败：侧栏点击是乐观高亮，这里把高亮拨回当前文档
    private func abortReplace() {
        replaceInFlight = false
        restoreSidebarHighlight()
    }

    private func restoreSidebarHighlight() {
        guard let file = mdDocument?.fileURL else { return }
        dispatchToJs("library.onRoot", ["root": file.deletingLastPathComponent().path, "current": file.path])
    }

    private func completeClose() {
        guard let doc = mdDocument, let win = window else { return }
        closeFlowDone = true
        doc.updateChangeCount(.changeCleared)   // 防 doc.close() 内部再审
        win.close()
        doc.close()   // 从 NSDocumentController 移除（最后一个文档关闭即干净退出，不留无窗僵尸进程）
        closeFlowDone = false
    }

    // MARK: - 存储 ⌘S / 另存为 ⇧⌘S（菜单 action 经响应链到 window delegate = 本控制器，转发给文档）

    @objc func saveMenuAction(_ sender: Any?) {
        // NSDocument.save(_:) 全流程：已命名文件就地写，未命名文档弹存储面板
        mdDocument?.save(sender)
    }

    @objc func saveAsMenuAction(_ sender: Any?) {
        mdDocument?.saveAs(sender)
    }

    // MARK: - 查找 ⌘F（编辑器内 findbar）

    @objc func findAction(_ sender: Any?) {
        pushJs("Editor.openFindBar()")
    }

    // MARK: - Pandoc 导出（Word docx；未安装时提示）

    static func pandocPath() -> URL? {
        for p in ["/opt/homebrew/bin/pandoc", "/usr/local/bin/pandoc", "/usr/bin/pandoc"]
        where FileManager.default.isExecutableFile(atPath: p) {
            return URL(fileURLWithPath: p)
        }
        let which = Process()
        which.executableURL = URL(fileURLWithPath: "/usr/bin/env")
        which.arguments = ["which", "pandoc"]
        let pipe = Pipe()
        which.standardOutput = pipe
        which.standardError = Pipe()
        guard (try? which.run()) != nil else { return nil }
        which.waitUntilExit()
        guard let s = String(data: pipe.fileHandleForReading.readDataToEndOfFile(), encoding: .utf8)?
            .trimmingCharacters(in: .whitespacesAndNewlines), !s.isEmpty else { return nil }
        return URL(fileURLWithPath: s)
    }

    @objc func exportDocx(_ sender: Any?) {
        guard let pandoc = Self.pandocPath() else {
            let alert = NSAlert()
            alert.messageText = "未找到 pandoc"
            alert.informativeText = "导出 Word 需要 pandoc：\nbrew install pandoc"
            alert.runModal()
            return
        }
        pullLatestMarkdown { [weak self] in
            guard let self, let md = self.mdDocument?.markdown else { return }
            let name = (self.mdDocument?.displayName ?? "未标记") + ".docx"
            self.writePanel(defaultName: name) { url in
                DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                    // 输入走临时文件：管道 stdin 在 pandoc 提前退出时 write 抛 ObjC 异常（不可 catch）
                    let tmp = FileManager.default.temporaryDirectory
                        .appendingPathComponent("blockmark-pandoc-\(UUID().uuidString).md")
                    guard (try? md.data(using: .utf8)?.write(to: tmp)) != nil else {
                        DispatchQueue.main.async { self?.toast("写入临时文件失败") }
                        return
                    }
                    defer { try? FileManager.default.removeItem(at: tmp) }
                    let p = Process()
                    p.executableURL = pandoc
                    p.arguments = ["-f", "gfm", "-t", "docx", "-i", tmp.path, "-o", url.path]
                    let errPipe = Pipe()
                    p.standardError = errPipe
                    // 后台排空 stderr，防缓冲填满阻塞
                    DispatchQueue.global().async { _ = errPipe.fileHandleForReading.readDataToEndOfFile() }
                    do {
                        try p.run()
                        p.waitUntilExit()
                        let ok = p.terminationStatus == 0
                        DispatchQueue.main.async {
                            self?.toast(ok ? "已导出 Word：\(url.lastPathComponent)" : "Pandoc 导出失败")
                        }
                    } catch {
                        DispatchQueue.main.async { self?.toast("Pandoc 启动失败") }
                    }
                }
            }
        }
    }

    private func encodeSyncResult(_ obj: [String: Any]?) -> String {
        guard let obj = obj, let data = try? JSONSerialization.data(withJSONObject: obj),
              let s = String(data: data, encoding: .utf8) else { return "null" }
        return s
    }

    // MARK: - 原生 → JS

    func pushJs(_ js: String) {
        webView.evaluateJavaScript(js, completionHandler: nil)
    }

    /// 桥回推：Bridge.dispatch(name, payload)（JSON 即 JS 字面量）
    func dispatchToJs(_ name: String, _ payload: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        pushJs("Bridge.dispatch('\(name)', \(json))")
    }

    /// JS toast 通知（M4 外部修改提示等）
    func toast(_ message: String) {
        let escaped = message.replacingOccurrences(of: "\\", with: "\\\\")
                             .replacingOccurrences(of: "'", with: "\\'")
                             .replacingOccurrences(of: "\n", with: " ")
        pushJs("Editor.toast('\(escaped)')")
    }

    /// 装载文档到编辑器。内容经 JSON 字面量传递（合法 JS 字符串，含 $/引号/换行天然安全），
    /// 杜绝手写转义——此前 `$`→`$$` 是 String.replace 替换串的转义语义，误用到 eval 里污染了文档内容。
    func sendMarkdown(_ md: String) {
        guard JSONSerialization.isValidJSONObject([md]),
              let data = try? JSONSerialization.data(withJSONObject: [md]),
              let json = String(data: data, encoding: .utf8) else {
            // JSON 编码仅因控制字符失败（内容本身可含）——退化为占位装载
            webView.evaluateJavaScript("Editor.open('')", completionHandler: onOpenEval(_:error:))
            return
        }
        // json 是 ["..."]，取内层字符串字面量
        let literal = json.dropFirst().dropLast()
        webView.evaluateJavaScript("Editor.open(\(literal))", completionHandler: onOpenEval(_:error:))
    }

    private func onOpenEval(_ result: Any?, error: Error?) {
        if let error { toast("Editor.open eval error: \(error.localizedDescription)") }
    }

    /// 拉取 webview 中的最新 markdown（保存/导出前调用）
    func pullLatestMarkdown(_ done: @escaping () -> Void) {
        webView.evaluateJavaScript("Editor.getMarkdown()") { result, _ in
            if let s = result as? String { self.mdDocument?.markdown = s }
            done()
        }
    }

    // MARK: - 菜单动作

    @objc func toggleSourceMode(_ sender: Any?) {
        webView.evaluateJavaScript("Editor.toggleSourceMode()", completionHandler: nil)
    }

    // MARK: - 主题（CSS 文本经桥下发 #theme_css 动态注入，避开 WKWebView file:// 读用户目录限制）

    @objc func applyThemeAction(_ sender: NSMenuItem) {
        applyTheme(sender.representedObject as? String ?? "default")
    }

    func applyTheme(_ name: String) {
        var css = ""
        if name != "default" {
            let bundled = Bundle.main.resourceURL?
                .appendingPathComponent("EditorResources/themes/\(name).css")
            let user = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
                .appendingPathComponent("BlockMark/themes/\(name).css")
            if let bundled, let text = try? String(contentsOf: bundled, encoding: .utf8) {
                css = text
            } else if let text = try? String(contentsOf: user, encoding: .utf8) {
                css = text
            }
        }
        UserDefaults.standard.set(name, forKey: "BlockMark.theme")
        dispatchToJs("theme.apply", ["name": name, "css": css])
        // 菜单勾选态
        if let menu = NSApp.mainMenu, let viewMenu = menu.item(withTitle: "视图")?.submenu,
           let themeItem = viewMenu.item(withTitle: "主题"), let themeMenu = themeItem.submenu {
            for item in themeMenu.items {
                item.state = (item.representedObject as? String == name) ? .on : .off
            }
        }
    }

    @objc func formatAction(_ sender: NSMenuItem) {
        guard let cmd = sender.representedObject as? String else { return }
        pushJs("Editor.format('\(cmd)')")
    }

    @objc func toggleTypewriterAction(_ sender: Any?) {
        pushJs("Editor.toggleTypewriter()")
    }

    @objc func toggleFocusAction(_ sender: Any?) {
        pushJs("Editor.toggleFocusMode()")
    }

    @objc func toggleSidebarAction(_ sender: Any?) {
        // 偏好即事实源（下次启动恢复侧栏状态）
        let open = !UserDefaults.standard.bool(forKey: "BlockMark.openSidebar")
        UserDefaults.standard.set(open, forKey: "BlockMark.openSidebar")
        pushJs("Editor.toggleSidebar(\(open))")
    }

    @objc func exportHTML(_ sender: Any?) {
        pullLatestMarkdown { [weak self] in
            guard let self else { return }
            self.webView.evaluateJavaScript("Editor.getExportHtml()") { result, _ in
                guard let html = result as? String else { return }
                let name = (self.mdDocument?.displayName ?? "未标记") + ".html"
                let inlined = Self.setExportFontSize(Self.inlineExportCss(html), px: Self.currentFontSize())
                self.writePanel(defaultName: name) { url in
                    if let d = inlined.data(using: .utf8) {
                        do { try d.write(to: url) } catch { self.toast("导出失败：\(error.localizedDescription)") }
                    } else { self.toast("导出失败：内容编码错误") }
                }
            }
        }
    }

    /// 导出产物的 <link rel=stylesheet> 相对路径离开 app 资源目录即 404 → 内联为 <style>
    private static func inlineExportCss(_ html: String) -> String {
        guard let resDir = Bundle.main.resourceURL?
            .appendingPathComponent("EditorResources", isDirectory: true) else { return html }
        var out = html
        let re = try? NSRegularExpression(pattern: #"<link\s+rel="stylesheet"\s+href="([^"]+)"[^>]*>"#)
        guard let re else { return html }
        let matches = re.matches(in: html, range: NSRange(html.startIndex..., in: html)).reversed()
        for m in matches where m.numberOfRanges > 1 {
            guard let r = Range(m.range(at: 1), in: html) else { continue }
            let href = String(html[r])
            let cssURL = resDir.appendingPathComponent(href)
            guard let css = try? String(contentsOf: cssURL, encoding: .utf8) else { continue }
            guard let full = Range(m.range, in: html) else { continue }
            out.replaceSubrange(full, with: "<style>\n\(css)\n</style>")
        }
        return out
    }

    /// 导出 HTML 内联当前字号（离开 app 后 :root 变量不再有原生 ui.prefs 通道下发）
    private static func setExportFontSize(_ html: String, px: Double) -> String {
        guard let headRange = html.range(of: "</head>") else { return html }
        return html.replacingCharacters(in: headRange,
                                        with: "<style>:root{--font-size-base:\(px)px}</style></head>")
    }

    @objc func exportPDF(_ sender: Any?) {
        pullLatestMarkdown { [weak self] in
            guard let self else { return }
            if #available(macOS 12.0, *) {
                self.webView.createPDF { [weak self] result in
                    guard let self else { return }
                    switch result {
                    case .success(let data):
                        let name = (self.mdDocument?.displayName ?? "未标记") + ".pdf"
                        self.writePanel(defaultName: name) { url in
                            do { try data.write(to: url) } catch { self.toast("导出失败：\(error.localizedDescription)") }
                        }
                    case .failure(let err):
                        NSLog("[BlockMark] PDF export failed: %@", String(describing: err))
                    }
                }
            }
        }
    }

    private func writePanel(defaultName: String, write: @escaping (URL) -> Void) {
        let panel = NSSavePanel()
        panel.nameFieldStringValue = defaultName
        panel.canCreateDirectories = true
        panel.beginSheetModal(for: window ?? NSApp.windows[0]) { response in
            if response == .OK, let url = panel.url { write(url) }
        }
    }
}

// MARK: - WKScriptMessageSink（避免强引用环）

private final class BridgeSink: NSObject, WKScriptMessageHandler {
    weak var controller: EditorWindowController?
    init(controller: EditorWindowController) { self.controller = controller }

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let name = body["name"] as? String else { return }
        let data = body["data"] as? [String: Any] ?? [:]
        controller?.handleBridgeMessage(name, data)
    }
}

// MARK: - prompt 拦截（同步桥）

extension EditorWindowController: WKUIDelegate, WKNavigationDelegate, NSWindowDelegate {

    func webView(_ webView: WKWebView,
                 runJavaScriptTextInputPanelWithPrompt prompt: String,
                 defaultText: String?,
                 initiatedByFrame frame: WKFrameInfo,
                 completionHandler: @escaping (String?) -> Void) {
        guard prompt == "__bridge__", let payload = defaultText?.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: payload) as? [String: Any],
              let name = obj["name"] as? String else {
            completionHandler(nil)
            return
        }
        let data = obj["data"] as? [String: Any] ?? [:]
        completionHandler(handleSyncBridge(name, data))
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        NSLog("[BlockMark] navigation failed: %@", String(describing: error))
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        NSLog("[BlockMark] provisional navigation failed: %@", String(describing: error))
    }
}
