import SwiftUI

/** The brand colours, matching the web app. Ink is the dark blue green used for backgrounds and teal is the accent. */
enum Brand {
    static let teal = Color(hex: 0x23867A)
    static let deep = Color(hex: 0x0B3B38)
    static let mint = Color(hex: 0x6CBFAE)
    static let clay = Color(hex: 0xDD8A63)

    static let ink950 = Color(hex: 0x07110F)
    static let ink900 = Color(hex: 0x0B1A20)
    static let ink800 = Color(hex: 0x11222A)
    static let ink700 = Color(hex: 0x182D34)
    static let ink600 = Color(hex: 0x223B43)
    static let ink400 = Color(hex: 0x4A6770)
    static let ink300 = Color(hex: 0x6F8B93)
    static let ink200 = Color(hex: 0x9FB4BA)
    static let ink100 = Color(hex: 0xC9D6D9)
    static let paper = Color(hex: 0xF8F6F1)
}

extension Color {
    /** A colour from a hex number such as 0x23867A. */
    init(hex: UInt32, opacity: Double = 1) {
        self.init(.sRGB,
                  red: Double((hex >> 16) & 0xFF) / 255,
                  green: Double((hex >> 8) & 0xFF) / 255,
                  blue: Double(hex & 0xFF) / 255,
                  opacity: opacity)
    }
}

/** How each heart rate status looks and reads, shared by the phone and the watch so they always agree. */
extension HeartStatus {
    // The colours are picked to stay readable on the dark background
    var tint: Color {
        switch self {
        case .inZone: return Color(hex: 0x5FD6A3)
        case .below: return Color(hex: 0x6CB6FF)
        case .above: return Color(hex: 0xFFB454)
        case .high: return Color(hex: 0xFF6B5E)
        case .noTarget, .unreliable: return Brand.ink200
        case .noSignal: return Brand.ink300
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

    /** True for the states where the person should be asked to slow down. */
    var needsAttention: Bool { self == .high || self == .above }
}
