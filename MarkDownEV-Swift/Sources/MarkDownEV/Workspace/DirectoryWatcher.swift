import CoreServices
import Foundation

/// Recursively watches a directory tree with FSEvents and reports changed directories.
final class DirectoryWatcher {
    private final class Handler {
        let onChange: @Sendable ([String]) -> Void

        init(_ onChange: @escaping @Sendable ([String]) -> Void) {
            self.onChange = onChange
        }
    }

    private let handler: Handler
    private var stream: FSEventStreamRef?

    init(url: URL, latency: TimeInterval = 0.3, onChange: @escaping @Sendable ([String]) -> Void) {
        handler = Handler(onChange)
        var context = FSEventStreamContext(
            version: 0,
            info: Unmanaged.passUnretained(handler).toOpaque(),
            retain: nil,
            release: nil,
            copyDescription: nil
        )
        let callback: FSEventStreamCallback = { _, info, _, paths, _, _ in
            guard let info else { return }
            let handler = Unmanaged<Handler>.fromOpaque(info).takeUnretainedValue()
            let changed = unsafeBitCast(paths, to: NSArray.self) as? [String] ?? []
            handler.onChange(changed)
        }
        let flags = FSEventStreamCreateFlags(kFSEventStreamCreateFlagUseCFTypes | kFSEventStreamCreateFlagNoDefer)
        stream = FSEventStreamCreate(
            nil,
            callback,
            &context,
            [url.path] as CFArray,
            FSEventStreamEventId(kFSEventStreamEventIdSinceNow),
            latency,
            flags
        )
        if let stream {
            FSEventStreamSetDispatchQueue(stream, .main)
            FSEventStreamStart(stream)
        }
    }

    deinit {
        guard let stream else { return }
        FSEventStreamStop(stream)
        FSEventStreamInvalidate(stream)
        FSEventStreamRelease(stream)
    }
}
