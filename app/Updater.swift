// BlockMark — 自动更新（GitHub Releases）
// 流程：GET /releases/latest → 版本对比 → 下载 zip → 解压 → 就地替换 .app → 重启。
// 零第三方依赖（与薄壳架构一致）；更新包经 HTTPS 固定 api.github.com 域。
import Cocoa

enum UpdateError: LocalizedError {
    case network(String)
    case parse
    case assetNotFound
    case badArchive
    case replaceFailed(String)

    var errorDescription: String? {
        switch self {
        case .network(let s): return "网络错误：\(s)"
        case .parse: return "发布信息解析失败"
        case .assetNotFound: return "Release 中未找到 BlockMark zip"
        case .badArchive: return "更新包解压失败"
        case .replaceFailed(let s): return "替换应用失败：\(s)"
        }
    }
}

final class Updater: NSObject {
    static let shared = Updater()

    private let repo = "maaoBit/BlockMark"
    private let apiBase = "https://api.github.com"
    /// 下载域（跳转后的实际资产域）；URLSession 默认跟随重定向
    private let session: URLSession = {
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 30
        cfg.httpAdditionalHeaders = ["User-Agent": "BlockMark-Updater",
                                     "Accept": "application/vnd.github+json"]
        return URLSession(configuration: cfg)
    }()

    private var busy = false

    var currentVersion: String {
        Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "0"
    }

    // MARK: - 公共入口

    /// 启动后的静默检查（24h 一次）
    func scheduleBackgroundCheck() {
        let last = UserDefaults.standard.double(forKey: "BlockMark.lastUpdateCheck")
        guard Date().timeIntervalSince1970 - last > 24 * 3600 else { return }
        DispatchQueue.main.asyncAfter(deadline: .now() + 3) { [weak self] in
            self?.check(interactive: false)
        }
    }

    /// 菜单"检查更新…"
    @objc func checkNow() { check(interactive: true) }

    private func check(interactive: Bool) {
        guard !busy else { return }
        busy = true
        UserDefaults.standard.set(Date().timeIntervalSince1970, forKey: "BlockMark.lastUpdateCheck")
        fetchLatest { [weak self] result in
            DispatchQueue.main.async {
                self?.handleCheckResult(result, interactive: interactive)
            }
        }
    }

    private func handleCheckResult(_ result: Result<Latest, UpdateError>, interactive: Bool) {
        busy = false
        switch result {
        case .failure(let err):
            if interactive { alert(.informational, "检查更新失败", err.localizedDescription) }
        case .success(let latest):
            let remote = latest.tag.hasPrefix("v") ? String(latest.tag.dropFirst()) : latest.tag
            if Self.version(remote, isNewerThan: currentVersion) {
                offerUpdate(version: remote, notes: latest.notes, zipURL: latest.zipURL)
            } else if interactive {
                alert(.informational, "已是最新版本",
                      "BlockMark \(currentVersion) 是当前最新发布。")
            }
        }
    }

    // MARK: - GitHub API

    private struct Latest {
        let tag: String
        let notes: String
        let zipURL: URL
    }

    private func fetchLatest(_ done: @escaping (Result<Latest, UpdateError>) -> Void) {
        let url = URL(string: "\(apiBase)/repos/\(repo)/releases/latest")!
        session.dataTask(with: url) { data, resp, err in
            if let err { return done(.failure(.network(err.localizedDescription))) }
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200,
                  let data,
                  let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let tag = obj["tag_name"] as? String else {
                return done(.failure(.parse))
            }
            let notes = obj["body"] as? String ?? ""
            guard let assets = obj["assets"] as? [[String: Any]],
                  let asset = assets.first(where: { ($0["name"] as? String ?? "").hasSuffix(".zip") }),
                  let link = asset["browser_download_url"] as? String,
                  let zipURL = URL(string: link) else {
                return done(.failure(.assetNotFound))
            }
            done(.success(.init(tag: tag, notes: notes, zipURL: zipURL)))
        }.resume()
    }

    /// 语义化版本比较（仅数字段，忽略预发布后缀）
    static func version(_ a: String, isNewerThan b: String) -> Bool {
        func parts(_ s: String) -> [Int] {
            let base = s.split(separator: "-").first.map(String.init) ?? s
            return base.split(separator: ".").compactMap { Int($0.filter(\.isNumber)) }
        }
        let pa = parts(a), pb = parts(b)
        for i in 0..<max(pa.count, pb.count) {
            let x = i < pa.count ? pa[i] : 0
            let y = i < pb.count ? pb[i] : 0
            if x != y { return x > y }
        }
        return false
    }

    // MARK: - 下载与替换

    private func offerUpdate(version: String, notes: String, zipURL: URL) {
        DispatchQueue.main.async {
            let alert = NSAlert()
            alert.alertStyle = .informational
            alert.messageText = "发现新版本 \(version)（当前 \(self.currentVersion)）"
            let brief = notes.split(separator: "\n").prefix(6).joined(separator: "\n")
            alert.informativeText = String(brief)
            alert.addButton(withTitle: "立即更新")
            alert.addButton(withTitle: "暂不")
            if alert.runModal() == .alertFirstButtonReturn {
                self.downloadAndReplace(zipURL, version: version)
            }
        }
    }

    private func downloadAndReplace(_ zipURL: URL, version: String) {
        busy = true
        // 进度窗（下载+替换通常数秒）
        let progress = NSPanel(contentRect: NSRect(x: 0, y: 0, width: 320, height: 120),
                               styleMask: [.titled], backing: .buffered, defer: false)
        progress.title = "正在更新到 \(version)"
        progress.isFloatingPanel = true
        let text = NSTextField(labelWithString: "下载更新包…")
        text.frame = NSRect(x: 20, y: 48, width: 280, height: 24)
        let ind = NSProgressIndicator()
        ind.style = .spinning
        ind.isIndeterminate = true
        ind.startAnimation(nil)
        ind.frame = NSRect(x: 140, y: 10, width: 32, height: 32)
        progress.contentView?.subviews = [text, ind]
        progress.center()
        DispatchQueue.main.async { progress.makeKeyAndOrderFront(nil) }

        session.downloadTask(with: zipURL) { [weak self] tmp, resp, err in
            let finish: (String) -> Void = { msg in
                DispatchQueue.main.async {
                    progress.orderOut(nil)
                    NSApp.activate(ignoringOtherApps: true)
                    self?.alert(.informational, "更新", msg)
                }
            }
            guard let self else { return }
            self.busy = false
            if let err { return finish("下载失败：\(err.localizedDescription)") }
            guard let http = resp as? HTTPURLResponse, http.statusCode == 200, let tmp else {
                return finish("下载失败（HTTP \((resp as? HTTPURLResponse)?.statusCode ?? -1)）")
            }
            do {
                try self.install(from: tmp)
                // 重启生效
                DispatchQueue.main.async {
                    progress.orderOut(nil)
                    let alert = NSAlert()
                    alert.messageText = "已更新到 \(version)"
                    alert.informativeText = "需要重启 BlockMark 生效。"
                    alert.addButton(withTitle: "立即重启")
                    alert.addButton(withTitle: "稍后手动重启")
                    if alert.runModal() == .alertFirstButtonReturn { self.relaunch() }
                }
            } catch {
                finish("安装失败：\(error.localizedDescription)")
            }
        }.resume()
    }

    /// 解压 zip → 临时目录；把新 .app 与当前 .app 原子对调（旧的挪去备份）
    private func install(from zip: URL) throws {
        let fm = FileManager.default
        let workDir = fm.temporaryDirectory
            .appendingPathComponent("blockmark-update-\(UUID().uuidString)", isDirectory: true)
        try fm.createDirectory(at: workDir, withIntermediateDirectories: true)

        let zipDst = workDir.appendingPathComponent("update.zip")
        try? fm.removeItem(at: zipDst)
        try fm.moveItem(at: zip, to: zipDst)

        let proc = Process()
        proc.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        proc.arguments = ["-x", "-k", zipDst.path, workDir.path]
        try proc.run()
        proc.waitUntilExit()
        guard proc.terminationStatus == 0 else { throw UpdateError.badArchive }

        guard let newApp = try fm.contentsOfDirectory(at: workDir, includingPropertiesForKeys: nil)
            .first(where: { $0.pathExtension == "app" }) else {
            throw UpdateError.badArchive
        }

        let curApp = Bundle.main.bundleURL
        // 校验新包身份（防止装错东西）
        let newName = newApp.appendingPathComponent("Contents/Info.plist")
        guard let info = NSDictionary(contentsOf: newName),
              (info["CFBundleIdentifier"] as? String) == (Bundle.main.bundleIdentifier) else {
            throw UpdateError.replaceFailed("更新包身份校验失败")
        }
        guard fm.isWritableFile(atPath: curApp.deletingLastPathComponent().path) else {
            throw UpdateError.replaceFailed("应用所在目录不可写，请手动下载替换")
        }

        let backup = fm.temporaryDirectory
            .appendingPathComponent("blockmark-old-\(Int(Date().timeIntervalSince1970)).app")
        try? fm.removeItem(at: backup)
        try fm.moveItem(at: curApp, to: backup)      // 旧包挪走（运行中进程不受影响，inode 仍有效）
        do {
            try fm.moveItem(at: newApp, to: curApp)   // 新包就位
        } catch {
            try? fm.moveItem(at: backup, to: curApp)  // 回滚
            throw UpdateError.replaceFailed("无法写入新版本（\(error.localizedDescription)）")
        }
    }

    private func relaunch() {
        // 冲刷未保存内容再走
        for case let doc as MarkdownDocument in NSDocumentController.shared.documents {
            doc.flushAutosave()
        }
        // 经典 Relauncher 模式：spawn 独立 shell（不受本进程退出影响），延时 open 新 app
        // （NSWorkspace.openApplication + terminate 组合在替换场景下启动竞态，实测新进程不起）
        let appPath = Bundle.main.bundleURL.path
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/sh")
        p.arguments = ["-c", "sleep 1; open -a '" + appPath + "'"]
        try? p.run()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { NSApp.terminate(nil) }
    }

    private func alert(_ style: NSAlert.Style, _ title: String, _ text: String) {
        let a = NSAlert()
        a.alertStyle = style
        a.messageText = title
        a.informativeText = text
        a.runModal()
    }
}
