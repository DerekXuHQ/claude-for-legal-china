// 原生 SQLite（App 自带 3.54，启用 FTS5，法规库的全文索引用 trigram 分词）。
// 网页里的 node:sqlite 替身（ios/web-src/shims/sqlite.mjs）通过同步桥调用这里。
import Foundation

let SQLITE_TRANSIENT = unsafeBitCast(-1, to: sqlite3_destructor_type.self)

struct BridgeError: Error, CustomStringConvertible {
    let description: String
    init(_ s: String) { description = s }
}

enum Paths {
    /// 用户数据目录：Documents/data（JS 里写作 /data）
    static let data: URL = {
        let u = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("data", isDirectory: true)
        try? FileManager.default.createDirectory(at: u, withIntermediateDirectories: true)
        return u
    }()

    /// 把 JS 里的 /data/... 换成真实路径；不允许访问别处
    static func real(_ p: String) throws -> URL {
        guard p == "/data" || p.hasPrefix("/data/") else { throw BridgeError("只能访问 /data 下的文件：\(p)") }
        let rel = p.dropFirst(5).split(separator: "/").map(String.init)
        if rel.contains("..") || rel.contains(".") { throw BridgeError("路径不合法：\(p)") }
        return rel.reduce(data) { $0.appendingPathComponent($1) }
    }

    /// 能重新下载的大文件不进 iCloud 备份（App Store 审核要求）
    static func excludeFromBackup(_ url: URL) {
        var u = url
        var v = URLResourceValues()
        v.isExcludedFromBackup = true
        try? u.setResourceValues(v)
    }
}

final class SQLiteDB {
    let handle: OpaquePointer
    private var cache: [String: OpaquePointer] = [:]

    init(path: String, readOnly: Bool) throws {
        var db: OpaquePointer?
        let flags = readOnly ? SQLITE_OPEN_READONLY : (SQLITE_OPEN_READWRITE | SQLITE_OPEN_CREATE)
        let rc = sqlite3_open_v2(path, &db, flags | SQLITE_OPEN_NOMUTEX, nil)
        guard rc == SQLITE_OK, let db else {
            let msg = db.map { String(cString: sqlite3_errmsg($0)) } ?? "无法打开数据库"
            if let db { sqlite3_close(db) }
            throw BridgeError("打开数据库失败：\(msg)")
        }
        handle = db
        sqlite3_busy_timeout(db, 10000)
    }

    deinit { close() }

    func close() {
        for (_, s) in cache { sqlite3_finalize(s) }
        cache.removeAll()
        sqlite3_close_v2(handle)
    }

    private func error() -> BridgeError { BridgeError(String(cString: sqlite3_errmsg(handle))) }

    func exec(_ sql: String) throws {
        var err: UnsafeMutablePointer<CChar>?
        if sqlite3_exec(handle, sql, nil, nil, &err) != SQLITE_OK {
            let msg = err.map { String(cString: $0) } ?? "执行失败"
            sqlite3_free(err)
            throw BridgeError(msg)
        }
    }

    private func statement(_ sql: String) throws -> OpaquePointer {
        if let s = cache[sql] { sqlite3_reset(s); sqlite3_clear_bindings(s); return s }
        var s: OpaquePointer?
        guard sqlite3_prepare_v2(handle, sql, -1, &s, nil) == SQLITE_OK, let s else { throw error() }
        if cache.count > 300 { for (_, x) in cache { sqlite3_finalize(x) }; cache.removeAll() }
        cache[sql] = s
        return s
    }

    private func bindValue(_ s: OpaquePointer, _ i: Int32, _ v: Any?) throws {
        switch v {
        case nil, is NSNull: sqlite3_bind_null(s, i)
        case let n as NSNumber:
            if CFGetTypeID(n) == CFBooleanGetTypeID() { sqlite3_bind_int64(s, i, n.boolValue ? 1 : 0) }
            else if CFNumberIsFloatType(n) { let d = n.doubleValue; if d == d.rounded() && abs(d) < 9e15 { sqlite3_bind_int64(s, i, Int64(d)) } else { sqlite3_bind_double(s, i, d) } }
            else { sqlite3_bind_int64(s, i, n.int64Value) }
        case let str as String: sqlite3_bind_text(s, i, str, -1, SQLITE_TRANSIENT)
        case let d as [String: Any]:
            guard let b64 = d["$b64"] as? String, let data = Data(base64Encoded: b64) else { throw BridgeError("不支持的参数") }
            _ = data.withUnsafeBytes { sqlite3_bind_blob(s, i, $0.baseAddress, Int32(data.count), SQLITE_TRANSIENT) }
        default: throw BridgeError("不支持的参数类型")
        }
    }

    private func bind(_ s: OpaquePointer, _ args: [String: Any]) throws {
        if let named = args["named"] as? [String: Any] {
            for (k, v) in named {
                let idx = sqlite3_bind_parameter_index(s, k)
                if idx > 0 { try bindValue(s, idx, v) }
            }
        } else if let pos = args["positional"] as? [Any] {
            for (i, v) in pos.enumerated() { try bindValue(s, Int32(i + 1), v) }
        }
    }

    private func row(_ s: OpaquePointer) -> [String: Any] {
        var r: [String: Any] = [:]
        for c in 0..<sqlite3_column_count(s) {
            let name = String(cString: sqlite3_column_name(s, c))
            switch sqlite3_column_type(s, c) {
            case SQLITE_INTEGER: r[name] = sqlite3_column_int64(s, c)
            case SQLITE_FLOAT: r[name] = sqlite3_column_double(s, c)
            case SQLITE_TEXT: r[name] = String(cString: sqlite3_column_text(s, c))
            case SQLITE_BLOB:
                let n = Int(sqlite3_column_bytes(s, c))
                let data = n > 0 ? Data(bytes: sqlite3_column_blob(s, c), count: n) : Data()
                r[name] = ["$b64": data.base64EncodedString()]
            default: r[name] = NSNull()
            }
        }
        return r
    }

    func all(_ sql: String, _ args: [String: Any]) throws -> [[String: Any]] {
        let s = try statement(sql)
        defer { sqlite3_reset(s) }
        try bind(s, args)
        var rows: [[String: Any]] = []
        while true {
            let rc = sqlite3_step(s)
            if rc == SQLITE_ROW { rows.append(row(s)) } else if rc == SQLITE_DONE { break } else { throw error() }
        }
        return rows
    }

    func get(_ sql: String, _ args: [String: Any]) throws -> Any {
        let s = try statement(sql)
        defer { sqlite3_reset(s) }
        try bind(s, args)
        let rc = sqlite3_step(s)
        if rc == SQLITE_ROW { return row(s) }
        if rc == SQLITE_DONE { return NSNull() }
        throw error()
    }

    func run(_ sql: String, _ args: [String: Any]) throws -> [String: Any] {
        let s = try statement(sql)
        defer { sqlite3_reset(s) }
        try bind(s, args)
        while true {
            let rc = sqlite3_step(s)
            if rc == SQLITE_DONE { break }
            if rc != SQLITE_ROW { throw error() }
        }
        return ["changes": sqlite3_changes(handle), "lastInsertRowid": sqlite3_last_insert_rowid(handle)]
    }
}
