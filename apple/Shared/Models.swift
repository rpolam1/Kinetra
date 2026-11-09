import Foundation

enum HeartStatus: String, Codable, Sendable {
    case noSignal = "no_signal"
    case noTarget = "no_target"
    case unreliable
    case below
    case inZone = "in_zone"
    case above
    case high
}

struct HeartZone: Codable, Equatable, Sendable {
    let low: Int
    let high: Int
    let max: Int
    let resting: Int
}

struct HeartReading: Codable, Equatable, Sendable {
    let bpm: Int?
    let ageSeconds: Double?
    let status: HeartStatus
    let message: String
    let zone: HeartZone?

    static let waiting = HeartReading(bpm: nil, ageSeconds: nil, status: .noSignal, message: "Waiting for heart rate", zone: nil)
}

struct VitalsResponse: Codable, Sendable {
    let ok: Bool
    let accepted: Int
    let status: HeartReading
}

struct StatusResponse: Codable, Sendable {
    let patientId: String
    let status: HeartReading
}

struct ServerTime: Codable, Sendable {
    let t: Double
}

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

struct Roster: Codable, Sendable {
    let serverTime: Double
    let sessionActive: Bool
    let tagsManaged: Bool
    let people: [RosterPerson]
}

struct SelectedPerson: Codable, Hashable, Sendable {
    let tagId: Int
    let patientId: String
    let displayName: String
}

struct HubPairing: Codable, Equatable, Sendable {
    var hubURL: URL
    var fallbackURL: URL?
    var apiKey: String
    var person: SelectedPerson?

    var candidateURLs: [URL] { [hubURL, fallbackURL].compactMap { $0 } }
}

struct HeartSample: Codable, Equatable, Sendable {
    let t: Double
    let bpm: Double
}
