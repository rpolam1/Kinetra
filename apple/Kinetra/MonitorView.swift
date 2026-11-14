import SwiftUI

/** Shows the person's live heart rate, how it has moved, and the controls for the watch workout. */
struct MonitorView: View {
    @Environment(AppModel.self) private var model
    @State private var startTaps = 0
    @State private var shown = false

    private var reading: HeartReading { model.reading }
    private var tint: Color { reading.status.tint }
    private var streaming: Bool { reading.status != .noSignal }
    private var values: [Int] { model.history.map(\.bpm) }

    var body: some View {
        ScrollView {
            VStack(spacing: 18) {
                if let person = model.pairing?.person {
                    header(person)
                        .staggeredEntrance(index: 0, shown: shown)
                }

                HeartGauge(bpm: reading.bpm, reading: reading, lineWidth: 18)
                    .frame(maxWidth: 320)
                    .padding(.vertical, 6)
                    .staggeredEntrance(index: 1, shown: shown)

                statusBanner
                    .staggeredEntrance(index: 2, shown: shown)

                trendCard
                    .staggeredEntrance(index: 3, shown: shown)

                HStack(spacing: 12) {
                    StatTile(title: "Lowest", value: values.min(), tint: HeartStatus.below.tint)
                    StatTile(title: "Average", value: values.isEmpty ? nil : values.reduce(0, +) / values.count)
                    StatTile(title: "Highest", value: values.max(), tint: HeartStatus.above.tint)
                }
                .staggeredEntrance(index: 4, shown: shown)

                watchCard
                    .staggeredEntrance(index: 5, shown: shown)

                if let message = model.lastLaunchError {
                    ErrorBanner(message: message)
                }

                Button("Choose someone else") { model.changePerson() }
                    .buttonStyle(GhostButtonStyle())
                    .padding(.top, 4)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 36)
            .animation(.smooth, value: model.lastLaunchError)
        }
        .scrollIndicators(.hidden)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                HubChip(name: model.hubName, online: model.hubOnline)
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Choose someone else", systemImage: "person.2") { model.changePerson() }
                    Button("Change hub", systemImage: "wifi.router") { model.changeHub() }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .task {
            shown = true
            await model.pollReading()
        }
        // The phone gives a tap when the zone changes, so a glance at the screen is not always needed
        .sensoryFeedback(trigger: reading.status) { _, new in
            switch new {
            case .high: return .error
            case .above: return .warning
            case .inZone: return .success
            default: return nil
            }
        }
        .sensoryFeedback(.impact(weight: .medium), trigger: startTaps)
    }

    private func header(_ person: SelectedPerson) -> some View {
        HStack(spacing: 14) {
            Avatar(name: person.displayName, size: 56)
            VStack(alignment: .leading, spacing: 5) {
                Text(person.displayName)
                    .font(.system(.title3, design: .rounded, weight: .bold))
                    .foregroundStyle(.white)
                Text("Wear the watch and hold tag \(person.tagId) where the camera can see it.")
                    .font(.footnote)
                    .foregroundStyle(Brand.ink200)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 4)
            TagThumbnail(url: model.tagImageURL(person.tagId, size: 320), size: 54)
        }
        .cardStyle(padding: 14)
    }

    // The banner takes the colour of the zone, so the state reads from across a room
    private var statusBanner: some View {
        HStack(spacing: 14) {
            Image(systemName: reading.status.symbol)
                .font(.system(size: 28))
                .foregroundStyle(tint)
                .symbolEffect(.bounce, value: reading.status)
                .frame(width: 36)
            VStack(alignment: .leading, spacing: 3) {
                Text(reading.status.title)
                    .font(.system(.headline, design: .rounded))
                    .foregroundStyle(.white)
                Text(reading.message)
                    .font(.subheadline)
                    .foregroundStyle(Brand.ink100.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .cardStyle(padding: 16, tint: tint)
        .animation(.smooth, value: reading.status)
        .accessibilityElement(children: .combine)
    }

    private var trendCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("RECENT")
                    .font(.system(.caption, design: .rounded, weight: .semibold))
                    .tracking(1.2)
                    .foregroundStyle(Brand.ink300)
                Spacer()
                if let zone = reading.zone, reading.status != .unreliable {
                    Text("Target \(zone.low) to \(zone.high)")
                        .font(.system(.caption, design: .rounded, weight: .semibold))
                        .foregroundStyle(HeartStatus.inZone.tint)
                }
            }
            Sparkline(values: values, zone: reading.status == .unreliable ? nil : reading.zone, tint: tint)
                .frame(height: 110)
        }
        .cardStyle()
    }

    private var watchCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Image(systemName: watchSymbol)
                    .font(.title3)
                    .foregroundStyle(watchTint)
                    .frame(width: 36, height: 36)
                    .background(watchTint.opacity(0.14), in: RoundedRectangle(cornerRadius: 11, style: .continuous))
                    .symbolEffect(.pulse, isActive: streaming)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Apple Watch")
                        .font(.system(.caption, design: .rounded, weight: .semibold))
                        .tracking(1)
                        .foregroundStyle(Brand.ink300)
                    Text(watchText)
                        .font(.system(.subheadline, design: .rounded, weight: .medium))
                        .foregroundStyle(.white)
                        .contentTransition(.opacity)
                }
                Spacer()
                if streaming { LiveDot() }
            }

            if streaming {
                Button {
                    model.endOnWatch()
                } label: {
                    Label("End workout", systemImage: "stop.circle")
                }
                .buttonStyle(SoftButtonStyle(tint: HeartStatus.high.tint))
                .disabled(!model.link.isReachable)
                .transition(.opacity.combined(with: .scale(scale: 0.96)))
            } else {
                Button {
                    startTaps += 1
                    Task { await model.startOnWatch() }
                } label: {
                    Label("Start on Apple Watch", systemImage: "applewatch.watchface")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(!model.link.isPaired || !model.link.isWatchAppInstalled)
                .transition(.opacity.combined(with: .scale(scale: 0.96)))
            }
        }
        .cardStyle()
        .animation(.smooth, value: streaming)
        .animation(.smooth, value: watchText)
    }

    // The order matters, because each problem hides the ones after it
    private var watchText: String {
        if !model.link.isPaired { return "No Apple Watch is paired with this phone" }
        if !model.link.isWatchAppInstalled { return "Install the Kinetra app on the watch" }
        if streaming { return "Sending heart rate" }
        return model.link.isReachable ? "Ready. Tap Start" : "Nearby but not reachable"
    }

    private var watchSymbol: String {
        if !model.link.isPaired || !model.link.isWatchAppInstalled { return "exclamationmark.triangle.fill" }
        return streaming ? "waveform.path.ecg" : "applewatch"
    }

    private var watchTint: Color {
        if !model.link.isPaired || !model.link.isWatchAppInstalled { return HeartStatus.above.tint }
        return streaming ? HeartStatus.inZone.tint : Brand.mint
    }
}
