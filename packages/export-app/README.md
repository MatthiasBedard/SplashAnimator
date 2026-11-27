# @splash/export-app

The browser editor's **File → Export → Windows desktop app** command downloads a build kit for a standalone Tauri player. The kit contains the current animation, native window and application metadata, matching ICO and PNG icons, locked Rust dependencies and build instructions.

Extract the archive into a new writable folder and run `cargo build --release --locked` with the Rust MSVC toolchain and Microsoft C++ Build Tools. The app at `target/release/splash-project-player.exe` requires Microsoft Edge WebView2. The build produces an unsigned executable. Use your publisher's signing certificate and Windows SignTool when required for distribution. [Windows prerequisites](https://v2.tauri.app/start/prerequisites/)

The player uses the ordinary HTML animation renderer with its own window and restrictive content policy. It has no editor commands or authored script execution. This kit targets Windows local builds. Installer creation, signing and other platforms are separate.

The browser editor's **File → Export → Android app** command downloads a Gradle project for an offline Android WebView player. The archive includes the animation, launcher name and icon, stable application ID, and build and signing instructions.

Extract the archive and run `gradle assembleDebug` using JDK 17, Gradle 8.13, Android SDK Platform 36 and Build Tools 35.0.0. The debug APK is for Android 8.0 or later with a current Android System WebView. Open the Gradle project in Android Studio to generate a signed release with your own keystore. Native build and real-device qualification are tracked under SA-059. [Gradle compatibility](https://developer.android.com/build/releases/agp-8-13-0-release-notes) · [Android signing](https://developer.android.com/studio/publish/app-signing)

The browser editor's **File → Export → iPhone and iPad app** command downloads an Xcode source kit with the animation, an opaque app icon, an escaped launcher name and a stable bundle identifier. SwiftUI hosts the ordinary script-free player in a WKWebView with read access to the bundled HTML file. The player works without a network connection. [Apple local WebView loading](https://developer.apple.com/documentation/webkit/wkwebview/loadfileurl(_:allowingreadaccessto:))

On a Mac, extract the archive and open `SplashPlayer.xcodeproj` in Xcode with iOS platform support. The project targets iOS/iPadOS 16 or later. Build for a simulator or choose your team and device under Xcode's signing settings. The included `BUILD.txt` covers the simulator build and device signing. Xcode compilation and physical-device playback remain open under SA-059. [Apple simulator, device and signing instructions](https://developer.apple.com/documentation/xcode/running-your-app-on-simulated-or-physical-devices)
