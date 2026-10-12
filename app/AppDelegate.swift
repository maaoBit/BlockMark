// BlockMark — 应用委托 + 菜单
import Cocoa

/// "打开最近"子菜单：打开时动态重建（NSDocumentController.recentDocumentURLs）
final class RecentMenu: NSMenu, NSMenuDelegate {
    override init(title: String) {
        super.init(title: title)
        delegate = self
    }
    required init(coder: NSCoder) { fatalError() }
    func menuNeedsUpdate(_ menu: NSMenu) {
        for item in items.dropFirst(0) { removeItem(item) }
        let urls = NSDocumentController.shared.recentDocumentURLs
        if urls.isEmpty {
            addItem(withTitle: "（无最近文档）", action: nil, keyEquivalent: "").isEnabled = false
            return
        }
        for url in urls.prefix(10) {
            addItem(withTitle: url.lastPathComponent, action: #selector(AppDelegate.openRecent(_:)), keyEquivalent: "")
                .representedObject = url
        }
    }
}

final class AppDelegate: NSObject, NSApplicationDelegate {

    @objc func openRecent(_ sender: NSMenuItem) {
        guard let url = sender.representedObject as? URL else { return }
        NSDocumentController.shared.openDocument(withContentsOf: url, display: true) { _, _, _ in }
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildMenus()
        // argv 文件由 AppKit 原生 odoc 流程打开（手动再调 openDocument 会双开——实证 documents=2）
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self, NSDocumentController.shared.documents.isEmpty else { return }
            self.openFallbackUntitled()
        }
        NSApp.activate(ignoringOtherApps: true)
    }

    /// 主题清单：内置（default/dark/paper）+ 用户主题目录
    static func themeList() -> [String] {
        var names = ["default"]
        if let themesURL = Bundle.main.resourceURL?.appendingPathComponent("EditorResources/themes", isDirectory: true),
           let files = try? FileManager.default.contentsOfDirectory(at: themesURL, includingPropertiesForKeys: nil) {
            names += files.filter { $0.pathExtension == "css" }.map { $0.deletingPathExtension().lastPathComponent }.sorted()
        }
        let userDir = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("BlockMark/themes", isDirectory: true)
        if let files = try? FileManager.default.contentsOfDirectory(at: userDir, includingPropertiesForKeys: nil) {
            names += files.filter { $0.pathExtension == "css" }.map { $0.deletingPathExtension().lastPathComponent }.sorted()
        }
        return names
    }

    private func openFallbackUntitled() {        do {
            _ = try NSDocumentController.shared.openUntitledDocumentAndDisplay(true)
        } catch {
            let doc = MarkdownDocument()
            doc.makeWindowControllers()
            doc.showWindows()
        }
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    func applicationWillTerminate(_ notification: Notification) {
        // 冲刷所有文档的待写自动保存
        for case let doc as MarkdownDocument in NSDocumentController.shared.documents {
            doc.flushAutosave()
        }
    }

    // MARK: - 菜单（程序化构建，action 走响应链转发）

    private func buildMenus() {
        let mainMenu = NSMenu()

        // App 菜单
        let appMenu = NSMenuItem(title: "BlockMark", action: nil, keyEquivalent: "")
        let appSubMenu = NSMenu()
        appSubMenu.addItem(withTitle: "关于 BlockMark", action: #selector(NSApplication.orderFrontStandardAboutPanel(_:)), keyEquivalent: "")
        appSubMenu.addItem(.separator())
        appSubMenu.addItem(withTitle: "退出", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        appMenu.submenu = appSubMenu
        mainMenu.addItem(appMenu)

        // 文件菜单
        let fileMenu = NSMenuItem(title: "文件", action: nil, keyEquivalent: "")
        let fileSubMenu = NSMenu(title: "文件")
        fileSubMenu.addItem(withTitle: "新建", action: #selector(NSDocumentController.newDocument(_:)), keyEquivalent: "n")
        fileSubMenu.addItem(withTitle: "打开…", action: #selector(NSDocumentController.openDocument(_:)), keyEquivalent: "o")
        let recentMenu = NSMenuItem(title: "打开最近", action: nil, keyEquivalent: "")
        let recentSubMenu = RecentMenu(title: "打开最近")
        recentSubMenu.autoenablesItems = false
        recentMenu.submenu = recentSubMenu
        fileSubMenu.addItem(recentMenu)
        fileSubMenu.addItem(.separator())
        fileSubMenu.addItem(withTitle: "存储", action: #selector(NSDocument.save(_:)), keyEquivalent: "s")
        fileSubMenu.addItem(withTitle: "另存为…", action: #selector(NSDocument.saveAs(_:)), keyEquivalent: "S")
        fileSubMenu.addItem(.separator())
        let exportHTML = fileSubMenu.addItem(withTitle: "导出 HTML…", action: #selector(EditorWindowController.exportHTML(_:)), keyEquivalent: "h")
        exportHTML.keyEquivalentModifierMask = [.command, .shift]
        let exportPDF = fileSubMenu.addItem(withTitle: "导出 PDF…", action: #selector(EditorWindowController.exportPDF(_:)), keyEquivalent: "p")
        exportPDF.keyEquivalentModifierMask = [.command, .shift]
        fileSubMenu.addItem(withTitle: "导出 Word (docx)…", action: #selector(EditorWindowController.exportDocx(_:)), keyEquivalent: "")
        fileMenu.submenu = fileSubMenu
        mainMenu.addItem(fileMenu)

        // 编辑菜单（转发到响应链 → WKWebView 文本编辑）
        let editMenu = NSMenuItem(title: "编辑", action: nil, keyEquivalent: "")
        let editSubMenu = NSMenu(title: "编辑")
        editSubMenu.addItem(withTitle: "撤销", action: Selector(("undo:")), keyEquivalent: "z")
        editSubMenu.addItem(withTitle: "重做", action: Selector(("redo:")), keyEquivalent: "Z")
        editSubMenu.addItem(.separator())
        editSubMenu.addItem(withTitle: "剪切", action: #selector(NSText.cut(_:)), keyEquivalent: "x")
        editSubMenu.addItem(withTitle: "拷贝", action: #selector(NSText.copy(_:)), keyEquivalent: "c")
        editSubMenu.addItem(withTitle: "粘贴", action: #selector(NSText.paste(_:)), keyEquivalent: "v")
        editSubMenu.addItem(withTitle: "全选", action: #selector(NSResponder.selectAll(_:)), keyEquivalent: "a")
        editSubMenu.addItem(.separator())
        editSubMenu.addItem(withTitle: "查找", action: #selector(EditorWindowController.findAction(_:)), keyEquivalent: "f")
        editMenu.submenu = editSubMenu
        mainMenu.addItem(editMenu)

        // 格式菜单
        let fmtMenu = NSMenuItem(title: "格式", action: nil, keyEquivalent: "")
        let fmtSubMenu = NSMenu(title: "格式")
        fmtSubMenu.addItem(withTitle: "加粗", action: #selector(EditorWindowController.formatAction(_:)), keyEquivalent: "b").representedObject = "bold"
        fmtSubMenu.addItem(withTitle: "斜体", action: #selector(EditorWindowController.formatAction(_:)), keyEquivalent: "i").representedObject = "italic"
        fmtSubMenu.addItem(.separator())
        for (i, label) in ["标题 1", "标题 2", "标题 3", "标题 4", "标题 5", "标题 6"].enumerated() {
            let item = fmtSubMenu.addItem(withTitle: label, action: #selector(EditorWindowController.formatAction(_:)), keyEquivalent: String(i + 1))
            item.keyEquivalentModifierMask = [.command]
            item.representedObject = "h\(i + 1)"
        }
        fmtSubMenu.addItem(.separator())
        fmtSubMenu.addItem(withTitle: "引用块", action: #selector(EditorWindowController.formatAction(_:)), keyEquivalent: "").representedObject = "quote"
        fmtSubMenu.addItem(withTitle: "代码块", action: #selector(EditorWindowController.formatAction(_:)), keyEquivalent: "").representedObject = "code"
        fmtSubMenu.addItem(withTitle: "公式块", action: #selector(EditorWindowController.formatAction(_:)), keyEquivalent: "").representedObject = "math"
        fmtSubMenu.addItem(withTitle: "表格", action: #selector(EditorWindowController.formatAction(_:)), keyEquivalent: "t").representedObject = "table"
        fmtSubMenu.addItem(withTitle: "分隔线", action: #selector(EditorWindowController.formatAction(_:)), keyEquivalent: "-").representedObject = "hr"
        fmtMenu.submenu = fmtSubMenu
        mainMenu.addItem(fmtMenu)

        // 视图菜单
        let viewMenu = NSMenuItem(title: "视图", action: nil, keyEquivalent: "")
        let viewSubMenu = NSMenu(title: "视图")
        viewSubMenu.addItem(withTitle: "切换源码模式", action: #selector(EditorWindowController.toggleSourceMode(_:)), keyEquivalent: "/")
        viewSubMenu.addItem(withTitle: "切换侧栏", action: #selector(EditorWindowController.toggleSidebarAction(_:)), keyEquivalent: "\\")
        let typewriter = viewSubMenu.addItem(withTitle: "打字机模式", action: #selector(EditorWindowController.toggleTypewriterAction(_:)), keyEquivalent: "t")
        typewriter.keyEquivalentModifierMask = [.command, .option]
        let focus = viewSubMenu.addItem(withTitle: "专注模式", action: #selector(EditorWindowController.toggleFocusAction(_:)), keyEquivalent: "f")
        focus.keyEquivalentModifierMask = [.command, .option]
        // 主题子菜单：内置 themes/ + 用户 ~/Library/Application Support/BlockMark/themes/
        let themeMenu = NSMenuItem(title: "主题", action: nil, keyEquivalent: "")
        let themeSubMenu = NSMenu(title: "主题")
        for name in Self.themeList() {
            let item = NSMenuItem(title: name, action: #selector(EditorWindowController.applyThemeAction(_:)), keyEquivalent: "")
            item.representedObject = name
            themeSubMenu.addItem(item)
        }
        themeMenu.submenu = themeSubMenu
        viewSubMenu.addItem(themeMenu)
        viewMenu.submenu = viewSubMenu
        mainMenu.addItem(viewMenu)

        NSApplication.shared.mainMenu = mainMenu
    }
}
