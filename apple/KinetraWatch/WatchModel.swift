import Foundation
import Observation
import WatchKit

@MainActor
@Observable
final class WatchModel {
    static let shared = WatchModel()

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

    private static func restingPhase(for pairing: HubPairing?) -> Phase {
        guard let pairing else { return .needsSetup }
        return pairing.person == nil ? .choosing : .ready
    }

    func apply(_ incoming: HubPairing) {
        pairing = incoming
        PairingStore.save(incoming)
        if phase == .running || phase == .starting { return }
        phase = Self.restingPhase(for: incoming)
    }

    func choose(_ person: RosterPerson) {
        guard var next = pairing else { return }
        next.person = person.selection
        pairing = next
        PairingStore.save(next)
        phase = .ready
    }

    func changePerson() {
        guard phase == .ready || phase == .summary else { return }
        phase = pairing == nil ? .needsSetup : .choosing
        Task { await loadPeople() }
    }

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

    func end() async {
        guard phase == .running || phase == .starting else { return }
        await finish()
    }

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

    func dismissSummary() {
        phase = Self.restingPhase(for: pairing)
    }

    private func record(bpm: Double, at date: Date) {
        guard phase == .running else { return }
        let sample = HeartSample(t: date.timeIntervalSince1970, bpm: bpm)
        samples.append(sample)
        localBpm = Int(bpm.rounded())
        Task { await uploader?.enqueue(sample) }
    }

    private func receive(_ value: HeartReading) {
        guard phase == .running else { return }
        reading = value
        if let zone = value.zone { lastZone = zone }
        guard value.status != lastStatus else { return }
        let previous = lastStatus
        lastStatus = value.status
        guard previous != nil || value.status != .noSignal else { return }
        switch value.status {
        case .high: WKInterfaceDevice.current().play(.failure)
        case .above: WKInterfaceDevice.current().play(.notification)
        case .below: WKInterfaceDevice.current().play(.directionUp)
        case .inZone: WKInterfaceDevice.current().play(.success)
        default: break
        }
    }

    var displayedBpm: Int? {
        localBpm ?? reading.bpm
    }
}
