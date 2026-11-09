import Foundation

actor HeartUploader {
    typealias ReadingHandler = @Sendable (HeartReading) -> Void
    typealias ConnectionHandler = @Sendable (Bool) -> Void

    private let clients: [HubClient]
    private let patientId: String
    private let deviceId: String
    private let onReading: ReadingHandler
    private let onConnection: ConnectionHandler
    private var active = 0
    private var buffer: [HeartSample] = []
    private var offset = 0.0
    private var offsetCheckedAt = Date.distantPast
    private var running = false

    static let interval: Duration = .seconds(2)
    static let batchSize = 300
    static let maxBuffered = 3600
    static let offsetRefreshSeconds = 300.0

    init(clients: [HubClient], patientId: String, deviceId: String, onReading: @escaping ReadingHandler, onConnection: @escaping ConnectionHandler) {
        self.clients = clients
        self.patientId = patientId
        self.deviceId = deviceId
        self.onReading = onReading
        self.onConnection = onConnection
    }

    func enqueue(_ sample: HeartSample) {
        buffer.append(sample)
        if buffer.count > Self.maxBuffered { buffer.removeFirst(buffer.count - Self.maxBuffered) }
    }

    func run() async {
        running = true
        while running && !Task.isCancelled {
            await tick()
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
            onReading(reading)
        } catch let error as HubError {
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
