import Foundation

struct WorkoutSummary: Equatable, Sendable {
    let samples: Int
    let averageBpm: Int
    let minBpm: Int
    let maxBpm: Int
    let durationSeconds: Double
    let secondsInZone: Double?
    let secondsAbove: Double?
    let secondsBelow: Double?

    var inZoneShare: Double? {
        guard let inZone = secondsInZone, let above = secondsAbove, let below = secondsBelow else { return nil }
        let total = inZone + above + below
        return total > 0 ? inZone / total : nil
    }
}

enum HeartMath {
    static let gapCapSeconds = 10.0

    static func position(bpm: Int, zone: HeartZone?) -> Double {
        guard let zone, zone.max > zone.resting else { return min(max(Double(bpm) / 200.0, 0), 1) }
        return min(max(Double(bpm - zone.resting) / Double(zone.max - zone.resting), 0), 1)
    }

    static func zoneBand(_ zone: HeartZone) -> ClosedRange<Double> {
        position(bpm: zone.low, zone: zone)...position(bpm: zone.high, zone: zone)
    }

    static func summarize(_ samples: [HeartSample], zone: HeartZone?) -> WorkoutSummary? {
        let ordered = samples.sorted { $0.t < $1.t }
        guard let first = ordered.first, let last = ordered.last else { return nil }
        let bpms = ordered.map(\.bpm)
        var inZone = 0.0
        var above = 0.0
        var below = 0.0
        for (index, sample) in ordered.enumerated() {
            let gap = index + 1 < ordered.count ? ordered[index + 1].t - sample.t : 1.0
            let weight = max(0, min(gap, gapCapSeconds))
            guard let zone else { continue }
            if sample.bpm < Double(zone.low) {
                below += weight
            } else if sample.bpm > Double(zone.high) {
                above += weight
            } else {
                inZone += weight
            }
        }
        return WorkoutSummary(
            samples: ordered.count,
            averageBpm: Int((bpms.reduce(0, +) / Double(bpms.count)).rounded()),
            minBpm: Int((bpms.min() ?? 0).rounded()),
            maxBpm: Int((bpms.max() ?? 0).rounded()),
            durationSeconds: last.t - first.t,
            secondsInZone: zone == nil ? nil : inZone,
            secondsAbove: zone == nil ? nil : above,
            secondsBelow: zone == nil ? nil : below
        )
    }

    static func elapsedText(_ seconds: Double) -> String {
        let total = Int(max(0, seconds))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let secs = total % 60
        return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, secs) : String(format: "%d:%02d", minutes, secs)
    }
}
