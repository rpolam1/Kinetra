import SwiftUI

struct PrimaryButtonStyle: ButtonStyle {
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 16)
            .foregroundStyle(.white)
            .background(Brand.teal.opacity(isEnabled ? (configuration.isPressed ? 0.8 : 1) : 0.4), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct SecondaryButtonStyle: ButtonStyle {
    var tint: Color = Brand.teal

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.headline)
            .frame(maxWidth: .infinity)
            .padding(.vertical, 14)
            .foregroundStyle(tint)
            .background(tint.opacity(configuration.isPressed ? 0.18 : 0.1), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
}

struct ErrorBanner: View {
    let message: String

    var body: some View {
        Label(message, systemImage: "exclamationmark.triangle.fill")
            .font(.subheadline)
            .foregroundStyle(.red)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .background(Color.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

struct TagThumbnail: View {
    let url: URL?
    var size: CGFloat = 56

    var body: some View {
        AsyncImage(url: url) { phase in
            switch phase {
            case .success(let image):
                image.resizable().interpolation(.none).scaledToFit()
            case .failure:
                Image(systemName: "qrcode").font(.title2).foregroundStyle(.secondary)
            default:
                ProgressView()
            }
        }
        .frame(width: size, height: size)
        .padding(4)
        .background(.white, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(Color.secondary.opacity(0.3), lineWidth: 1))
        .accessibilityHidden(true)
    }
}

struct Badge: View {
    let text: String
    let symbol: String
    let tint: Color

    var body: some View {
        Label(text, systemImage: symbol)
            .font(.caption2.weight(.semibold))
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .foregroundStyle(tint)
            .background(tint.opacity(0.12), in: Capsule())
    }
}

struct ZoneGauge: View {
    let reading: HeartReading

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            ZStack(alignment: .leading) {
                Capsule().fill(Color.secondary.opacity(0.18))
                if let zone = reading.zone {
                    let band = HeartMath.zoneBand(zone)
                    Capsule()
                        .fill(Color.green.opacity(0.35))
                        .frame(width: width * (band.upperBound - band.lowerBound))
                        .offset(x: width * band.lowerBound)
                }
                if let bpm = reading.bpm {
                    Circle()
                        .fill(reading.status.tint)
                        .frame(width: 18, height: 18)
                        .overlay(Circle().stroke(.white, lineWidth: 2))
                        .offset(x: max(0, min(width - 18, width * HeartMath.position(bpm: bpm, zone: reading.zone) - 9)))
                        .animation(.easeOut(duration: 0.4), value: bpm)
                }
            }
        }
        .frame(height: 18)
        .accessibilityHidden(true)
    }
}

struct HeartCard: View {
    let reading: HeartReading

    private var tint: Color { reading.status.tint }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "heart.fill")
                    .font(.title2)
                    .foregroundStyle(tint)
                    .symbolEffect(.pulse, isActive: reading.status != .noSignal)
                Text(reading.bpm.map(String.init) ?? "--")
                    .font(.system(size: 64, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                Text("bpm").font(.title3.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
            }
            Label(reading.status.title, systemImage: reading.status.symbol)
                .font(.headline)
                .foregroundStyle(tint)
            Text(reading.message)
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if reading.zone != nil, reading.status != .unreliable {
                ZoneGauge(reading: reading)
                if let zone = reading.zone {
                    HStack {
                        Text("Resting \(zone.resting)")
                        Spacer()
                        Text("Target \(zone.low) to \(zone.high)").foregroundStyle(.green)
                        Spacer()
                        Text("Max \(zone.max)")
                    }
                    .font(.caption)
                    .foregroundStyle(.secondary)
                }
            }
        }
        .padding(20)
        .background(tint.opacity(0.1), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Heart rate \(reading.bpm.map(String.init) ?? "unknown") beats per minute. \(reading.status.title). \(reading.message)")
    }
}
