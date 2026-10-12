// BlockMark — 文件监听（FSEventStream + 去抖：外部修改检测）
import CoreServices
import Foundation

final class DocumentFileWatcher {
    private var stream: FSEventStreamRef?
    private var infoPointer: UnsafeMutableRawPointer?
    private let watchedURL: URL
    private let onChange: () -> Void
    private var debounce: DispatchWorkItem?

    init(watch url: URL, onChange: @escaping () -> Void) {
        self.watchedURL = url
        self.onChange = onChange
    }

    deinit { stop() }

    func start() {
        guard stream == nil else { return }
        let pointer = Unmanaged.passRetained(self).toOpaque()
        infoPointer = pointer
        var context = FSEventStreamContext(
            version: 0, info: pointer,
            retain: nil, release: nil, copyDescription: nil)
        let flags = FSEventStreamCreateFlags(kFSEventStreamCreateFlagFileEvents)
                  | FSEventStreamCreateFlags(kFSEventStreamCreateFlagNoDefer)
        // 监听父目录（文件被替换/改名时事件仍落在目录上）
        let paths = [watchedURL.deletingLastPathComponent().path] as CFArray
        guard let s = FSEventStreamCreate(
            kCFAllocatorDefault,
            { _, clientInfo, _, _, _, _ in
                guard let clientInfo else { return }
                let watcher = Unmanaged<DocumentFileWatcher>.fromOpaque(clientInfo).takeUnretainedValue()
                watcher.signal()
            },
            &context, paths, FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            0.3, flags) else { return }
        stream = s
        FSEventStreamScheduleWithRunLoop(s, RunLoop.main.getCFRunLoop(), CFRunLoopMode.defaultMode.rawValue)
        FSEventStreamStart(s)
    }

    func stop() {
        if let s = stream {
            FSEventStreamStop(s)
            FSEventStreamInvalidate(s)
            FSEventStreamRelease(s)
            stream = nil
        }
        if let p = infoPointer {
            Unmanaged<DocumentFileWatcher>.fromOpaque(p).release()
            infoPointer = nil
        }
    }

    /// 事件到达：跳主队列 + 300ms 去抖
    fileprivate func signal() {
        DispatchQueue.main.async { [weak self] in
            guard let self else { return }
            self.debounce?.cancel()
            let work = DispatchWorkItem { [weak self] in self?.onChange() }
            self.debounce = work
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.3, execute: work)
        }
    }
}
