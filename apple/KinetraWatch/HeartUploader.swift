import Foundation

/** Sends the watch's heart rate samples to the hub in batches and reads back the status. It is an actor so the buffer is never touched from two places at once. */
actor HeartUploader {
    typealias ReadingHandler = @Sendable (HeartReading) -> Void
    typealias ConnectionHandler = @Sendable (Bool) -> Void

    // One client per address for the hub, so the uploader can switch to the next one when the first stops answering
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

    // How often the uploader wakes up
    static let interval: Duration = .seconds(2)
    // The most samples sent in one request
    static let batchSize = 300
    // An hour of samples at one a second. Older ones are dropped if the hub cannot be reached for longer.
    static let maxBuffered = 3600
    // How often the clock difference with the hub is measured again
    static let offsetRefreshSeconds = 300.0

    init(clients: [HubClient], patientId: String, deviceId: String, onReading: @escaping ReadingHandler, onConnection: @escaping ConnectionHandler) {
        self.clients = clients
        self.patientId = patientId
        self.deviceId = deviceId
        self.onReading = onReading
        self.onConnection = onConnection
    }

    /** Adds a sample to the queue to be sent. */
    func enqueue(_ sample: HeartSample) {
        buffer.append(sample)
        if buffer.count > Self.maxBuffered { buffer.removeFirst(buffer.count - Self.maxBuffered) }
    }

    /** Runs until stopped, sending or polling every interval. */
    func run() async {
        running = true
        while running && !Task.isCancelled {
            await tick()
            try? await Task.sleep(for: Self.interval)
        }
    }

    /** Stops the loop after the current round. */
    func stop() {
        running = false
    }

    /** One last round of sending when the workout ends, so the final samples are not lost. */
    func flushRemaining() async {
        await tick()
    }

    // With nothing to send the uploader only asks for the status, so the watch still shows the hub's view
    private func tick() async {
        guard !clients.isEmpty else { return }
        await refreshOffsetIfNeeded()
        if buffer.isEmpty {
            await poll()
        } else {
            await send()
        }
    }

    /** Measures how far the watch clock is from the hub's. Sample times are shifted by this so the hub sees them on its own clock. */
    private func refreshOffsetIfNeeded(force: Bool = false) async {
        guard force || Date().timeIntervalSince(offsetCheckedAt) > Self.offsetRefreshSeconds else { return }
        if let value = try? await clients[active].clockOffset() {
            offset = value
            offsetCheckedAt = Date()
        }
    }

    /** Reads the person's status when there is nothing to upload. A failure moves on to the next address. */
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

    /** Sends the oldest batch and removes it from the queue once the hub has taken it. */
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
            // A rejected batch is dropped, because sending the same bad data again would never work
            case .rejected:
                buffer.removeFirst(min(batch.count, buffer.count))
                await refreshOffsetIfNeeded(force: true)
                onConnection(true)
            // A wrong access key will not fix itself, so the batch is kept and no other address is tried
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

    /** Moves to the next address, wrapping around to the first. */
    private func rotate() {
        guard clients.count > 1 else { return }
        active = (active + 1) % clients.count
    }
}
