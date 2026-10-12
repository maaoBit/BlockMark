// BlockMark — 应用引导（无 nib，程序化构建；main.swift 顶层代码即入口）
import Cocoa

// 先于一切文档操作安装自定义文档控制器（shared 会返回首个创建的实例）
_ = MarkdownDocumentController()

let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
app.setActivationPolicy(.regular)
app.run()
