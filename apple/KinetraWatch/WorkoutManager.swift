import Foundation
import HealthKit

final class WorkoutManager: NSObject, @unchecked Sendable {
    static let saveToHealth = false

    var onHeartRate: (@Sendable (Double, Date) -> Void)?
    var onStopped: (@Sendable () -> Void)?

    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private let heartRateType = HKQuantityType(.heartRate)
    private let unit = HKUnit.count().unitDivided(by: .minute())

    func authorize() async throws {
        try await store.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [heartRateType])
    }

    func start() async throws {
        guard session == nil else { return }
        try await authorize()
        let configuration = HKWorkoutConfiguration()
        configuration.activityType = .functionalStrengthTraining
        configuration.locationType = .indoor
        let newSession = try HKWorkoutSession(healthStore: store, configuration: configuration)
        let newBuilder = newSession.associatedWorkoutBuilder()
        newBuilder.dataSource = HKLiveWorkoutDataSource(healthStore: store, workoutConfiguration: configuration)
        newSession.delegate = self
        newBuilder.delegate = self
        session = newSession
        builder = newBuilder
        let started = Date()
        newSession.startActivity(with: started)
        try await newBuilder.beginCollection(at: started)
    }

    func stop() async {
        guard let session, let builder else { return }
        session.end()
        let ended = Date()
        try? await builder.endCollection(at: ended)
        if Self.saveToHealth {
            _ = try? await builder.finishWorkout()
        } else {
            builder.discardWorkout()
        }
        self.session = nil
        self.builder = nil
    }
}

extension WorkoutManager: HKWorkoutSessionDelegate {
    func workoutSession(_ workoutSession: HKWorkoutSession, didChangeTo toState: HKWorkoutSessionState, from fromState: HKWorkoutSessionState, date: Date) {
        if toState == .ended || toState == .stopped {
            onStopped?()
        }
    }

    func workoutSession(_ workoutSession: HKWorkoutSession, didFailWithError error: Error) {
        onStopped?()
    }
}

extension WorkoutManager: HKLiveWorkoutBuilderDelegate {
    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        guard collectedTypes.contains(heartRateType),
              let statistics = workoutBuilder.statistics(for: heartRateType),
              let quantity = statistics.mostRecentQuantity() else { return }
        let bpm = quantity.doubleValue(for: unit)
        let date = statistics.mostRecentQuantityDateInterval()?.end ?? Date()
        onHeartRate?(bpm, date)
    }
}
