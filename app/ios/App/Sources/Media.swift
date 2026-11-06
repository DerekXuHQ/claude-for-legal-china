// 文字识别（Vision，简繁中文 + 英文）、照片转 JPG（HEIC 等）、录音转 WAV。
// 文字识别结果是给模型核对的「本机初稿」：生僻字、异体字以本机识别为准（见 server/ai/ocr.mjs）。
import Foundation
import UIKit
import Vision
import AVFoundation

enum Media {
    private static let queue = DispatchQueue(label: "media", qos: .userInitiated, attributes: .concurrent)

    static func ocr(base64: String, done: @escaping (Result<String, Error>) -> Void) {
        queue.async {
            guard let data = Data(base64Encoded: base64), let img = UIImage(data: data), let cg = img.cgImage else { return done(.failure(BridgeError("读不出这张图片"))) }
            let req = VNRecognizeTextRequest()
            req.recognitionLevel = .accurate
            req.usesLanguageCorrection = true
            req.recognitionLanguages = ["zh-Hans", "zh-Hant", "en-US"]
            if #available(iOS 16.0, *) { req.automaticallyDetectsLanguage = false }
            do {
                try VNImageRequestHandler(cgImage: cg, orientation: CGImagePropertyOrientation(img.imageOrientation), options: [:]).perform([req])
                let obs = (req.results ?? []).sorted { a, b in
                    // 从上到下、从左到右；同一行（中线高度差小于行高一半）按横坐标
                    let ya = a.boundingBox.midY, yb = b.boundingBox.midY
                    if abs(ya - yb) < min(a.boundingBox.height, b.boundingBox.height) / 2 { return a.boundingBox.minX < b.boundingBox.minX }
                    return ya > yb
                }
                var lines: [String] = []
                var lastY: CGFloat? = nil
                var cur = ""
                for o in obs {
                    guard let t = o.topCandidates(1).first?.string else { continue }
                    if let y = lastY, abs(o.boundingBox.midY - y) < o.boundingBox.height / 2 { cur += " " + t }
                    else { if !cur.isEmpty { lines.append(cur) }; cur = t }
                    lastY = o.boundingBox.midY
                }
                if !cur.isEmpty { lines.append(cur) }
                done(.success(lines.joined(separator: "\n")))
            } catch { done(.failure(error)) }
        }
    }

    static func toJpeg(base64: String, done: @escaping (Result<String, Error>) -> Void) {
        queue.async {
            guard let data = Data(base64Encoded: base64), let img = UIImage(data: data), let jpg = img.jpegData(compressionQuality: 0.9) else { return done(.failure(BridgeError("读不出这张照片"))) }
            done(.success(jpg.base64EncodedString()))
        }
    }

    /// 任意录音（m4a、mp3、aac、caf、amr、wav……）转成单声道 16 位 PCM WAV
    static func toWav(base64: String, ext: String, rate: Double, done: @escaping (Result<String, Error>) -> Void) {
        queue.async {
            let tmp = FileManager.default.temporaryDirectory.appendingPathComponent("in-\(UUID().uuidString).\(ext.isEmpty ? "m4a" : ext)")
            defer { try? FileManager.default.removeItem(at: tmp) }
            do {
                guard let data = Data(base64Encoded: base64) else { throw BridgeError("数据格式不对") }
                try data.write(to: tmp)
                let file = try AVAudioFile(forReading: tmp)
                guard let outFmt = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: rate, channels: 1, interleaved: true),
                      let conv = AVAudioConverter(from: file.processingFormat, to: outFmt) else { throw BridgeError("不支持这个录音格式") }
                var pcm = Data()
                let inBuf = AVAudioPCMBuffer(pcmFormat: file.processingFormat, frameCapacity: 32768)!
                var eof = false
                while true {
                    let outBuf = AVAudioPCMBuffer(pcmFormat: outFmt, frameCapacity: AVAudioFrameCount(Double(32768) * rate / file.processingFormat.sampleRate) + 1024)!
                    var err: NSError?
                    let st = conv.convert(to: outBuf, error: &err) { _, status in
                        if eof { status.pointee = .endOfStream; return nil }
                        do { try file.read(into: inBuf) } catch { eof = true; status.pointee = .endOfStream; return nil }
                        if inBuf.frameLength == 0 { eof = true; status.pointee = .endOfStream; return nil }
                        status.pointee = .haveData
                        return inBuf
                    }
                    if let err { throw err }
                    if outBuf.frameLength > 0, let p = outBuf.int16ChannelData { pcm.append(Data(bytes: p[0], count: Int(outBuf.frameLength) * 2)) }
                    if st == .endOfStream || st == .error { break }
                }
                done(.success(wav(pcm, rate: Int(rate)).base64EncodedString()))
            } catch {
                done(.failure(BridgeError("读不出这个录音的格式，请先导出成 m4a、mp3 或 wav 再上传")))
            }
        }
    }

    private static func wav(_ pcm: Data, rate: Int) -> Data {
        var d = Data()
        func u32(_ v: Int) { var x = UInt32(v).littleEndian; d.append(Data(bytes: &x, count: 4)) }
        func u16(_ v: Int) { var x = UInt16(v).littleEndian; d.append(Data(bytes: &x, count: 2)) }
        d.append("RIFF".data(using: .ascii)!); u32(36 + pcm.count); d.append("WAVE".data(using: .ascii)!)
        d.append("fmt ".data(using: .ascii)!); u32(16); u16(1); u16(1); u32(rate); u32(rate * 2); u16(2); u16(16)
        d.append("data".data(using: .ascii)!); u32(pcm.count); d.append(pcm)
        return d
    }
}

extension CGImagePropertyOrientation {
    init(_ o: UIImage.Orientation) {
        switch o {
        case .up: self = .up
        case .down: self = .down
        case .left: self = .left
        case .right: self = .right
        case .upMirrored: self = .upMirrored
        case .downMirrored: self = .downMirrored
        case .leftMirrored: self = .leftMirrored
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
