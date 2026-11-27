import SwiftUI
import WebKit

@main
struct SplashPlayerApp: App {
    var body: some Scene {
        WindowGroup {
            if let animation = Bundle.main.url(forResource: "index", withExtension: "html") {
                AnimationView(animation: animation)
                    .background(Color(red: 0.125, green: 0.137, blue: 0.165))
            } else {
                Text("The bundled animation could not be loaded.")
            }
        }
    }
}

struct AnimationView: UIViewRepresentable {
    let animation: URL

    func makeCoordinator() -> Navigation {
        Navigation(animation: animation)
    }

    func makeUIView(context: Context) -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.websiteDataStore = .nonPersistent()
        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isOpaque = false
        webView.scrollView.isScrollEnabled = false
        webView.navigationDelegate = context.coordinator
        webView.loadFileURL(animation, allowingReadAccessTo: animation)
        return webView
    }

    func updateUIView(_ webView: WKWebView, context: Context) {}

    final class Navigation: NSObject, WKNavigationDelegate {
        private let animation: URL

        init(animation: URL) {
            self.animation = animation
        }

        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
                     decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
            let isBundledAnimation = action.targetFrame?.isMainFrame == true &&
                action.request.url == animation
            decisionHandler(isBundledAnimation ? .allow : .cancel)
        }
    }
}
