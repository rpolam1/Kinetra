import Foundation
import HealthKit
import Observation
import WatchConnectivity

@MainActor
@Observable
final class PhoneLink: NSObject {
    private(set) var isPaired = false
    private(set) var isWatchAppInstalled = false
    private(set) var isReachable = false
    private var pending: HubPairing?

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    func send(_ pairing: HubPairing) {
        pending = pairing
        pushPending()
    }

    func sendEnd() {
        guard WCSession.default.activationState == .activated, WCSession.default.isReachable else { return }
        WCSession.default.sendMessage([LinkKey.command: LinkCommand.end], replyHandler: nil, errorHandler: nil)
    }

    func launchWatchWorkout() async throws {
        let store = HKHealthStore()
        try await store.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [HKQuantityType(.heartRate)])
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .functionalStrengthTraining
        configuration.locationType = .indoor
        try await store.startWatchApp(toHandle: configuration)
    }

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

extension PhoneLink: WCSessionDelegate {
    nonisolated func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        Task { @MainActor in self.refresh(session) }
    }

    nonisolated func sessionDidBecomeInactive(_ session: WCSession) {}

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
