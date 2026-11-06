// 外部网络请求（模型接口、联网搜索、官方法规网站、拖进来的链接）：URLSession 发出，响应按数据块推回网页，
// 网页里拼成标准的 fetch Response（流式输出照常逐字显示）。
import Foundation

final class NetBridge: NSObject, URLSessionDataDelegate {
    private weak var bridge: Bridge?
    private lazy var session: URLSession = {
        let cfg = URLSessionConfiguration.default
        cfg.timeoutIntervalForRequest = 600
        cfg.timeoutIntervalForResource = 3600
        cfg.waitsForConnectivity = false
        cfg.requestCachePolicy = .reloadIgnoringLocalCacheData
        let q = OperationQueue()
        q.maxConcurrentOperationCount = 1 // 保证同一个请求的「响应头 → 数据 → 结束」按顺序推送
        return URLSession(configuration: cfg, delegate: self, delegateQueue: q)
    }()
    private var tasks: [Int: String] = [:]      // taskIdentifier -> 网页里的请求 id
    private var byId: [String: URLSessionTask] = [:]
    private let lock = NSLock()

    init(bridge: Bridge) { self.bridge = bridge }

    func start(_ a: [String: Any]) {
        guard let id = a["id"] as? String else { return }
        guard let s = a["url"] as? String, let url = URL(string: s) else { bridge?.emit("net:\(id)", ["type": "error", "message": "网址不对"]); return }
        var req = URLRequest(url: url)
        req.httpMethod = (a["method"] as? String) ?? "GET"
        for (k, v) in (a["headers"] as? [String: String]) ?? [:] { req.setValue(v, forHTTPHeaderField: k) }
        if let b = a["body"] as? String, let d = Data(base64Encoded: b) { req.httpBody = d }
        let t = session.dataTask(with: req)
        lock.lock(); tasks[t.taskIdentifier] = id; byId[id] = t; lock.unlock()
        t.resume()
    }

    /// 网页重新加载时：取消所有进行中的请求（旧页面的事件不能推给新页面）
    func cancelAll() {
        lock.lock(); let all = Array(byId.values); tasks.removeAll(); byId.removeAll(); lock.unlock()
        all.forEach { $0.cancel() }
    }

    func cancel(_ id: String) {
        lock.lock(); let t = byId[id]; lock.unlock()
        t?.cancel()
    }

    private func idOf(_ t: URLSessionTask) -> String? { lock.lock(); defer { lock.unlock() }; return tasks[t.taskIdentifier] }

    func urlSession(_ s: URLSession, dataTask: URLSessionDataTask, didReceive response: URLResponse, completionHandler: @escaping (URLSession.ResponseDisposition) -> Void) {
        if let id = idOf(dataTask), let r = response as? HTTPURLResponse {
            var h: [String: String] = [:]
            for (k, v) in r.allHeaderFields { if let k = k as? String { h[k.lowercased()] = "\(v)" } }
            // 网页按原始字节自己解码；URLSession 已经解压过，去掉压缩相关的头
            h.removeValue(forKey: "content-encoding"); h.removeValue(forKey: "content-length")
            bridge?.emit("net:\(id)", ["type": "head", "status": r.statusCode, "statusText": "", "headers": h]) // 本地化的状态文字可能是中文，fetch 的 Response 不接受
        }
        completionHandler(.allow)
    }

    func urlSession(_ s: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        if let id = idOf(dataTask) { bridge?.emit("net:\(id)", ["type": "data", "b64": data.base64EncodedString()]) }
    }

    func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = idOf(task) else { return }
        lock.lock(); tasks[task.taskIdentifier] = nil; byId[id] = nil; lock.unlock()
        if let e = error as NSError? {
            if e.code == NSURLErrorCancelled { return }
            bridge?.emit("net:\(id)", ["type": "error", "message": e.localizedDescription])
        } else {
            bridge?.emit("net:\(id)", ["type": "end"])
        }
    }
}

/// 实时转写用的 WebSocket（需要带 Authorization 请求头，网页里的 WebSocket 做不到）
final class WebSocketBridge: NSObject, URLSessionWebSocketDelegate {
    private weak var bridge: Bridge?
    private lazy var session: URLSession = {
        let q = OperationQueue()
        q.maxConcurrentOperationCount = 1 // 「打开 → 消息 → 关闭」按顺序推送
        return URLSession(configuration: .default, delegate: self, delegateQueue: q)
    }()
    private var closedIds = Set<String>()
    private var sockets: [String: URLSessionWebSocketTask] = [:]
    private var ids: [Int: String] = [:]
    private let lock = NSLock()

    init(bridge: Bridge) { self.bridge = bridge }

    func open(_ a: [String: Any]) {
        guard let id = a["id"] as? String, let s = a["url"] as? String, let url = URL(string: s) else { return }
        var req = URLRequest(url: url)
        for (k, v) in (a["headers"] as? [String: String]) ?? [:] { req.setValue(v, forHTTPHeaderField: k) }
        let t = session.webSocketTask(with: req)
        lock.lock(); sockets[id] = t; ids[t.taskIdentifier] = id; lock.unlock()
        t.resume()
        receive(id, t)
    }

    private func receive(_ id: String, _ t: URLSessionWebSocketTask) {
        t.receive { [weak self] r in
            guard let self else { return }
            switch r {
            case .success(.string(let s)): self.bridge?.emit("ws:\(id)", ["type": "message", "data": s]); self.receive(id, t)
            case .success(.data(let d)): self.bridge?.emit("ws:\(id)", ["type": "message", "data": String(data: d, encoding: .utf8) ?? ""]); self.receive(id, t)
            case .success: self.receive(id, t)
            case .failure(let e):
                // 服务器正常关闭时 receive 也会失败：那种情况交给 didCloseWith 报真实的关闭码
                self.lock.lock(); let closing = self.closedIds.contains(id) || t.closeCode != .invalid; self.lock.unlock()
                if closing { self.finish(id, code: t.closeCode == .invalid ? 1000 : t.closeCode.rawValue); return }
                self.bridge?.emit("ws:\(id)", ["type": "error", "message": e.localizedDescription])
                self.finish(id, code: 1006)
            }
        }
    }

    func closeAll() {
        lock.lock(); let all = Array(sockets.values); sockets.removeAll(); ids.removeAll(); lock.unlock()
        all.forEach { $0.cancel(with: .goingAway, reason: nil) }
    }

    func send(_ a: [String: Any]) {
        guard let id = a["id"] as? String, let data = a["data"] as? String else { return }
        lock.lock(); let t = sockets[id]; lock.unlock()
        t?.send(.string(data)) { _ in }
    }

    func close(_ id: String) {
        lock.lock(); let t = sockets[id]; closedIds.insert(id); lock.unlock()
        t?.cancel(with: .normalClosure, reason: nil)
        finish(id, code: 1000)
    }

    private func finish(_ id: String, code: Int) {
        lock.lock(); let t = sockets.removeValue(forKey: id); if let t { ids[t.taskIdentifier] = nil }; lock.unlock()
        if t != nil { bridge?.emit("ws:\(id)", ["type": "close", "code": code]) }
    }

    func urlSession(_ s: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol p: String?) {
        lock.lock(); let id = ids[webSocketTask.taskIdentifier]; lock.unlock()
        if let id { bridge?.emit("ws:\(id)", ["type": "open"]) }
    }

    func urlSession(_ s: URLSession, webSocketTask: URLSessionWebSocketTask, didCloseWith code: URLSessionWebSocketTask.CloseCode, reason: Data?) {
        lock.lock(); let id = ids[webSocketTask.taskIdentifier]; lock.unlock()
        if let id { finish(id, code: code.rawValue) }
    }
}
