// 网页 <-> 原生的接口。和 ios/dev/mock-native.mjs（浏览器里的模拟实现）一一对应。
// 同步：window.prompt("__native__{op,args}")，在 WKUIDelegate 里立即返回 {"value":…} 或 {"error":…}。
// 异步：webkit.messageHandlers.native.postMessage({id,op,args})，做完后 window.__native.resolve(id, value, error)；
//       过程中的数据（网络数据块、WebSocket 消息、准备进度）用 window.__native.emit(event, data) 推送。
import Foundation
import WebKit
import CryptoKit
import UserNotifications

final class Bridge: NSObject, WKScriptMessageHandler {
    weak var webView: WKWebView?
    private var dbs: [Int: SQLiteDB] = [:]
    private var dbSeq = 0
    lazy var net = NetBridge(bridge: self)
    lazy var ws = WebSocketBridge(bridge: self)
    lazy var setup = DataSetup(bridge: self)
    lazy var speech = SpeechBridge(bridge: self)

    // MARK: 推送给网页

    func js(_ code: String) {
        DispatchQueue.main.async { self.webView?.evaluateJavaScript(code, completionHandler: nil) }
    }

    static func json(_ v: Any?) -> String {
        guard let v, !(v is NSNull) else { return "null" }
        if let s = v as? String, let d = try? JSONSerialization.data(withJSONObject: [s], options: [.fragmentsAllowed]), let t = String(data: d, encoding: .utf8) {
            return String(t.dropFirst().dropLast())
        }
        if JSONSerialization.isValidJSONObject(v), let d = try? JSONSerialization.data(withJSONObject: v), let t = String(data: d, encoding: .utf8) { return t }
        if let d = try? JSONSerialization.data(withJSONObject: v, options: [.fragmentsAllowed]), let t = String(data: d, encoding: .utf8) { return t }
        return "null"
    }

    func emit(_ event: String, _ data: Any) { js("window.__native&&window.__native.emit(\(Bridge.json(event)),\(Bridge.json(data)))") }
    func resolve(_ id: Any, _ value: Any?) { js("window.__native&&window.__native.resolve(\(Bridge.json(id)),\(Bridge.json(value)),null)") }
    func reject(_ id: Any, _ err: String) { js("window.__native&&window.__native.resolve(\(Bridge.json(id)),null,\(Bridge.json(err)))") }

    // MARK: 同步接口

    func sync(_ payload: String) -> String {
        do {
            guard let d = payload.data(using: .utf8), let m = try JSONSerialization.jsonObject(with: d) as? [String: Any], let op = m["op"] as? String else { throw BridgeError("请求格式不对") }
            let a = m["args"] as? [String: Any] ?? [:]
            let v = try syncOp(op, a)
            return "{\"value\":\(Bridge.json(v))}"
        } catch {
            return "{\"error\":\(Bridge.json(String(describing: error)))}"
        }
    }

    private func str(_ a: [String: Any], _ k: String) throws -> String {
        guard let s = a[k] as? String else { throw BridgeError("缺少参数 \(k)") }
        return s
    }
    private func db(_ a: [String: Any]) throws -> SQLiteDB {
        guard let h = (a["db"] as? NSNumber)?.intValue, let d = dbs[h] else { throw BridgeError("数据库没有打开") }
        return d
    }

    private func syncOp(_ op: String, _ a: [String: Any]) throws -> Any? {
        let fm = FileManager.default
        switch op {
        case "app.info":
            let i = Bundle.main.infoDictionary ?? [:]
            return ["version": i["CFBundleShortVersionString"] ?? "", "build": i["CFBundleVersion"] ?? ""]
        case "setup.status":
            return ["ready": setup.isReady()]
        case "fs.exists":
            return fm.fileExists(atPath: try Paths.real(str(a, "path")).path)
        case "fs.read":
            let u = try Paths.real(str(a, "path"))
            guard let d = fm.contents(atPath: u.path) else { throw BridgeError("ENOENT: \(try str(a, "path"))") }
            return d.base64EncodedString()
        case "fs.write":
            let u = try Paths.real(str(a, "path"))
            try fm.createDirectory(at: u.deletingLastPathComponent(), withIntermediateDirectories: true)
            guard let d = Data(base64Encoded: try str(a, "data")) else { throw BridgeError("数据格式不对") }
            try d.write(to: u, options: .atomic)
            return true
        case "fs.readdir":
            return try fm.contentsOfDirectory(atPath: try Paths.real(str(a, "path")).path).sorted()
        case "fs.stat":
            let u = try Paths.real(str(a, "path"))
            guard let at = try? fm.attributesOfItem(atPath: u.path) else { return NSNull() }
            return ["size": (at[.size] as? NSNumber)?.int64Value ?? 0, "dir": (at[.type] as? FileAttributeType) == .typeDirectory,
                    "mtime": (at[.modificationDate] as? Date)?.timeIntervalSince1970 ?? 0]
        case "fs.mkdir":
            try fm.createDirectory(at: try Paths.real(str(a, "path")), withIntermediateDirectories: true)
            return true
        case "fs.rm":
            let u = try Paths.real(str(a, "path"))
            if fm.fileExists(atPath: u.path) { try fm.removeItem(at: u) }
            return true
        case "fs.rename":
            let from = try Paths.real(str(a, "from")), to = try Paths.real(str(a, "to"))
            if fm.fileExists(atPath: to.path) { try fm.removeItem(at: to) }
            try fm.moveItem(at: from, to: to)
            return true
        case "crypto.hash":
            guard let d = Data(base64Encoded: try str(a, "data")) else { throw BridgeError("数据格式不对") }
            let alg = try str(a, "alg")
            let hex: (any Sequence<UInt8>) -> String = { $0.map { String(format: "%02x", $0) }.joined() }
            switch alg {
            case "sha1": return hex(Insecure.SHA1.hash(data: d))
            case "md5": return hex(Insecure.MD5.hash(data: d))
            case "sha256": return hex(SHA256.hash(data: d))
            default: throw BridgeError("不支持的摘要算法 \(alg)")
            }
        case "sqlite.open":
            let u = try Paths.real(str(a, "path"))
            let d = try SQLiteDB(path: u.path, readOnly: (a["readOnly"] as? Bool) ?? false)
            dbSeq += 1
            dbs[dbSeq] = d
            if u.lastPathComponent.hasPrefix("legal.db") { Paths.excludeFromBackup(u) }
            return dbSeq
        case "sqlite.all": return try db(a).all(try str(a, "sql"), a)
        case "sqlite.get": return try db(a).get(try str(a, "sql"), a)
        case "sqlite.run": return try db(a).run(try str(a, "sql"), a)
        case "sqlite.exec": try db(a).exec(try str(a, "sql")); return true
        case "sqlite.close":
            if let h = (a["db"] as? NSNumber)?.intValue { dbs[h]?.close(); dbs[h] = nil }
            return true
        default:
            throw BridgeError("未知的同步接口：\(op)")
        }
    }

    // MARK: 异步接口

    func userContentController(_ uc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let m = message.body as? [String: Any], let id = m["id"], let op = m["op"] as? String else { return }
        let a = m["args"] as? [String: Any] ?? [:]
        switch op {
        case "net.fetch": net.start(a); resolve(id, true)
        case "net.cancel": net.cancel(a["id"] as? String ?? ""); resolve(id, true)
        case "ws.open": ws.open(a); resolve(id, true)
        case "ws.send": ws.send(a); resolve(id, true)
        case "ws.close": ws.close(a["id"] as? String ?? ""); resolve(id, true)
        case "setup.prepare": setup.prepare(a) { [weak self] err in if let err { self?.reject(id, err) } else { self?.resolve(id, true) } }
        case "ocr.image":
            Media.ocr(base64: a["data"] as? String ?? "") { [weak self] r in
                switch r { case .success(let t): self?.resolve(id, t); case .failure(let e): self?.reject(id, String(describing: e)) }
            }
        case "image.toJpeg":
            Media.toJpeg(base64: a["data"] as? String ?? "") { [weak self] r in
                switch r { case .success(let t): self?.resolve(id, t); case .failure(let e): self?.reject(id, String(describing: e)) }
            }
        case "audio.toWav":
            Media.toWav(base64: a["data"] as? String ?? "", ext: a["ext"] as? String ?? "m4a", rate: (a["rate"] as? NSNumber)?.doubleValue ?? 24000) { [weak self] r in
                switch r { case .success(let t): self?.resolve(id, t); case .failure(let e): self?.reject(id, String(describing: e)) }
            }
        case "speech.start": speech.start { [weak self] err in if let err { self?.reject(id, err) } else { self?.resolve(id, true) } }
        case "speech.stop": speech.stop(final: true); resolve(id, true)
        case "speech.cancel": speech.stop(final: false); resolve(id, true)
        case "notify":
            Notifier.post(title: a["title"] as? String ?? "", body: a["body"] as? String ?? "", runId: a["runId"] as? String ?? "")
            resolve(id, true)
        default:
            reject(id, "未知的接口：\(op)")
        }
    }
}

/// 定时 Agent 的报告提醒
enum Notifier {
    static func post(title: String, body: String, runId: String) {
        let c = UNUserNotificationCenter.current()
        c.requestAuthorization(options: [.alert, .sound, .badge]) { ok, _ in
            guard ok else { return }
            let content = UNMutableNotificationContent()
            content.title = title
            content.body = body
            content.sound = .default
            content.userInfo = ["runId": runId]
            c.add(UNNotificationRequest(identifier: "run-\(runId)", content: content, trigger: nil))
        }
    }
}
