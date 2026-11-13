import SwiftUI

/** The brand colours, matching the teal used in the web app. */
enum Brand {
    static let teal = Color(red: 0.059, green: 0.463, blue: 0.431)
    static let deep = Color(red: 0.043, green: 0.231, blue: 0.220)
}

/** How each heart rate status looks and reads, shared by the phone and the watch so they always agree. */
extension HeartStatus {
    var tint: Color {
        switch self {
        case .inZone: return .green
        case .below: return .blue
        case .above: return .orange
        case .high: return .red
        case .noTarget, .unreliable: return .gray
        case .noSignal: return .secondary
        }
    }

    /** The short heading shown for the status. */
    var title: String {
        switch self {
        case .inZone: return "In your zone"
        case .below: return "Below your zone"
        case .above: return "Above your zone"
        case .high: return "Too high"
        case .noTarget: return "No target zone"
        case .unreliable: return "Reference only"
        case .noSignal: return "No signal"
        }
    }

    /** The icon shown with the status. The arrows point the way the person should move, so a low heart rate shows an up arrow. */
    var symbol: String {
        switch self {
        case .inZone: return "checkmark.circle.fill"
        case .below: return "arrow.up.circle.fill"
        case .above: return "arrow.down.circle.fill"
        case .high: return "exclamationmark.triangle.fill"
        case .noTarget, .unreliable: return "heart.fill"
        case .noSignal: return "heart.slash.fill"
        }
    }

    /** A plain sentence that tells the person what to do. */
    var coachingLine: String {
        switch self {
        case .inZone: return "Right where you should be"
        case .below: return "You can push a little harder"
        case .above: return "Ease off a little"
        case .high: return "Slow down and rest. Tell the technician if you feel unwell"
        case .noTarget: return "Heart rate is being recorded"
        case .unreliable: return "Heart rate is being recorded for reference"
        case .noSignal: return "Waiting for a heart-rate reading"
        }
    }
}
