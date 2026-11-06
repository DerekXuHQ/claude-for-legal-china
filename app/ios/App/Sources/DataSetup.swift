// 第一次打开：下载法规数据包（约 110 MB）→ 校验 → 解压 → 在本机建全文索引（和桌面版 setup-worker 相同的步骤）。
// 全部在后台线程做，进度通过 setup 事件推给网页（界面上的「准备资料库」进度条）。
import Foundation
import CryptoKit
import UIKit

final class DataSetup: NSObject, URLSessionDownloadDelegate {
    private weak var bridge: Bridge?
    private var done: ((String?) -> Void)?
    private var expectSha = "", version = ""
    private var running = false
    private var bgTask: UIBackgroundTaskIdentifier = .invalid
    private lazy var session = URLSession(configuration: .default, delegate: self, delegateQueue: OperationQueue())

    private var legal: URL { Paths.data.appendingPathComponent("legal.db") }
    private var versionFile: URL { Paths.data.appendingPathComponent("legal.version") }

    init(bridge: Bridge) { self.bridge = bridge }

    func isReady() -> Bool { FileManager.default.fileExists(atPath: legal.path) && FileManager.default.fileExists(atPath: versionFile.path) }

    private func progress(_ phase: String, _ p: Double) { bridge?.emit("setup", ["phase": phase, "progress": p]) }

    func prepare(_ a: [String: Any], done: @escaping (String?) -> Void) {
        guard !running else { return done("正在准备中") }
        guard let s = a["url"] as? String, let url = URL(string: s) else { return done("数据包地址不对") }
        running = true
        self.done = done
        expectSha = (a["sha256"] as? String ?? "").lowercased()
        version = a["version"] as? String ?? ""
        DispatchQueue.main.async {
            self.bgTask = UIApplication.shared.beginBackgroundTask(withName: "setup") { [weak self] in
                guard let self else { return }
                UIApplication.shared.endBackgroundTask(self.bgTask); self.bgTask = .invalid
            }
        }
        progress("下载法规数据", 0.01)
        session.downloadTask(with: url).resume()
    }

    private func finish(_ err: String?) {
        running = false
        let cb = done; done = nil
        DispatchQueue.main.async {
            if self.bgTask != .invalid { UIApplication.shared.endBackgroundTask(self.bgTask); self.bgTask = .invalid }
            cb?(err)
        }
    }

    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didWriteData _: Int64, totalBytesWritten w: Int64, totalBytesExpectedToWrite t: Int64) {
        if t > 0 { progress("下载法规数据（\(w / 1_000_000) / \(t / 1_000_000) MB）", 0.3 * Double(w) / Double(t)) }
    }

    func urlSession(_ s: URLSession, downloadTask: URLSessionDownloadTask, didFinishDownloadingTo location: URL) {
        // 临时文件在这个回调返回后就会被删，先挪走
        let gz = Paths.data.appendingPathComponent("base.db.gz")
        try? FileManager.default.removeItem(at: gz)
        do { try FileManager.default.moveItem(at: location, to: gz) } catch { return finish("保存下载文件失败：\(error.localizedDescription)") }
        if let r = downloadTask.response as? HTTPURLResponse, r.statusCode != 200 { try? FileManager.default.removeItem(at: gz); return finish("下载失败（HTTP \(r.statusCode)）") }
        DispatchQueue.global(qos: .userInitiated).async { self.build(gz) }
    }

    func urlSession(_ s: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        if let error { finish("下载失败：\(error.localizedDescription)") }
    }

    private func build(_ gz: URL) {
        let part = Paths.data.appendingPathComponent("legal.db.part")
        defer { try? FileManager.default.removeItem(at: gz) }
        do {
            progress("校验数据包", 0.31)
            if !expectSha.isEmpty {
                let got = try sha256(gz)
                if got != expectSha { throw BridgeError("数据包校验不通过，请重试（可能下载不完整）") }
            }
            for ext in ["", "-wal", "-shm", "-journal"] { try? FileManager.default.removeItem(at: URL(fileURLWithPath: part.path + ext)) }
            try gunzip(gz, to: part)
            Paths.excludeFromBackup(part)

            let db = try SQLiteDB(path: part.path, readOnly: false)
            try db.exec("PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; PRAGMA temp_store=FILE; PRAGMA cache_size=-65536;")
            try db.exec("""
                CREATE VIRTUAL TABLE IF NOT EXISTS articles_fts USING fts5(title, text, content='articles', content_rowid='rowid', tokenize='trigram');
                CREATE VIRTUAL TABLE IF NOT EXISTS cases_fts USING fts5(title, keywords, points, laws, text, content='cases', content_rowid='rowid', tokenize='trigram');
                CREATE VIRTUAL TABLE IF NOT EXISTS refs_fts USING fts5(title, heading, text, content='refs', content_rowid='rowid', tokenize='trigram');
                """)
            let maxRow = ((try db.get("SELECT max(rowid) m FROM articles", [:]) as? [String: Any])?["m"] as? Int64) ?? 0
            let batch: Int64 = 20000
            var lo: Int64 = 0
            while lo < maxRow {
                try db.exec("BEGIN")
                _ = try db.run("INSERT INTO articles_fts(rowid, title, text) SELECT rowid, title, text FROM articles WHERE rowid > ? AND rowid <= ?", ["positional": [lo, lo + batch]])
                try db.exec("COMMIT")
                lo += batch
                progress("建立全文索引（第一次打开需要几分钟，请保持 App 在前台）", 0.45 + 0.45 * min(1, Double(lo) / Double(max(maxRow, 1))))
            }
            progress("建立案例和实务资料索引", 0.92)
            try db.exec("INSERT INTO cases_fts(cases_fts) VALUES('rebuild'); INSERT INTO refs_fts(refs_fts) VALUES('rebuild');")
            if !version.isEmpty {
                _ = try db.run("INSERT INTO meta(key, value) VALUES('data_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", ["positional": [version]])
            }
            try db.exec("PRAGMA optimize;")
            db.close()
            let db2 = try SQLiteDB(path: part.path, readOnly: false)
            try db2.exec("PRAGMA journal_mode=WAL;")
            db2.close()

            for ext in ["", "-wal", "-shm"] { try? FileManager.default.removeItem(at: URL(fileURLWithPath: legal.path + ext)) }
            try FileManager.default.moveItem(at: part, to: legal)
            for ext in ["-wal", "-shm"] {
                let p = URL(fileURLWithPath: part.path + ext)
                if FileManager.default.fileExists(atPath: p.path) { try? FileManager.default.moveItem(at: p, to: URL(fileURLWithPath: legal.path + ext)) }
            }
            Paths.excludeFromBackup(legal)
            try version.write(to: versionFile, atomically: true, encoding: .utf8)
            progress("完成", 1)
            finish(nil)
        } catch {
            try? FileManager.default.removeItem(at: part)
            finish(String(describing: error))
        }
    }

    private func sha256(_ url: URL) throws -> String {
        let h = try FileHandle(forReadingFrom: url)
        defer { try? h.close() }
        var hasher = SHA256()
        while let d = try h.read(upToCount: 4 << 20), !d.isEmpty { hasher.update(data: d) }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private func gunzip(_ src: URL, to dst: URL) throws {
        let total = Double((try? FileManager.default.attributesOfItem(atPath: src.path)[.size] as? NSNumber)?.doubleValue ?? 1)
        let input = try FileHandle(forReadingFrom: src)
        defer { try? input.close() }
        FileManager.default.createFile(atPath: dst.path, contents: nil)
        let output = try FileHandle(forWritingTo: dst)
        defer { try? output.close() }

        var strm = z_stream()
        guard inflateInit2_(&strm, 15 + 16, zlibVersion(), Int32(MemoryLayout<z_stream>.size)) == Z_OK else { throw BridgeError("解压初始化失败") }
        defer { inflateEnd(&strm) }
        let outSize = 1 << 20
        let outBuf = UnsafeMutablePointer<UInt8>.allocate(capacity: outSize)
        defer { outBuf.deallocate() }
        var read = 0.0
        var finished = false
        while !finished, let chunk = try input.read(upToCount: 1 << 20), !chunk.isEmpty {
            read += Double(chunk.count)
            try chunk.withUnsafeBytes { (raw: UnsafeRawBufferPointer) in
                strm.next_in = UnsafeMutablePointer(mutating: raw.bindMemory(to: UInt8.self).baseAddress)
                strm.avail_in = uInt(chunk.count)
                repeat {
                    strm.next_out = outBuf
                    strm.avail_out = uInt(outSize)
                    let rc = inflate(&strm, Z_NO_FLUSH)
                    if rc != Z_OK && rc != Z_STREAM_END { throw BridgeError("解压失败（\(rc)）") }
                    let n = outSize - Int(strm.avail_out)
                    if n > 0 { output.write(Data(bytes: outBuf, count: n)) }
                    if rc == Z_STREAM_END { finished = true; break }
                } while strm.avail_out == 0
            }
            progress("解压法规数据", 0.31 + 0.14 * read / total)
        }
        if !finished { throw BridgeError("数据包不完整") }
    }
}
