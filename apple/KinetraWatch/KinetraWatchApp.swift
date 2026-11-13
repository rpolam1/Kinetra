import HealthKit
import SwiftUI
import WatchKit

/** Called when the iPhone starts the watch app in a workout, which begins the session without a tap on the watch. */
final class AppDelegate: NSObject, WKApplicationDelegate {
    func handle(_ workoutConfiguration: HKWorkoutConfiguration) {
        Task { @MainActor in await WatchModel.shared.start() }
    }
}

/** The entry point of the watch app. */
@main
struct KinetraWatchApp: App {
    @WKApplicationDelegateAdaptor private var delegate: AppDelegate

    var body: some Scene {
        WindowGroup {
            WatchRootView()
                .environment(WatchModel.shared)
        }
    }
}
