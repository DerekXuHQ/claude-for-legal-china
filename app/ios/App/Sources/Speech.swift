// 语音输入（听写）：iOS 的语音识别（普通话），边说边出字。
// 页面在 app:// 下拿不到麦克风（getUserMedia 只在安全来源可用），所以听写走原生。
import Foundation
import Speech
import AVFoundation

final class SpeechBridge {
    private weak var bridge: Bridge?
    private let engine = AVAudioEngine()
    private var request: SFSpeechAudioBufferRecognitionRequest?
    private var task: SFSpeechRecognitionTask?
    private let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN"))

    init(bridge: Bridge) { self.bridge = bridge }

    func start(done: @escaping (String?) -> Void) {
        SFSpeechRecognizer.requestAuthorization { st in
            guard st == .authorized else { return done("没有语音识别权限：请在「设置 → 隐私与安全性 → 语音识别」里允许本 App") }
            AVAudioSession.sharedInstance().requestRecordPermission { ok in
                guard ok else { return done("没有麦克风权限：请在「设置 → 隐私与安全性 → 麦克风」里允许本 App") }
                DispatchQueue.main.async {
                    do { try self.begin(); done(nil) } catch { done("无法开始听写：\(error.localizedDescription)") }
                }
            }
        }
    }

    private func begin() throws {
        stop(final: false)
        guard let recognizer, recognizer.isAvailable else { throw BridgeError("语音识别暂时不可用") }
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true, options: .notifyOthersOnDeactivation)
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        req.addsPunctuation = true
        request = req
        let input = engine.inputNode
        let fmt = input.outputFormat(forBus: 0)
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: fmt) { [weak self] buf, _ in self?.request?.append(buf) }
        engine.prepare()
        try engine.start()
        task = recognizer.recognitionTask(with: req) { [weak self] result, error in
            guard let self else { return }
            if let result {
                self.bridge?.emit("speech", ["text": result.bestTranscription.formattedString, "final": result.isFinal])
                if result.isFinal { self.stop(final: false) }
            }
            if let error { self.bridge?.emit("speech", ["error": error.localizedDescription, "final": true]); self.stop(final: false) }
        }
    }

    /// final 为 true：说完了，等最后一段结果；false：直接取消
    func stop(final: Bool) {
        if engine.isRunning { engine.stop(); engine.inputNode.removeTap(onBus: 0) }
        if final { request?.endAudio() } else { task?.cancel(); task = nil }
        request = final ? request : nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
