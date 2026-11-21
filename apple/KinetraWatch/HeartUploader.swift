import Foundation

actor HeartUploader {
    typealias ReadingHandler = @Sendable (HeartReading) -> Void
    typealias ConnectionHandler = @Sendable (Bool) -> Void
    typealias ProblemHandler = @Sendable (String?) -> Void
    typealias SessionEndedHandler = @Sendable () -> Void

    private let clients: [HubClient]
    private let patientId: String
    private let deviceId: String
    private let onReading: ReadingHandler
    private let onConnection: ConnectionHandler
    private let onProblem: ProblemHandler
    private let onSessionEnded: SessionEndedHandler
    private var active = 0
    private var rounds = 0
    private var missedChecks = 0
    private var buffer: [HeartSample] = []
    private var offset = 0.0
    private var offsetCheckedAt = Date.distantPast
    private var running = false

    static let interval: Duration = .seconds(2)
    static let batchSize = 300
    static let maxBuffered = 3600
    static let offsetRefreshSeconds = 300.0
    static let sessionCheckEvery = 3
    static let missesToEnd = 2

    init(clients: [HubClient], patientId: String, deviceId: String, onReading: @escaping ReadingHandler, onConnection: @escaping ConnectionHandler, onProblem: @escaping ProblemHandler = { _ in }, onSessionEnded: @escaping SessionEndedHandler = {}) {
        self.clients = clients
        self.patientId = patientId
        self.deviceId = deviceId
        self.onReading = onReading
        self.onConnection = onConnection
        self.onProblem = onProblem
        self.onSessionEnded = onSessionEnded
    }

    func enqueue(_ sample: HeartSample) {
        buffer.append(sample)
        if buffer.count > Self.maxBuffered { buffer.removeFirst(buffer.count - Self.maxBuffered) }
    }

    func run() async {
        running = true
        while running && !Task.isCancelled {
            await tick()
            await checkSession()
            try? await Task.sleep(for: Self.interval)
        }
    }

    func stop() {
        running = false
    }

    func flushRemaining() async {
        await tick()
    }

    private func tick() async {
        guard !clients.isEmpty else { return }
        await refreshOffsetIfNeeded()
        if buffer.isEmpty {
            await poll()
        } else {
            await send()
        }
    }

    /** Every few rounds, asks the hub whether this person is still in a running session and tells the watch when they are not. */
    private func checkSession() async {
        rounds += 1
        guard rounds % Self.sessionCheckEvery == 0, !clients.isEmpty else { return }
        // An unreachable hub says nothing about the session, so only a real answer counts
        guard let roster = try? await clients[active].roster() else { return }
        let inSession = roster.people.contains { $0.patientId == patientId && $0.inSession }
        missedChecks = inSession ? 0 : missedChecks + 1
        if missedChecks >= Self.missesToEnd {
            missedChecks = 0
            onSessionEnded()
        }
    }

    private func refreshOffsetIfNeeded(force: Bool = false) async {
        guard force || Date().timeIntervalSince(offsetCheckedAt) > Self.offsetRefreshSeconds else { return }
        if let value = try? await clients[active].clockOffset() {
            offset = value
            offsetCheckedAt = Date()
        }
    }

    private func poll() async {
        do {
            let reading = try await clients[active].status(patientId: patientId)
            onConnection(true)
            onReading(reading)
        } catch {
            rotate()
            onConnection(false)
        }
    }

    private func send() async {
        let batch = Array(buffer.prefix(Self.batchSize))
        let shifted = batch.map { HeartSample(t: $0.t + offset, bpm: $0.bpm) }
        do {
            let reading = try await clients[active].post(samples: shifted, patientId: patientId, deviceId: deviceId)
            buffer.removeFirst(min(batch.count, buffer.count))
            onConnection(true)
            onProblem(nil)
            onReading(reading)
        } catch let error as HubError {
            onProblem(error.errorDescription)
            switch error {
            case .rejected:
                buffer.removeFirst(min(batch.count, buffer.count))
                await refreshOffsetIfNeeded(force: true)
                onConnection(true)
            case .unauthorized:
                onConnection(false)
            default:
                rotate()
                onConnection(false)
            }
        } catch {
            onConnection(false)
        }
    }

    private func rotate() {
        guard clients.count > 1 else { return }
        active = (active + 1) % clients.count
    }
}