import SwiftUI

/** The entry point. One model is created here and shared with every screen. */
@main
struct KinetraApp: App {
    @State private var model = AppModel()
    @Environment(\.scenePhase) private var phase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                // Coming back to the app checks that the hub is still reachable, and finds it again if its address changed
                .onChange(of: phase) { _, new in
                    if new == .active { Task { await model.appBecameActive() } }
                }
        }
    }
}
