import SwiftUI

/** The dark background used on every screen, with a slow glow that drifts behind the content. */
struct AppBackdrop: View {
    @State private var drift = false

    var body: some View {
        ZStack {
            Brand.ink900
            // Soft gradient discs are moved around, because shifting a view costs almost nothing and blurring one costs a lot
            Circle()
                .fill(RadialGradient(colors: [Brand.teal.opacity(0.40), .clear], center: .center, startRadius: 0, endRadius: 280))
                .frame(width: 560, height: 560)
                .offset(x: drift ? 120 : -110, y: drift ? -250 : -320)
            Circle()
                .fill(RadialGradient(colors: [Color(hex: 0x165A52).opacity(0.50), .clear], center: .center, startRadius: 0, endRadius: 260))
                .frame(width: 520, height: 520)
                .offset(x: drift ? -130 : 110, y: drift ? 330 : 270)
        }
        .ignoresSafeArea()
        .onAppear {
            withAnimation(.easeInOut(duration: 16).repeatForever(autoreverses: true)) { drift = true }
        }
    }
}

extension View {
    /** The raised panel style shared by every card. */
    func cardStyle(padding: CGFloat = 18, tint: Color? = nil) -> some View {
        self
            .padding(padding)
            .background {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .fill(Brand.ink800.opacity(0.92))
                    .overlay {
                        if let tint {
                            RoundedRectangle(cornerRadius: 22, style: .continuous).fill(tint.opacity(0.10))
                        }
                    }
            }
            .overlay {
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .strokeBorder((tint ?? .white).opacity(tint == nil ? 0.07 : 0.28), lineWidth: 1)
            }
    }

    /** Fades and slides a view in, a little later for each index, so lists build up instead of appearing at once. */
    func staggeredEntrance(index: Int, shown: Bool) -> some View {
        self
            .opacity(shown ? 1 : 0)
            .offset(y: shown ? 0 : 18)
            .animation(.smooth(duration: 0.55).delay(Double(min(index, 10)) * 0.05), value: shown)
    }

    /** A moving highlight that shows content is loading. */
    func shimmering() -> some View { modifier(Shimmer()) }
}

/** The loading highlight that sweeps across placeholder shapes. */
private struct Shimmer: ViewModifier {
    @State private var phase: CGFloat = -1

    func body(content: Content) -> some View {
        content
            .overlay {
                GeometryReader { proxy in
                    LinearGradient(colors: [.clear, .white.opacity(0.10), .clear], startPoint: .leading, endPoint: .trailing)
                        .frame(width: proxy.size.width * 0.6)
                        .offset(x: phase * proxy.size.width * 1.6)
                }
                .mask(content)
            }
            .onAppear {
                withAnimation(.linear(duration: 1.4).repeatForever(autoreverses: false)) { phase = 1 }
            }
    }
}

/** The main call to action. It glows, presses in and fades when disabled. */
struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.headline, design: .rounded))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 17)
            .foregroundStyle(.white.opacity(isEnabled ? 1 : 0.5))
            .background {
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(LinearGradient(colors: [Color(hex: 0x2CA797), Brand.teal], startPoint: .top, endPoint: .bottom))
                    .opacity(isEnabled ? 1 : 0.35)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(.white.opacity(0.16), lineWidth: 1)
            }
            .shadow(color: Brand.teal.opacity(isEnabled ? 0.45 : 0), radius: configuration.isPressed ? 4 : 16, y: configuration.isPressed ? 2 : 7)
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.65), value: configuration.isPressed)
    }
}

/** A quieter button tinted with one colour, for actions that are not the main one. */
struct SoftButtonStyle: ButtonStyle {
    var tint: Color = Brand.mint

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.subheadline, design: .rounded, weight: .semibold))
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .foregroundStyle(tint)
            .background {
                RoundedRectangle(cornerRadius: 14, style: .continuous).fill(tint.opacity(configuration.isPressed ? 0.24 : 0.13))
            }
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(response: 0.3, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/** A button with no background, used for small text actions. */
struct GhostButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(.subheadline, design: .rounded, weight: .medium))
            .foregroundStyle(Brand.ink200)
            .opacity(configuration.isPressed ? 0.55 : 1)
    }
}

/** Gives a tappable row a small press effect. */
struct PressableStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.975 : 1)
            .brightness(configuration.isPressed ? 0.04 : 0)
            .animation(.spring(response: 0.28, dampingFraction: 0.7), value: configuration.isPressed)
    }
}

/** A red message box for errors. */
struct ErrorBanner: View {
    let message: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(HeartStatus.high.tint)
            Text(message)
                .font(.subheadline)
                .foregroundStyle(Brand.ink100)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .cardStyle(padding: 14, tint: HeartStatus.high.tint)
        .transition(.move(edge: .top).combined(with: .opacity))
    }
}

/** A picture of a person's tag. Interpolation is off so the squares stay sharp. */
struct TagThumbnail: View {
    let url: URL?
    var size: CGFloat = 56

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                image.resizable().interpolation(.none).scaledToFit().transition(.opacity)
            case .failure:
                Image(systemName: "qrcode").font(.title2).foregroundStyle(Brand.ink400)
            default:
                Color.clear.overlay { ProgressView().tint(Brand.ink400) }
            }
        }
        .frame(width: size, height: size)
        .padding(5)
        .background(.white, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
        .accessibilityHidden(true)
    }
}

/** A small label with an optional icon, such as On camera. */
struct Chip: View {
    let text: String
    var symbol: String?
    var tint: Color = Brand.ink200

    var body: some View {
        HStack(spacing: 4) {
            if let symbol { Image(systemName: symbol).font(.system(size: 10, weight: .bold)) }
            Text(text).font(.system(.caption2, design: .rounded, weight: .semibold))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .foregroundStyle(tint)
        .background(tint.opacity(0.14), in: Capsule())
    }
}

/** Shows which hub the app is talking to and whether it answers. */
struct HubChip: View {
    let name: String
    let online: Bool

    var body: some View {
        HStack(spacing: 8) {
            LiveDot(color: online ? HeartStatus.inZone.tint : HeartStatus.above.tint, active: online)
            Text(online ? name : "Looking for \(name)")
                .font(.system(.footnote, design: .rounded, weight: .semibold))
                .foregroundStyle(Brand.ink100)
                .lineLimit(1)
                .contentTransition(.opacity)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 7)
        .background(Brand.ink700.opacity(0.85), in: Capsule())
        .overlay(Capsule().strokeBorder(.white.opacity(0.07), lineWidth: 1))
        .animation(.smooth, value: online)
    }
}

/** One number with a label, used for the minimum, average and maximum. */
struct StatTile: View {
    let title: String
    let value: Int?
    var tint: Color = .white

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(title.uppercased())
                .font(.system(.caption2, design: .rounded, weight: .semibold))
                .tracking(1)
                .foregroundStyle(Brand.ink300)
            Text(value.map(String.init) ?? "--")
                .font(.system(size: 28, weight: .bold, design: .rounded))
                .monospacedDigit()
                .foregroundStyle(tint)
                .contentTransition(.numericText(value: Double(value ?? 0)))
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardStyle(padding: 14)
        .animation(.snappy, value: value)
    }
}

/** A line chart of the recent heart rate. The target zone is shaded behind the line. */
struct Sparkline: View {
    let values: [Int]
    let zone: HeartZone?
    var tint: Color

    private var domain: ClosedRange<Double> {
        var low = Double(values.min() ?? 60)
        var high = Double(values.max() ?? 120)
        if let zone {
            low = min(low, Double(zone.low))
            high = max(high, Double(zone.high))
        }
        let pad = max(6, (high - low) * 0.12)
        return (low - pad)...(high + pad)
    }

    var body: some View {
        GeometryReader { proxy in
            let size = proxy.size
            let range = domain
            let span = max(1, range.upperBound - range.lowerBound)
            let points: [CGPoint] = values.enumerated().map { index, value in
                CGPoint(x: values.count > 1 ? size.width * CGFloat(index) / CGFloat(values.count - 1) : size.width,
                        y: size.height * (1 - CGFloat((Double(value) - range.lowerBound) / span)))
            }

            ZStack {
                if let zone {
                    let top = size.height * (1 - CGFloat((Double(zone.high) - range.lowerBound) / span))
                    let bottom = size.height * (1 - CGFloat((Double(zone.low) - range.lowerBound) / span))
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(HeartStatus.inZone.tint.opacity(0.12))
                        .frame(height: max(2, bottom - top))
                        .frame(maxHeight: .infinity, alignment: .top)
                        .offset(y: top)
                }

                if points.count > 1 {
                    SparkShape(points: points, closed: true)
                        .fill(LinearGradient(colors: [tint.opacity(0.35), tint.opacity(0)], startPoint: .top, endPoint: .bottom))
                    SparkShape(points: points, closed: false)
                        .stroke(tint, style: StrokeStyle(lineWidth: 2.5, lineCap: .round, lineJoin: .round))
                        .shadow(color: tint.opacity(0.5), radius: 5)
                    if let last = points.last {
                        LiveDot(color: tint)
                            .position(last)
                    }
                } else {
                    Text("Waiting for heart rate...")
                        .font(.footnote)
                        .foregroundStyle(Brand.ink300)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .frame(width: size.width, height: size.height)
        }
    }
}

/** A smooth line through points. Each segment is curved through the middle of its neighbours, which removes the jagged corners. */
private struct SparkShape: Shape {
    let points: [CGPoint]
    let closed: Bool

    func path(in rect: CGRect) -> Path {
        var path = Path()
        guard let first = points.first, let last = points.last else { return path }
        if closed {
            path.move(to: CGPoint(x: first.x, y: rect.maxY))
            path.addLine(to: first)
        } else {
            path.move(to: first)
        }
        for index in 1..<points.count {
            let previous = points[index - 1]
            let current = points[index]
            let middle = CGPoint(x: (previous.x + current.x) / 2, y: (previous.y + current.y) / 2)
            path.addQuadCurve(to: middle, control: previous)
        }
        path.addLine(to: last)
        if closed {
            path.addLine(to: CGPoint(x: last.x, y: rect.maxY))
            path.closeSubpath()
        }
        return path
    }
}
