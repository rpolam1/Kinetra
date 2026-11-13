import Foundation
import HealthKit

/** Runs the workout session that keeps the watch awake and gives heart rate readings. */
final class WorkoutManager: NSObject, @unchecked Sendable {
    // Workouts are thrown away instead of being saved to Health, because this is not meant to fill the person's activity history
    static let saveToHealth = false

    var onHeartRate: (@Sendable (Double, Date) -> Void)?
    var onStopped: (@Sendable () -> Void)?

    private let store = HKHealthStore()
    private var session: HKWorkoutSession?
    private var builder: HKLiveWorkoutBuilder?
    private let heartRateType = HKQuantityType(.heartRate)
    private let unit = HKUnit.count().unitDivided(by: .minute())

    /** Asks for permission to read heart rate. */
    func authorize() async throws {
        try await store.requestAuthorization(toShare: [HKObjectType.workoutType()], read: [heartRateType])
    }

    /** Starts a session and begins collecting. Calling it twice does nothing. */
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

    /** Ends the session and drops the workout. */
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

// The system can end a session by itself, so the model is told to wrap up too
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
    // Not used, but the protocol needs it
    func workoutBuilderDidCollectEvent(_ workoutBuilder: HKLiveWorkoutBuilder) {}

    // Called for each new batch of data. Only the newest heart rate is used.
    func workoutBuilder(_ workoutBuilder: HKLiveWorkoutBuilder, didCollectDataOf collectedTypes: Set<HKSampleType>) {
        guard collectedTypes.contains(heartRateType),
              let statistics = workoutBuilder.statistics(for: heartRateType),
              let quantity = statistics.mostRecentQuantity() else { return }
        let bpm = quantity.doubleValue(for: unit)
        let date = statistics.mostRecentQuantityDateInterval()?.end ?? Date()
        onHeartRate?(bpm, date)
    }
}
