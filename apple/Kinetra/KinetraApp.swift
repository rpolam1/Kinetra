import SwiftUI

/** The entry point. One model is created here and shared with every screen. */
@main
struct KinetraApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
        }
    }
}
