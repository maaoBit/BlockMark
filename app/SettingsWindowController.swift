// BlockMark — 设置窗口（程序化 NSPanel，无 nib：字号 / 主题 / 启动侧栏；改动即生效并持久化）
// 字号与捏合/⌘+− 共用 EditorWindowController.setFontSizeAll（单一事实源 UserDefaults）；
// 主题走既有 applyTheme 链路（写偏好 + 下发 CSS + 视图菜单勾选同步）。
import Cocoa

final class SettingsWindowController: NSObject {

    static let shared = SettingsWindowController()

    private var panel: NSPanel?
    private var fontSlider: NSSlider?
    private var fontValue: NSTextField?
    private var themePopup: NSPopUpButton?
    private var sidebarCheck: NSButton?

    @objc func showSettings(_ sender: Any?) {
        if panel == nil { buildPanel() }
        syncFromPrefs()
        panel?.center()
        panel?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
    }

    private func buildPanel() {
        let p = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 400, height: 176),
                        styleMask: [.titled, .closable, .miniaturizable],
                        backing: .buffered, defer: false)
        p.title = "设置"
        p.hidesOnDeactivate = false
        p.isReleasedWhenClosed = false   // 程序化 NSWindow 默认 close 即 release；单例持引用会悬垂 → 重开 ⌘, 僵尸崩溃
        let content = NSView(frame: NSRect(x: 0, y: 0, width: 400, height: 176))

        func label(_ text: String, _ x: CGFloat, _ y: CGFloat) -> NSTextField {
            let l = NSTextField(labelWithString: text)
            l.frame = NSRect(x: x, y: y, width: 80, height: 18)
            l.font = .systemFont(ofSize: 13)
            l.textColor = .secondaryLabelColor
            return l
        }

        // 行 1：字体大小（滑杆拖动即广播生效，10–32px）
        content.addSubview(label("字体大小", 20, 132))
        let slider = NSSlider(value: EditorWindowController.fontSizeDefault,
                              minValue: EditorWindowController.fontSizeMin,
                              maxValue: EditorWindowController.fontSizeMax,
                              target: self, action: #selector(fontSizeChanged(_:)))
        slider.frame = NSRect(x: 110, y: 128, width: 200, height: 24)
        slider.isContinuous = true
        content.addSubview(slider)
        fontSlider = slider
        let value = NSTextField(labelWithString: "16 px")
        value.frame = NSRect(x: 320, y: 132, width: 60, height: 18)
        value.font = .monospacedDigitSystemFont(ofSize: 13, weight: .regular)
        content.addSubview(value)
        fontValue = value

        // 行 2：主题（内置 + 用户主题目录，清单同视图菜单）
        content.addSubview(label("主题", 20, 88))
        let popup = NSPopUpButton(frame: NSRect(x: 110, y: 82, width: 200, height: 26))
        popup.addItems(withTitles: AppDelegate.themeList())
        popup.target = self
        popup.action = #selector(themeChanged(_:))
        content.addSubview(popup)
        themePopup = popup

        // 行 3：启动侧栏（既有偏好 key，EditorWindowController 启动时读取）
        let check = NSButton(checkboxWithTitle: "启动时打开侧栏", target: self,
                             action: #selector(sidebarChanged(_:)))
        check.frame = NSRect(x: 108, y: 40, width: 240, height: 20)
        content.addSubview(check)
        sidebarCheck = check

        p.contentView = content
        panel = p
    }

    /// 每次打开从偏好回填（外部改过字号/主题也同步）
    private func syncFromPrefs() {
        syncFontSize(EditorWindowController.currentFontSize())
        let theme = UserDefaults.standard.string(forKey: "BlockMark.theme") ?? "default"
        if let popup = themePopup {
            popup.selectItem(withTitle: theme)
            if popup.indexOfSelectedItem < 0 { popup.selectItem(withTitle: "default") }
        }
        sidebarCheck?.state = UserDefaults.standard.bool(forKey: "BlockMark.openSidebar") ? .on : .off
    }

    /// 字号在别处（捏合/⌘+/⌘-）变化时回填滑杆（程序设值不触发 action）
    func syncFontSize(_ v: Double) {
        fontSlider?.doubleValue = v
        // 捏合路径有 0.5px 步长值：整数显示整档，半步显示一位小数（不四舍五入误导）
        fontValue?.stringValue = v == v.rounded() ? "\(Int(v)) px" : String(format: "%.1f px", v)
    }

    @objc private func fontSizeChanged(_ sender: NSSlider) {
        EditorWindowController.setFontSizeAll(sender.doubleValue)
    }

    @objc private func themeChanged(_ sender: NSPopUpButton) {
        let name = sender.titleOfSelectedItem ?? "default"
        for wc in EditorWindowController.allEditorWindowControllers() { wc.applyTheme(name) }
        UserDefaults.standard.set(name, forKey: "BlockMark.theme")   // 无编辑器窗口时也要持久化
    }

    @objc private func sidebarChanged(_ sender: NSButton) {
        UserDefaults.standard.set(sender.state == .on, forKey: "BlockMark.openSidebar")
    }
}
