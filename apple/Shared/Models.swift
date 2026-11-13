import Foundation

/** The heart rate states the hub can report. The raw values match the hub's JSON. */
enum HeartStatus: String, Codable, Sendable {
    case noSignal = "no_signal"
    case noTarget = "no_target"
    case unreliable
    case below
    case inZone = "in_zone"
    case above
    case high
}

/** The target heart rate range, with the person's resting and maximum rate. */
struct HeartZone: Codable, Equatable, Sendable {
    let low: Int
    let high: Int
    let max: Int
    let resting: Int
}

/** One heart rate reading from the hub, with a message ready to show. */
struct HeartReading: Codable, Equatable, Sendable {
    let bpm: Int?
    let ageSeconds: Double?
    let status: HeartStatus
    let message: String
    let zone: HeartZone?

    // What is shown before the first reading arrives
    static let waiting = HeartReading(bpm: nil, ageSeconds: nil, status: .noSignal, message: "Waiting for heart rate", zone: nil)
}

/** The hub's answer to an upload. */
struct VitalsResponse: Codable, Sendable {
    let ok: Bool
    let accepted: Int
    let status: HeartReading
}

/** The hub's answer when asked for one person's status. */
struct StatusResponse: Codable, Sendable {
    let patientId: String
    let status: HeartReading
}

/** The hub's time, used to line up the watch clock. */
struct ServerTime: Codable, Sendable {
    let t: Double
}

/** One person on the hub's roster who could wear the watch. */
struct RosterPerson: Codable, Identifiable, Hashable, Sendable {
    let tagId: Int
    let patientId: String
    let displayName: String
    let inSession: Bool
    let inView: Bool
    let watchConnected: Bool

    var id: String { patientId }
    var selection: SelectedPerson { SelectedPerson(tagId: tagId, patientId: patientId, displayName: displayName) }
}

/** The list of people from the hub, with whether a session is running. */
struct Roster: Codable, Sendable {
    let serverTime: Double
    let sessionActive: Bool
    let tagsManaged: Bool
    let people: [RosterPerson]
}

/** The person who is wearing this watch, kept in a small form so it can be sent between devices. */
struct SelectedPerson: Codable, Hashable, Sendable {
    let tagId: Int
    let patientId: String
    let displayName: String
}

/** Everything needed to reach the hub. The fallback is the IP address to use when the host name does not resolve. */
struct HubPairing: Codable, Equatable, Sendable {
    var hubURL: URL
    var fallbackURL: URL?
    var apiKey: String
    var person: SelectedPerson?

    var candidateURLs: [URL] { [hubURL, fallbackURL].compactMap { $0 } }
}

/** One heart rate reading with its time in seconds. */
struct HeartSample: Codable, Equatable, Sendable {
    let t: Double
    let bpm: Double
}
