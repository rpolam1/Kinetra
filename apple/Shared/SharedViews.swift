import SwiftUI

/** The timing of a heartbeat, used to make hearts and rings pulse at the person's real rate. */
enum Beat {
    /** A value from 0 to 1 that peaks twice per beat, a big thump and then a smaller one. Without a rate it rises and falls slowly, like breathing. */
    static func pulse(at date: Date, bpm: Int?) -> Double {
        guard let bpm else {
            let t = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: 2.8) / 2.8
            return 0.5 - 0.5 * cos(t * 2 * .pi)
        }
        let rate = Double(min(max(bpm, 30), 220))
        let period = 60.0 / rate
        let t = date.timeIntervalSinceReferenceDate.truncatingRemainder(dividingBy: period) / period
        func bump(_ x: Double, _ width: Double) -> Double {
            x >= 0 && x < width ? sin(x / width * .pi) : 0
        }
        return max(bump(t, 0.16), 0.55 * bump(t - 0.26, 0.14))
    }
}

/** The pulse line from the Kinetra logo, as a shape so it can be drawn on with an animation. */
struct PulseMark: Shape {
    static let aspect: CGFloat = 302.0 / 132.0

    func path(in rect: CGRect) -> Path {
        let points: [(CGFloat, CGFloat)] = [(152, 530), (240, 530), (272, 450), (318, 582), (352, 486), (380, 530), (454, 530)]
        var path = Path()
        for (index, p) in points.enumerated() {
            let point = CGPoint(x: rect.minX + (p.0 - 152) / 302 * rect.width,
                                y: rect.minY + (p.1 - 450) / 132 * rect.height)
            if index == 0 { path.move(to: point) } else { path.addLine(to: point) }
        }
        return path
    }
}

/** The logo mark. The line draws itself once and then glows gently. */
struct PulseLogo: View {
    var height: CGFloat = 40
    var color: Color = Brand.mint

    @State private var progress: CGFloat = 0
    @State private var glow = false

    var body: some View {
        PulseMark()
            .trim(from: 0, to: progress)
            .stroke(color, style: StrokeStyle(lineWidth: max(2, height * 0.13), lineCap: .round, lineJoin: .round))
            .frame(width: height * PulseMark.aspect, height: height)
            .shadow(color: color.opacity(glow ? 0.65 : 0.15), radius: glow ? 10 : 3)
            .onAppear {
                withAnimation(.easeInOut(duration: 1.1)) { progress = 1 }
                withAnimation(.easeInOut(duration: 1.8).repeatForever(autoreverses: true).delay(1.1)) { glow = true }
            }
            .accessibilityHidden(true)
    }
}

/** A round badge with a person's initials. The colour comes from the name, so a person keeps the same colour everywhere. */
struct Avatar: View {
    let name: String
    var size: CGFloat = 44

    private static let palette: [Color] = [
        Color(hex: 0x23867A), Color(hex: 0x3F7FA8), Color(hex: 0x8A6BB0),
        Color(hex: 0xC8643B), Color(hex: 0x6E8F3E), Color(hex: 0xB0587A),
    ]

    private var color: Color {
        let sum = name.unicodeScalars.reduce(0) { $0 &+ Int($1.value) }
        return Self.palette[sum % Self.palette.count]
    }

    private var initials: String {
        let letters = name.split(separator: " ").prefix(2).compactMap { $0.first }
        return String(letters).uppercased()
    }

    var body: some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [color, color.opacity(0.6)], startPoint: .topLeading, endPoint: .bottomTrailing))
            Text(initials)
                .font(.system(size: size * 0.38, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }
}

/** The main heart rate gauge. A 300 degree ring shows where the heart rate sits between resting and maximum, with the target zone shaded. The heart in the middle beats at the real rate. */
struct HeartGauge: View {
    let bpm: Int?
    let reading: HeartReading
    var lineWidth: CGFloat = 16
    var showsCaption = true

    @Environment(\.isLuminanceReduced) private var dimmed

    // The ring covers 300 of 360 degrees, and the gap sits at the bottom
    private static let sweep = 300.0 / 360.0
    private static let startAngle = 120.0

    private var tint: Color { reading.status.tint }

    private var position: Double {
        guard let bpm else { return 0 }
        return HeartMath.position(bpm: bpm, zone: reading.zone)
    }

    private func arc(_ from: Double, _ to: Double) -> some Shape {
        Circle()
            .trim(from: from * Self.sweep, to: to * Self.sweep)
            .rotation(.degrees(Self.startAngle))
    }

    var body: some View {
        GeometryReader { proxy in
            let side = min(proxy.size.width, proxy.size.height)
            let radius = (side - lineWidth) / 2
            let angle = Angle.degrees(Self.startAngle + 300 * position).radians

            ZStack {
                // A soft glow behind the ring that swells with each beat
                TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: dimmed)) { context in
                    let pulse = dimmed ? 0 : Beat.pulse(at: context.date, bpm: bpm)
                    Circle()
                        .fill(RadialGradient(colors: [tint.opacity(0.10 + 0.22 * pulse), .clear],
                                             center: .center, startRadius: 0, endRadius: side * 0.55))
                        .scaleEffect(1 + 0.04 * pulse)
                }

                arc(0, 1)
                    .stroke(Brand.ink600.opacity(0.75), style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .padding(lineWidth / 2)

                if let zone = reading.zone, reading.status != .unreliable {
                    let band = HeartMath.zoneBand(zone)
                    arc(band.lowerBound, band.upperBound)
                        .stroke(Color(hex: 0x5FD6A3).opacity(0.4), style: StrokeStyle(lineWidth: lineWidth * 1.45, lineCap: .butt))
                        .padding(lineWidth / 2)
                }

                if bpm != nil {
                    arc(0, max(0.015, position))
                        .stroke(tint, style: StrokeStyle(lineWidth: lineWidth * 0.5, lineCap: .round))
                        .padding(lineWidth / 2)
                        .shadow(color: tint.opacity(0.55), radius: lineWidth * 0.5)

                    Circle()
                        .fill(.white)
                        .overlay(Circle().stroke(tint, lineWidth: lineWidth * 0.2))
                        .frame(width: lineWidth * 1.15, height: lineWidth * 1.15)
                        .shadow(color: tint.opacity(0.7), radius: lineWidth * 0.4)
                        .offset(x: radius * cos(angle), y: radius * sin(angle))
                }

                VStack(spacing: side * 0.01) {
                    TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: dimmed)) { context in
                        let pulse = dimmed ? 0 : Beat.pulse(at: context.date, bpm: bpm)
                        Image(systemName: "heart.fill")
                            .font(.system(size: side * 0.10))
                            .foregroundStyle(tint)
                            .scaleEffect(1 + (bpm == nil ? 0.08 : 0.24) * pulse)
                            .shadow(color: tint.opacity(0.6 * pulse), radius: 8)
                    }
                    Text(bpm.map(String.init) ?? "--")
                        .font(.system(size: side * 0.30, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(.white)
                        .contentTransition(.numericText(value: Double(bpm ?? 0)))
                        .minimumScaleFactor(0.6)
                    if showsCaption {
                        Text("BPM")
                            .font(.system(size: side * 0.065, weight: .semibold, design: .rounded))
                            .tracking(1.5)
                            .foregroundStyle(Brand.ink200)
                    }
                }
                .offset(y: -side * 0.02)
            }
            .frame(width: side, height: side)
            .position(x: proxy.size.width / 2, y: proxy.size.height / 2)
            .animation(.spring(response: 0.8, dampingFraction: 0.78), value: position)
            .animation(.easeInOut(duration: 0.5), value: reading.status)
        }
        .aspectRatio(1, contentMode: .fit)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Heart rate \(bpm.map(String.init) ?? "unknown") beats per minute. \(reading.status.title)")
    }
}

/** A small dot that sends out a ripple, to show something is live. */
struct LiveDot: View {
    var color: Color = HeartStatus.inZone.tint
    var active = true

    var body: some View {
        ZStack {
            if active {
                Circle()
                    .fill(color.opacity(0.5))
                    .phaseAnimator([false, true]) { view, phase in
                        view.scaleEffect(phase ? 2.6 : 1).opacity(phase ? 0 : 0.8)
                    } animation: { _ in .easeOut(duration: 1.5) }
            }
            Circle().fill(color)
        }
        .frame(width: 8, height: 8)
    }
}
