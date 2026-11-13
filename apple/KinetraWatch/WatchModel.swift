import Foundation
import Observation
import WatchKit

/** The state of the watch app. It runs the workout, collects heart rate and uploads it. */
@MainActor
@Observable
final class WatchModel {
    // One shared model is needed because the system can start the app from a workout request
    static let shared = WatchModel()

    /** Where the watch is in its flow. */
    enum Phase: Equatable {
        case needsSetup
        case choosing
        case ready
        case starting
        case running
        case summary
    }

    var phase: Phase = .needsSetup
    var pairing: HubPairing?
    var reading: HeartReading = .waiting
    var localBpm: Int?
    var startedAt: Date?
    var isConnected = true
    var errorMessage: String?
    var people: [RosterPerson] = []
    var isLoadingPeople = false
    var summary: WorkoutSummary?

    private let workout = WorkoutManager()
    private let link = WatchLink()
    private var uploader: HeartUploader?
    private var uploadTask: Task<Void, Never>?
    private var samples: [HeartSample] = []
    private var lastStatus: HeartStatus?
    private var lastZone: HeartZone?

    // The saved pairing is read at once so the watch works without the phone nearby
    private init() {
        pairing = PairingStore.load()
        phase = Self.restingPhase(for: pairing)
        workout.onHeartRate = { [weak self] bpm, date in
            Task { @MainActor in self?.record(bpm: bpm, at: date) }
        }
        workout.onStopped = { [weak self] in
            Task { @MainActor in await self?.finish() }
        }
        link.onPairing = { [weak self] incoming in
            Task { @MainActor in self?.apply(incoming) }
        }
        link.onEnd = { [weak self] in
            Task { @MainActor in await self?.end() }
        }
        link.activate()
    }

    /** The screen to return to when nothing is running. */
    private static func restingPhase(for pairing: HubPairing?) -> Phase {
        guard let pairing else { return .needsSetup }
        return pairing.person == nil ? .choosing : .ready
    }

    /** Takes new hub details from the phone. A workout in progress keeps its screen. */
    func apply(_ incoming: HubPairing) {
        pairing = incoming
        PairingStore.save(incoming)
        if phase == .running || phase == .starting { return }
        phase = Self.restingPhase(for: incoming)
    }

    /** Saves who is wearing this watch. */
    func choose(_ person: RosterPerson) {
        guard var next = pairing else { return }
        next.person = person.selection
        pairing = next
        PairingStore.save(next)
        phase = .ready
    }

    /** Goes back to the list of people. */
    func changePerson() {
        guard phase == .ready || phase == .summary else { return }
        phase = pairing == nil ? .needsSetup : .choosing
        Task { await loadPeople() }
    }

    /** Loads the roster, trying each hub address until one answers. */
    func loadPeople() async {
        guard let pairing, !pairing.candidateURLs.isEmpty else { return }
        isLoadingPeople = true
        errorMessage = nil
        defer { isLoadingPeople = false }
        var lastError: Error?
        for url in pairing.candidateURLs {
            do {
                people = try await HubClient(baseURL: url, apiKey: pairing.apiKey).roster().people
                return
            } catch {
                lastError = error
            }
        }
        errorMessage = lastError?.localizedDescription
    }

    /** Starts the workout and the upload. If the workout cannot start, the watch goes back to ready with an explanation. */
    func start() async {
        guard phase == .ready || phase == .summary, let pairing, let person = pairing.person else { return }
        errorMessage = nil
        phase = .starting
        samples = []
        reading = .waiting
        localBpm = nil
        lastStatus = nil
        lastZone = nil
        isConnected = true
        let clients = pairing.candidateURLs.map { HubClient(baseURL: $0, apiKey: pairing.apiKey) }
        let newUploader = HeartUploader(
            clients: clients,
            patientId: person.patientId,
            deviceId: WKInterfaceDevice.current().name,
            onReading: { [weak self] value in Task { @MainActor in self?.receive(value) } },
            onConnection: { [weak self] ok in Task { @MainActor in self?.isConnected = ok } }
        )
        uploader = newUploader
        do {
            try await workout.start()
        } catch {
            uploader = nil
            errorMessage = "Could not start the workout. Allow heart rate access in Settings. (\(error.localizedDescription))"
            phase = .ready
            return
        }
        startedAt = Date()
        phase = .running
        uploadTask = Task { await newUploader.run() }
        WKInterfaceDevice.current().play(.start)
    }

    /** Ends the workout when the person or the phone asks. */
    func end() async {
        guard phase == .running || phase == .starting else { return }
        await finish()
    }

    /** Stops the upload, sends what is left, and works out the summary. This also runs when the system ends the workout. */
    private func finish() async {
        guard phase == .running || phase == .starting else { return }
        phase = .summary
        uploadTask?.cancel()
        await uploader?.stop()
        await uploader?.flushRemaining()
        uploader = nil
        await workout.stop()
        summary = HeartMath.summarize(samples, zone: lastZone)
        WKInterfaceDevice.current().play(.stop)
    }

    /** Leaves the summary screen. */
    func dismissSummary() {
        phase = Self.restingPhase(for: pairing)
    }

    /** Keeps a reading from the watch sensor and queues it for upload. */
    private func record(bpm: Double, at date: Date) {
        guard phase == .running else { return }
        let sample = HeartSample(t: date.timeIntervalSince1970, bpm: bpm)
        samples.append(sample)
        localBpm = Int(bpm.rounded())
        Task { await uploader?.enqueue(sample) }
    }

    /** Handles the hub's view of the heart rate. A tap on the wrist is played only when the status changes. */
    private func receive(_ value: HeartReading) {
        guard phase == .running else { return }
        reading = value
        if let zone = value.zone { lastZone = zone }
        guard value.status != lastStatus else { return }
        let previous = lastStatus
        lastStatus = value.status
        // A first reading of no signal is skipped, so starting a workout does not buzz
        guard previous != nil || value.status != .noSignal else { return }
        switch value.status {
        case .high: WKInterfaceDevice.current().play(.failure)
        case .above: WKInterfaceDevice.current().play(.notification)
        case .below: WKInterfaceDevice.current().play(.directionUp)
        case .inZone: WKInterfaceDevice.current().play(.success)
        default: break
        }
    }

    /** The rate straight from the watch when there is one, because it is faster than the round trip to the hub. */
    var displayedBpm: Int? {
        localBpm ?? reading.bpm
    }
}
