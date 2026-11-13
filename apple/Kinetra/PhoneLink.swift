import Foundation
import HealthKit
import Observation
import WatchConnectivity

/** The phone side of the link to the watch. It sends the hub details and the start and end commands. */
@MainActor
@Observable
final class PhoneLink: NSObject {
    private(set) var isPaired = false
    private(set) var isWatchAppInstalled = false
    private(set) var isReachable = false
    private var pending: HubPairing?

    /** Starts the connection. The delegate is set first so no event is missed. */
    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    /** Sends the hub details to the watch. They are kept until the connection is ready. */
    func send(_ pairing: HubPairing) {
        pending = pairing
        pushPending()
    }

    /** Tells the watch to stop. It needs the watch to be reachable right now. */
    func sendEnd() {
        guard WCSession.default.activationState == .activated, WCSession.default.isReachable else { return }
        WCSession.default.sendMessage([LinkKey.command: LinkCommand.end], replyHandler: nil, errorHandler: nil)
    }

    /** Asks for permission and starts the watch app in a workout, which also wakes it. */
    func launchWatchWorkout() async throws {
        let store = HKHealthStore()
        try await store.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [HKQuantityType(.heartRate)])
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .functionalStrengthTraining
        configuration.locationType = .indoor
        try await store.startWatchApp(toHandle: configuration)
    }

    // Application context keeps only the newest value, which is what is wanted for settings
    private func pushPending() {
        guard let pending, WCSession.default.activationState == .activated, let data = try? JSONEncoder().encode(pending) else { return }
        try? WCSession.default.updateApplicationContext([LinkKey.pairing: data])
    }

    private func refresh(_ session: WCSession) {
        isPaired = session.isPaired
        isWatchAppInstalled = session.isWatchAppInstalled
        isReachable = session.isReachable
        pushPending()
    }
}

// The callbacks arrive off the main thread, so each hops to the main thread before changing state
extension PhoneLink: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in self.refresh(session) }
    }

    // Nothing to do, because the session is reactivated once it deactivates
    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

    // Needed when the person switches to a different paired watch
    nonisolated func sessionDidDeactivate(_ session: WCSession) {
        session.activate()
    }

    nonisolated func sessionReachabilityDidChange(_ session: WCSession) {
        Task { @MainActor in self.refresh(session) }
    }

    nonisolated func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor in self.refresh(session) }
    }
}
