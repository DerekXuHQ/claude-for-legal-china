// 主界面：一个网页视图，加载 App 内置的界面（Web/，app:// 协议）。
// 界面和服务端代码都在这个页面里运行；原生能力通过 Bridge 提供。
import UIKit
import WebKit
import UniformTypeIdentifiers
import UserNotifications

/// app://local/... -> App 包里的 Web/ 目录
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    private let root = Bundle.main.resourceURL!.appendingPathComponent("Web", isDirectory: true)
    private static let mime: [String: String] = [
        "html": "text/html", "js": "text/javascript", "mjs": "text/javascript", "css": "text/css", "json": "application/json",
        "svg": "image/svg+xml", "png": "image/png", "bcmap": "application/octet-stream", "pfb": "application/octet-stream", "ttf": "font/ttf",
    ]

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return task.didFailWithError(BridgeError("bad url")) }
        var rel = url.path.removingPercentEncoding ?? url.path
        if rel.isEmpty || rel == "/" { rel = "/index.html" }
        let file = root.appendingPathComponent(String(rel.dropFirst())).standardizedFileURL
        guard file.path.hasPrefix(root.standardizedFileURL.path), let data = try? Data(contentsOf: file) else {
            let r = HTTPURLResponse(url: url, statusCode: 404, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "text/plain"])!
            task.didReceive(r); task.didReceive(Data("not found".utf8)); task.didFinish(); return
        }
        let type = SchemeHandler.mime[file.pathExtension.lowercased()] ?? "application/octet-stream"
        let headers = ["Content-Type": type.hasPrefix("text/") || type.hasSuffix("json") ? "\(type); charset=utf-8" : type,
                       "Content-Length": "\(data.count)", "Cache-Control": "no-store", "Access-Control-Allow-Origin": "*"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
}

final class WebViewController: UIViewController, WKUIDelegate, WKNavigationDelegate, WKDownloadDelegate, UNUserNotificationCenterDelegate {
    let bridge = Bridge()
    private(set) var webView: WKWebView!
    private var downloads: [ObjectIdentifier: URL] = [:]

    override func loadView() {
        let cfg = WKWebViewConfiguration()
        cfg.setURLSchemeHandler(SchemeHandler(), forURLScheme: "app")
        cfg.userContentController.add(bridge, name: "native")
        // 启动参数（测试用）：-autotest YES 运行自检并把结果写进 Documents/data/autotest.json；-view agents 打开指定页面
        let d = UserDefaults.standard
        let launch: [String: Any] = ["autotest": d.bool(forKey: "autotest"), "view": d.string(forKey: "view") ?? "", "ask": d.string(forKey: "ask") ?? ""]
        cfg.userContentController.addUserScript(WKUserScript(source: "window.__launch = \(Bridge.json(launch));", injectionTime: .atDocumentStart, forMainFrameOnly: true))
        cfg.allowsInlineMediaPlayback = true
        cfg.mediaTypesRequiringUserActionForPlayback = []
        cfg.defaultWebpagePreferences.allowsContentJavaScript = true
        cfg.preferences.javaScriptCanOpenWindowsAutomatically = false
        let wv = WKWebView(frame: .zero, configuration: cfg)
        wv.uiDelegate = self
        wv.navigationDelegate = self
        wv.allowsBackForwardNavigationGestures = false
        wv.scrollView.contentInsetAdjustmentBehavior = .never
        wv.scrollView.bounces = false
        wv.isOpaque = false
        wv.backgroundColor = .systemBackground
        #if DEBUG
        if #available(iOS 16.4, *) { wv.isInspectable = true } // 调试版：Mac 上的 Safari「开发」菜单可以调试（正式版不开，免得别人读到 API key）
        #endif
        bridge.webView = wv
        webView = wv
        view = wv
    }

    private var pageReady = false
    private var pendingRun: String?

    /// 弹出框要从最上层的界面弹，否则（例如分享面板还开着）弹不出来
    private func top() -> UIViewController {
        var vc: UIViewController = self
        while let p = vc.presentedViewController, !p.isBeingDismissed { vc = p }
        return vc
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        UNUserNotificationCenter.current().delegate = self
        bridge.onReady = { [weak self] in
            guard let self else { return }
            self.pageReady = true
            if let id = self.pendingRun { self.pendingRun = nil; self.openRun(id) }
        }
        webView.load(URLRequest(url: URL(string: "app://local/index.html")!))
    }

    // 听写：网页要麦克风时直接允许（系统第一次会弹出麦克风权限确认），不再每次都问
    @available(iOS 15.0, *)
    func webView(_ webView: WKWebView, requestMediaCapturePermissionFor origin: WKSecurityOrigin, initiatedByFrame frame: WKFrameInfo, type: WKMediaCaptureType, decisionHandler: @escaping (WKPermissionDecision) -> Void) {
        decisionHandler(type == .microphone ? .grant : .prompt)
    }

    // MARK: alert / confirm / prompt（prompt 同时是同步桥）

    func webView(_ webView: WKWebView, runJavaScriptTextInputPanelWithPrompt prompt: String, defaultText: String?, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (String?) -> Void) {
        if prompt.hasPrefix("__native__") { completionHandler(bridge.sync(String(prompt.dropFirst(10)))); return }
        let a = UIAlertController(title: nil, message: prompt, preferredStyle: .alert)
        a.addTextField { $0.text = defaultText }
        a.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(nil) })
        a.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler(a.textFields?.first?.text) })
        presentAlert(a) { completionHandler(nil) }
    }

    func webView(_ webView: WKWebView, runJavaScriptAlertPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping () -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "好", style: .default) { _ in completionHandler() })
        presentAlert(a) { completionHandler() }
    }

    func webView(_ webView: WKWebView, runJavaScriptConfirmPanelWithMessage message: String, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping (Bool) -> Void) {
        let a = UIAlertController(title: nil, message: message, preferredStyle: .alert)
        a.addAction(UIAlertAction(title: "取消", style: .cancel) { _ in completionHandler(false) })
        a.addAction(UIAlertAction(title: "确定", style: .default) { _ in completionHandler(true) })
        presentAlert(a) { completionHandler(false) }
    }

    /// 弹不出来时（界面正在切换）立即回调，WebKit 要求回调一定会被调用
    private func presentAlert(_ a: UIAlertController, fallback: @escaping () -> Void) {
        let vc = top()
        guard vc.viewIfLoaded?.window != nil, !(vc is UIAlertController) else { return fallback() }
        vc.present(a, animated: true)
    }

    // MARK: 链接：外部网址用 Safari 打开；导出的 Word 等文件走系统分享

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let u = action.request.url, ["http", "https"].contains(u.scheme ?? "") { UIApplication.shared.open(u) }
        return nil
    }

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.shouldPerformDownload { return decisionHandler(.download) }
        if let u = action.request.url, ["http", "https", "mailto", "tel"].contains(u.scheme ?? "") {
            UIApplication.shared.open(u)
            return decisionHandler(.cancel)
        }
        decisionHandler(.allow)
    }

    func webView(_ webView: WKWebView, decidePolicyFor response: WKNavigationResponse, decisionHandler: @escaping (WKNavigationResponsePolicy) -> Void) {
        decisionHandler(response.canShowMIMEType ? .allow : .download)
    }

    func webView(_ webView: WKWebView, navigationAction: WKNavigationAction, didBecome download: WKDownload) { download.delegate = self }
    func webView(_ webView: WKWebView, navigationResponse: WKNavigationResponse, didBecome download: WKDownload) { download.delegate = self }

    func download(_ download: WKDownload, decideDestinationUsing response: URLResponse, suggestedFilename: String, completionHandler: @escaping (URL?) -> Void) {
        let dir = FileManager.default.temporaryDirectory.appendingPathComponent("exports", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let url = dir.appendingPathComponent(suggestedFilename.isEmpty ? "导出文件" : suggestedFilename)
        try? FileManager.default.removeItem(at: url)
        downloads[ObjectIdentifier(download)] = url
        completionHandler(url)
    }

    func downloadDidFinish(_ download: WKDownload) {
        guard let url = downloads.removeValue(forKey: ObjectIdentifier(download)) else { return }
        let vc = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        vc.popoverPresentationController?.sourceView = view
        vc.popoverPresentationController?.sourceRect = CGRect(x: view.bounds.midX, y: view.bounds.midY, width: 1, height: 1)
        top().present(vc, animated: true)
    }

    func download(_ download: WKDownload, didFailWithError error: Error, resumeData: Data?) {
        downloads.removeValue(forKey: ObjectIdentifier(download))
    }

    // 网页进程被系统回收（内存紧张）时重新加载
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        pageReady = false
        bridge.reset()
        webView.reload()
    }

    // MARK: 通知：点一下打开对应的定时报告

    func userNotificationCenter(_ c: UNUserNotificationCenter, willPresent n: UNNotification, withCompletionHandler done: @escaping (UNNotificationPresentationOptions) -> Void) {
        done([.banner, .sound])
        webView.evaluateJavaScript("window.refreshAgentBadge && window.refreshAgentBadge()", completionHandler: nil)
    }

    func userNotificationCenter(_ c: UNUserNotificationCenter, didReceive r: UNNotificationResponse, withCompletionHandler done: @escaping () -> Void) {
        if let id = r.notification.request.content.userInfo["runId"] as? String, !id.isEmpty {
            if pageReady { openRun(id) } else { pendingRun = id } // 冷启动：等页面准备好再打开
        }
        done()
    }

    private func openRun(_ id: String) {
        webView.evaluateJavaScript("window.openAgentRun && window.openAgentRun(\(Bridge.json(id)))", completionHandler: nil)
    }
}
