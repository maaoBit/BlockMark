// BlockMark — 文档对象（NSDocument 架构：内容状态 + 自动保存 + 外部修改检测）
// M4: 自动保存（1s 防抖 + 终止冲刷）与外部修改检测（FSEventStream）
import Cocoa

/// 程序化 App 无 xib 时 NSDocumentController 的文档类自动发现不可靠，
/// 显式把 markdown 相关类型映射到 MarkdownDocument。
final class MarkdownDocumentController: NSDocumentController {
    override func documentClass(forType typeName: String) -> AnyClass? {
        switch typeName {
        case "net.daringfireball.markdown", "public.plain-text", "public.data",
             "net.daringfireball.markdown.md", "com.apple.traditional-mac-plain-text":
            return MarkdownDocument.self
        default:
            return super.documentClass(forType: typeName)
        }
    }
}

final class MarkdownDocument: NSDocument {

    /// 当前 markdown 全文。JS 层防抖推送 document.syncContent 维持其新鲜度；
    /// 保存前再通过 pullLatestMarkdown() 主动拉一次兜底。
    var markdown: String = ""

    /// 上次与磁盘一致的内容（区分"纯外部变更"与"双方都改"的冲突）
    var lastSyncedContent: String = ""

    private var autosaveWork: DispatchWorkItem?
    private var watcher: DocumentFileWatcher?
    private var conflictNotified = false
    /// 自持窗口控制器：自定义 NSDocumentController 打开路径下 AppKit 会绕过
    /// removeWindowController 清空 windowControllers 数组导致 wc 被释放（诊断实证），
    /// 这里显式强持有保活；取用点统一走 editorWC 计算属性。
    private(set) var strongEditorWC: EditorWindowController?

    /// 编辑器控制器取用点（windowControllers 数组会被 AppKit 清空，见 strongEditorWC 注释）
    var editorWC: EditorWindowController? { strongEditorWC }

    override class var readableTypes: [String] {
        ["net.daringfireball.markdown", "public.plain-text", "public.data"]
    }
    override class var writableTypes: [String] {
        ["net.daringfireball.markdown", "public.plain-text"]
    }

    override func read(from data: Data, ofType typeName: String) throws {
        guard let text = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "BlockMark", code: 1,
                          userInfo: [NSLocalizedDescriptionKey: "文件不是 UTF-8 文本"])
        }
        markdown = text
        lastSyncedContent = text
    }

    /// 所有保存入口（⌘S/另存为/关闭确认）的统一收口：先把 webview 最新内容拉回再写盘
    override func save(to url: URL, ofType typeName: String, for saveOperation: NSDocument.SaveOperationType,
                       delegate: Any?, didSave: Selector?, contextInfo: UnsafeMutableRawPointer?) {
        guard let wc = editorWC else {
            super.save(to: url, ofType: typeName, for: saveOperation,
                       delegate: delegate, didSave: didSave, contextInfo: contextInfo)
            return
        }
        let oldURL = fileURL
        wc.pullLatestMarkdown { [weak self] in
            guard let self else { return }
            // 用户显式保存 = 授权覆盖磁盘（解除冲突保持状态）
            self.conflictNotified = false
            self.autosaveWork?.cancel()
            self.autosaveWork = nil
            self.performSave(to: url, ofType: typeName, for: saveOperation,
                             delegate: delegate, didSave: didSave, contextInfo: contextInfo)
            self.editorWC?.pushJs("Editor.markSaved(false)")
            // 首次保存/另存为换了路径 → 重建外部修改监听
            if self.fileURL != oldURL { self.startWatching() }
        }
    }

    private func performSave(to url: URL, ofType typeName: String, for saveOperation: NSDocument.SaveOperationType,
                             delegate: Any?, didSave: Selector?, contextInfo: UnsafeMutableRawPointer?) {
        super.save(to: url, ofType: typeName, for: saveOperation,
                   delegate: delegate, didSave: didSave, contextInfo: contextInfo)
    }

    override func data(ofType typeName: String) throws -> Data {
        lastSyncedContent = markdown
        guard let data = markdown.data(using: .utf8) else {
            throw NSError(domain: "BlockMark", code: 2,
                          userInfo: [NSLocalizedDescriptionKey: "编码失败"])
        }
        return data
    }

    override func makeWindowControllers() {
        // AppKit 的 odoc 流程会调用本方法两次（实证）：先清旧控制器与其窗口，保证幂等
        if let old = strongEditorWC {
            removeWindowController(old)
            old.window?.close()
            strongEditorWC = nil
        }
        let wc = EditorWindowController(document: self)
        addWindowController(wc)
        strongEditorWC = wc
        wc.showWindow(nil)
        startWatching()
    }

    /// JS 层报 updateChangeCount 时标记已编辑（驱动 ⌘S/关闭确认）
    func markEdited() {
        updateChangeCount(.changeDone)
    }

    // MARK: - M4 自动保存

    /// JS syncContent 到达：更新内容；已有文件走自动保存，未命名文档只标脏
    func contentDidChange(_ content: String) {
        markdown = content
        if fileURL != nil {
            updateChangeCount(.changeDone)
            scheduleAutosave()
        } else {
            updateChangeCount(.changeDone)
        }
    }

    private func scheduleAutosave() {
        autosaveWork?.cancel()
        let work = DispatchWorkItem { [weak self] in self?.flushAutosave() }
        autosaveWork = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.0, execute: work)
    }

    /// 立即写盘（窗口关闭/应用退出时冲刷）
    @discardableResult
    func flushAutosave() -> Bool {
        autosaveWork?.cancel()
        autosaveWork = nil
        // 冲突保持中：外部修改只能由用户显式保存（⌘S）决定去留，自动保存让路
        guard !conflictNotified else { return false }
        guard let url = fileURL, markdown != lastSyncedContent else { return false }
        do {
            try markdown.data(using: .utf8)?.write(to: url, options: .atomic)
            lastSyncedContent = markdown
            updateChangeCount(.changeCleared)
            editorWC?.pushJs("Editor.markSaved(true)")
            conflictNotified = false
            return true
        } catch {
            NSLog("[BlockMark] autosave failed: %@", String(describing: error))
            return false
        }
    }

    // MARK: - M4 外部修改检测

    private func startWatching() {
        watcher?.stop()
        watcher = nil
        guard let url = fileURL else { return }
        watcher = DocumentFileWatcher(watch: url) { [weak self] in
            self?.handleExternalFileEvent()
        }
        watcher?.start()
    }

    private func handleExternalFileEvent() {
        guard let url = fileURL else { return }
        guard let data = try? Data(contentsOf: url),
              let disk = String(data: data, encoding: .utf8) else {
            toast("文件已被移动或删除，当前内容仍在编辑器中")
            return
        }
        if disk == markdown {
            // 自己的写入回流
            lastSyncedContent = disk
            return
        }
        if disk == lastSyncedContent {
            // 外部无实质变化（例如外部工具写回相同内容）
            return
        }
        if markdown == lastSyncedContent {
            // 本地无未同步编辑 → 纯外部变更，自动重载
            markdown = disk
            lastSyncedContent = disk
            editorWC?.sendMarkdown(disk)
            toast("文件已被其他程序修改，已重新加载")
        } else {
            // 双方都改 → 冲突，保留本地；挂起在途自动保存，兑现"⌘S 才覆盖"承诺
            autosaveWork?.cancel()
            autosaveWork = nil
            if !conflictNotified {
                conflictNotified = true
                toast("检测到外部修改与本编辑未保存内容冲突，已保留本地版本（⌘S 将覆盖磁盘）")
            }
        }
    }

    private func toast(_ msg: String) {
        editorWC?.toast(msg)
    }
}
