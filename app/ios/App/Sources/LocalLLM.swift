// 本机小模型（离线）：Qwen3-0.6B 4bit（MLX，约 350 MB；2026-11-14 在 Mac 上对比过 Qwen2.5-0.5B，后者常答非所问）。
// 模型文件从账号服务下载（Hugging Face 在国内连不上），逐个文件按 8 MB 分段断点续传，每个文件校验 sha256。
// 网页那边：server/ai/local.mjs 先在本机法规库检索条文，再调 llm.generate 让小模型据此作答。
// 模拟器没有可用的 Metal GPU，MLX 会崩溃，所以模拟器上报告「不支持」。
import Foundation
import CryptoKit
import UIKit
#if !targetEnvironment(simulator)
import MLXLLM
import MLXLMCommon
#endif

struct LocalModelManifest: Codable, Equatable {
    struct File: Codable, Equatable { let name: String; let size: Int64; let sha256: String }
    let name: String
    let version: String
    let size: Int64
    let files: [File]
}

@MainActor
final class LocalLLM {
    static let shared = LocalLLM()
    weak var bridge: Bridge?

    static var supported: Bool {
        #if targetEnvironment(simulator)
        return false
        #else
        return true
        #endif
    }
    static var root: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("LocalModel", isDirectory: true)
    }

    private(set) var manifest: LocalModelManifest?
    private(set) var ready = false
    private(set) var downloading = false
    private(set) var progress: Double = 0
    private(set) var error: String?
    private var downloadTask: Task<Void, Never>?
    private var generations: [String: Task<Void, Never>] = [:]
    #if !targetEnvironment(simulator)
    private var container: ModelContainer?
    #endif

    private init() {
        var root = Self.root
        try? FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        var values = URLResourceValues(); values.isExcludedFromBackup = true // 能重新下载的大文件不进 iCloud 备份
        try? root.setResourceValues(values)
        if let d = try? Data(contentsOf: root.appendingPathComponent("manifest.json")), let m = try? JSONDecoder().decode(LocalModelManifest.self, from: d) {
            manifest = m
            ready = FileManager.default.fileExists(atPath: root.appendingPathComponent("ready").path)
                && m.files.allSatisfy { Self.size(root.appendingPathComponent($0.name)) == $0.size }
            progress = ready ? 1 : currentProgress()
        }
        NotificationCenter.default.addObserver(forName: UIApplication.didReceiveMemoryWarningNotification, object: nil, queue: .main) { _ in
            Task { @MainActor in LocalLLM.shared.unload() }
        }
    }

    func status() -> [String: Any] {
        var s: [String: Any] = ["supported": Self.supported, "ready": ready && Self.supported, "downloading": downloading, "progress": progress]
        if let error { s["error"] = error }
        if let m = manifest { s["size"] = m.size; s["size_text"] = ByteCountFormatter.string(fromByteCount: m.size, countStyle: .file); s["name"] = m.name }
        return s
    }

    // MARK: 下载

    func start(server: String) {
        guard Self.supported else { error = "模拟器跑不了本机模型，请在真机上使用"; return }
        guard !downloading, !ready else { return }
        guard let base = URL(string: server.trimmingCharacters(in: CharacterSet(charactersIn: "/")) + "/v1/assets/local-model"),
              base.scheme == "https" || base.host == "127.0.0.1" || base.host == "localhost" else { error = "下载地址不对"; return }
        if let free = try? Self.root.resourceValues(forKeys: [.volumeAvailableCapacityForImportantUsageKey]).volumeAvailableCapacityForImportantUsage,
           free < 800_000_000 { error = "手机剩余空间不足（至少需要 800 MB）"; return }
        error = nil; downloading = true
        downloadTask = Task { [weak self] in
            guard let self else { return }
            do {
                try await self.download(base: base)
                self.ready = true; self.progress = 1
            } catch is CancellationError {
            } catch {
                self.error = (error as? LocalError)?.errorDescription ?? error.localizedDescription
            }
            self.downloading = false; self.downloadTask = nil
        }
    }

    func pause() { downloadTask?.cancel(); downloadTask = nil; downloading = false }

    func delete() {
        pause(); unload()
        for url in (try? FileManager.default.contentsOfDirectory(at: Self.root, includingPropertiesForKeys: nil)) ?? [] { try? FileManager.default.removeItem(at: url) }
        manifest = nil; ready = false; progress = 0; error = nil
    }

    private func download(base: URL) async throws {
        let (data, response) = try await URLSession.shared.data(from: base.appendingPathComponent("manifest"))
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw LocalError.server((response as? HTTPURLResponse)?.statusCode ?? 0) }
        let fresh = try JSONDecoder().decode(LocalModelManifest.self, from: data)
        let names = fresh.files.map(\.name)
        guard !fresh.files.isEmpty, Set(names).count == names.count, fresh.size == fresh.files.reduce(0, { $0 + $1.size }),
              fresh.files.allSatisfy({ !$0.name.isEmpty && !$0.name.contains("/") && !$0.name.hasPrefix(".") && !["manifest.json", "ready"].contains($0.name) && $0.sha256.count == 64 }),
              names.contains("config.json"), names.contains("tokenizer.json"), names.contains(where: { $0.hasSuffix(".safetensors") })
        else { throw LocalError.manifest }
        if let old = manifest, old != fresh { for f in old.files { try? FileManager.default.removeItem(at: Self.root.appendingPathComponent(f.name)) } }
        manifest = fresh
        try JSONEncoder().encode(fresh).write(to: Self.root.appendingPathComponent("manifest.json"), options: .atomic)

        let chunk: Int64 = 8 * 1024 * 1024
        for file in fresh.files {
            let dest = Self.root.appendingPathComponent(file.name)
            if Self.size(dest) == file.size { continue }
            let partial = dest.appendingPathExtension("partial")
            if !FileManager.default.fileExists(atPath: partial.path) { FileManager.default.createFile(atPath: partial.path, contents: nil) }
            var have = Self.size(partial)
            if have > file.size { try FileManager.default.removeItem(at: partial); FileManager.default.createFile(atPath: partial.path, contents: nil); have = 0 }
            while have < file.size {
                try Task.checkCancellation()
                let end = min(file.size - 1, have + chunk - 1)
                var req = URLRequest(url: base.appendingPathComponent(file.name))
                req.setValue("bytes=\(have)-\(end)", forHTTPHeaderField: "Range")
                req.timeoutInterval = 60
                let (body, resp) = try await URLSession.shared.data(for: req)
                guard let http = resp as? HTTPURLResponse, http.statusCode == 206,
                      http.value(forHTTPHeaderField: "Content-Range") == "bytes \(have)-\(end)/\(file.size)",
                      Int64(body.count) == end - have + 1 else { throw LocalError.range }
                let h = try FileHandle(forWritingTo: partial)
                try h.seekToEnd(); try h.write(contentsOf: body); try h.close()
                have = end + 1
                progress = currentProgress()
            }
            let ok = try await Task.detached { try Self.verify(partial, sha256: file.sha256) }.value
            guard ok else { try? FileManager.default.removeItem(at: partial); throw LocalError.checksum }
            try FileManager.default.moveItem(at: partial, to: dest)
        }
        try Data(fresh.version.utf8).write(to: Self.root.appendingPathComponent("ready"), options: .atomic)
    }

    private func currentProgress() -> Double {
        guard let m = manifest, m.size > 0 else { return 0 }
        let done = m.files.reduce(Int64(0)) { sum, f in
            let u = Self.root.appendingPathComponent(f.name)
            return sum + max(Self.size(u), Self.size(u.appendingPathExtension("partial")))
        }
        return min(1, Double(done) / Double(m.size))
    }
    nonisolated static func size(_ url: URL) -> Int64 { (try? url.resourceValues(forKeys: [.fileSizeKey]).fileSize).map(Int64.init) ?? 0 }
    nonisolated static func verify(_ url: URL, sha256: String) throws -> Bool {
        let h = try FileHandle(forReadingFrom: url); defer { try? h.close() }
        var hash = SHA256()
        while let d = try h.read(upToCount: 1_048_576), !d.isEmpty { hash.update(data: d) }
        return hash.finalize().map { String(format: "%02x", $0) }.joined() == sha256.lowercased()
    }

    // MARK: 生成

    /// 流式生成：过程中推送 llm 事件 {id, text}（text 是到目前为止的全文），结束时 done 回调完整文字
    func generate(id: String, messages: [[String: String]], maxTokens: Int, done: @escaping (String?, String?) -> Void) {
        #if targetEnvironment(simulator)
        done(nil, LocalError.simulator.errorDescription)
        #else
        guard ready else { done(nil, LocalError.notReady.errorDescription); return }
        generations[id] = Task { [weak self] in
            guard let self else { return }
            defer { self.generations[id] = nil }
            do {
                if self.container == nil {
                    self.container = try await LLMModelFactory.shared.loadContainer(configuration: .init(directory: Self.root))
                }
                guard let container = self.container else { throw LocalError.notReady }
                let chat = messages.map { ["role": $0["role"] ?? "user", "content": String(($0["content"] ?? "").prefix(6000))] }
                let bridge = self.bridge
                var lastSent = Date.distantPast
                let result = try await container.perform { context in
                    // Qwen3：关掉思考模式（小模型思考只会更慢，不会更准）
                    let input = try await context.processor.prepare(input: UserInput(messages: chat, additionalContext: ["enable_thinking": false]))
                    return try MLXLMCommon.generate(input: input, parameters: .init(temperature: 0.2, repetitionPenalty: 1.15), context: context) { tokens in
                        if Task.isCancelled { return .stop }
                        if Date().timeIntervalSince(lastSent) > 0.08 {
                            lastSent = Date()
                            let text = context.tokenizer.decode(tokens: tokens)
                            DispatchQueue.main.async { bridge?.emit("llm", ["id": id, "text": text]) }
                        }
                        return tokens.count >= maxTokens ? .stop : .more
                    }
                }
                done(result.output, nil)
            } catch {
                done(nil, (error as? LocalError)?.errorDescription ?? error.localizedDescription)
            }
        }
        #endif
    }

    func cancel(id: String) { generations[id]?.cancel() }

    func unload() {
        for (_, t) in generations { t.cancel() }
        #if !targetEnvironment(simulator)
        container = nil
        #endif
    }
}

enum LocalError: LocalizedError {
    case manifest, checksum, range, notReady, simulator, server(Int)
    var errorDescription: String? {
        switch self {
        case .manifest: "模型清单不完整"
        case .checksum: "模型文件校验失败，请重新下载"
        case .range: "服务器不支持断点下载"
        case .notReady: "请先下载本机小模型"
        case .simulator: "模拟器跑不了本机模型，请在真机上使用"
        case .server(let code): "下载服务器返回 \(code)"
        }
    }
}
