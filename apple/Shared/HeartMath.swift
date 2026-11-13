import Foundation

/** The totals for one workout, sent to the hub when it ends. The zone times are nil when there is no zone to compare against. */
struct WorkoutSummary: Equatable, Sendable {
    let samples: Int
    let averageBpm: Int
    let minBpm: Int
    let maxBpm: Int
    let durationSeconds: Double
    let secondsInZone: Double?
    let secondsAbove: Double?
    let secondsBelow: Double?

    /** The share of time spent in the zone, or nil when there are no zone times. */
    var inZoneShare: Double? {
        guard let inZone = secondsInZone, let above = secondsAbove, let below = secondsBelow else { return nil }
        let total = inZone + above + below
        return total > 0 ? inZone / total : nil
    }
}

/** The calculations for heart rate readings. They are kept apart from the screens so they can be tested. */
enum HeartMath {
    // Gaps between samples longer than this count as ten seconds, so a dropped signal does not add minutes to a zone
    static let gapCapSeconds = 10.0

    /** Where a heart rate sits between resting and maximum, from 0 to 1. Without a zone the scale is 0 to 200 bpm. */
    static func position(bpm: Int, zone: HeartZone?) -> Double {
        guard let zone, zone.max > zone.resting else { return min(max(Double(bpm) / 200.0, 0), 1) }
        return min(max(Double(bpm - zone.resting) / Double(zone.max - zone.resting), 0), 1)
    }

    /** The part of the gauge that is the target zone. */
    static func zoneBand(_ zone: HeartZone) -> ClosedRange<Double> {
        position(bpm: zone.low, zone: zone)...position(bpm: zone.high, zone: zone)
    }

    /** Adds up the time spent below, in and above the zone. Each sample counts for the time until the next one. */
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

    /** Elapsed time as minutes and seconds, with hours only when needed. */
    static func elapsedText(_ seconds: Double) -> String {
        let total = Int(max(0, seconds))
        let hours = total / 3600
        let minutes = (total % 3600) / 60
        let secs = total % 60
        return hours > 0 ? String(format: "%d:%02d:%02d", hours, minutes, secs) : String(format: "%d:%02d", minutes, secs)
    }
}
