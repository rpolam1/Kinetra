import SwiftUI
import WatchKit

/** Picks the watch screen from the current phase. */
struct WatchRootView: View {
    @Environment(WatchModel.self) private var model

    var body: some View {
        NavigationStack {
            Group {
                switch model.phase {
                case .needsSetup:
                    SetupNeededView()
                case .choosing:
                    WatchPersonPicker()
                case .ready:
                    ReadyView()
                case .starting:
                    StartingView()
                case .running:
                    RunningView()
                case .summary:
                    SummaryView()
                }
            }
            .containerBackground(for: .navigation) { WatchBackdrop(tint: Brand.teal) }
        }
        .tint(Brand.mint)
        .animation(.smooth(duration: 0.4), value: model.phase)
    }
}

/** The background. It carries a glow in the colour of the heart rate zone, and goes black when the screen is dimmed. */
struct WatchBackdrop: View {
    var tint: Color
    var urgent = false

    @Environment(\.isLuminanceReduced) private var dimmed

    var body: some View {
        if dimmed {
            Color.black
        } else {
            ZStack {
                Brand.ink900
                RadialGradient(colors: [tint.opacity(0.38), .clear], center: .top, startRadius: 0, endRadius: 170)
                // A very high heart rate makes the whole screen throb, so it is noticed without looking closely
                if urgent {
                    TimelineView(.animation(minimumInterval: 1.0 / 15.0)) { context in
                        let wave = 0.5 + 0.5 * sin(context.date.timeIntervalSinceReferenceDate * 5)
                        tint.opacity(0.08 + 0.2 * wave)
                    }
                }
            }
            .animation(.easeInOut(duration: 0.6), value: tint)
        }
    }
}

/** Tells the person to finish setup on the iPhone. */
struct SetupNeededView: View {
    var body: some View {
        VStack(spacing: 10) {
            PulseLogo(height: 26)
            Text("Set up on iPhone")
                .font(.system(.headline, design: .rounded))
            Text("Open Kinetra on your iPhone, connect to the hub and choose who is exercising.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding(.horizontal, 6)
    }
}

/** The start button. A ring spreads out from it so it looks alive, and it presses in when tapped. */
private struct StartButtonStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .foregroundStyle(.white)
            .background {
                ZStack {
                    Capsule()
                        .fill(Brand.teal.opacity(0.55))
                        .phaseAnimator([false, true]) { view, phase in
                            view.scaleEffect(x: phase ? 1.07 : 1, y: phase ? 1.32 : 1).opacity(phase ? 0 : 0.7)
                        } animation: { _ in .easeOut(duration: 1.8) }
                    Capsule()
                        .fill(LinearGradient(colors: [Color(hex: 0x2CA797), Brand.teal], startPoint: .top, endPoint: .bottom))
                }
            }
            .scaleEffect(configuration.isPressed ? 0.94 : 1)
            .animation(.spring(response: 0.25, dampingFraction: 0.6), value: configuration.isPressed)
    }
}

/** The start screen with the person's name, the hub status and one big button. */
struct ReadyView: View {
    @Environment(WatchModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if let person = model.pairing?.person {
                    HStack(spacing: 8) {
                        Avatar(name: person.displayName, size: 34)
                        VStack(alignment: .leading, spacing: 1) {
                            Text(person.displayName)
                                .font(.system(.headline, design: .rounded))
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                            Text("Tag \(person.tagId)")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer(minLength: 0)
                    }
                }

                if let message = model.errorMessage {
                    Text(message)
                        .font(.caption2)
                        .foregroundStyle(HeartStatus.high.tint)
                        .multilineTextAlignment(.center)
                }

                Button {
                    Task { await model.start() }
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "heart.fill").symbolEffect(.pulse)
                        Text("Start").font(.system(.title3, design: .rounded, weight: .bold))
                    }
                    .frame(maxWidth: .infinity)
                    .frame(height: 54)
                }
                .buttonStyle(StartButtonStyle())
                .padding(.vertical, 6)

                hubStatus

                Button("Change person") { model.changePerson() }
                    .font(.footnote)
                    .foregroundStyle(Brand.ink200)
            }
            .padding(.horizontal, 4)
        }
        .task { await model.checkHub() }
        .sensoryFeedback(.success, trigger: model.hubReachable) { _, new in new == true }
    }

    // The result tells the person early if the hub is off, instead of finding out after a workout
    @ViewBuilder
    private var hubStatus: some View {
        switch model.hubReachable {
        case .some(true):
            HStack(spacing: 6) {
                LiveDot()
                Text("Hub ready").font(.caption2).foregroundStyle(.secondary)
            }
        case .some(false):
            Button {
                Task { await model.checkHub() }
            } label: {
                HStack(spacing: 6) {
                    LiveDot(color: HeartStatus.above.tint, active: false)
                    Text("Hub not found. Tap to retry").font(.caption2).foregroundStyle(HeartStatus.above.tint)
                }
            }
            .buttonStyle(.plain)
        case .none:
            HStack(spacing: 6) {
                ProgressView().scaleEffect(0.6).frame(width: 12, height: 12)
                Text("Checking hub").font(.caption2).foregroundStyle(.secondary)
            }
        }
    }
}

/** Shown for the moment between pressing start and the first heart rate. */
struct StartingView: View {
    @State private var spin = false

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle().stroke(Brand.ink600, lineWidth: 6)
                Circle()
                    .trim(from: 0, to: 0.28)
                    .stroke(Brand.mint, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                    .rotationEffect(.degrees(spin ? 360 : 0))
                Image(systemName: "heart.fill")
                    .font(.title3)
                    .foregroundStyle(Brand.mint)
                    .symbolEffect(.pulse)
            }
            .frame(width: 70, height: 70)
            Text("Starting")
                .font(.system(.headline, design: .rounded))
        }
        .onAppear {
            withAnimation(.linear(duration: 1.1).repeatForever(autoreverses: false)) { spin = true }
        }
    }
}

/** The workout screen. The first page is the heart rate gauge. Swiping up shows the timer and the end button, so the workout cannot be ended by a stray tap. */
struct RunningView: View {
    @Environment(WatchModel.self) private var model
    @State private var confirmEnd = false

    private var reading: HeartReading { model.reading }
    private var tint: Color { reading.status.tint }

    var body: some View {
        TabView {
            gaugePage
            detailsPage
        }
        .tabViewStyle(.verticalPage)
        .containerBackground(for: .tabView) { WatchBackdrop(tint: tint, urgent: reading.status == .high) }
        .navigationBarBackButtonHidden(true)
        .confirmationDialog("End the workout?", isPresented: $confirmEnd, titleVisibility: .visible) {
            Button("End workout", role: .destructive) { Task { await model.end() } }
            Button("Keep going", role: .cancel) {}
        }
    }

    private var gaugePage: some View {
        VStack(spacing: 4) {
            HeartGauge(bpm: model.displayedBpm, reading: reading, lineWidth: 10, showsCaption: false)
                .padding(.horizontal, 4)
            Label(reading.status.title, systemImage: reading.status.symbol)
                .font(.system(.footnote, design: .rounded, weight: .semibold))
                .foregroundStyle(tint)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
                .symbolEffect(.bounce, value: reading.status)
        }
    }

    private var detailsPage: some View {
        ScrollView {
            VStack(spacing: 10) {
                if let started = model.startedAt {
                    TimelineView(.periodic(from: started, by: 1)) { context in
                        Text(HeartMath.elapsedText(context.date.timeIntervalSince(started)))
                            .font(.system(size: 38, weight: .bold, design: .rounded))
                            .monospacedDigit()
                    }
                }

                HStack(spacing: 6) {
                    LiveDot(color: model.isConnected ? HeartStatus.inZone.tint : HeartStatus.above.tint, active: model.isConnected)
                    Text(model.isConnected ? "Sending to hub" : "Hub offline, saving")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                }

                if let zone = reading.zone, reading.status != .unreliable {
                    Text("Target \(zone.low) to \(zone.high)")
                        .font(.system(.footnote, design: .rounded, weight: .semibold))
                        .foregroundStyle(HeartStatus.inZone.tint)
                }

                Text(reading.status.coachingLine)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                Button(role: .destructive) {
                    confirmEnd = true
                } label: {
                    Label("End workout", systemImage: "stop.fill")
                }
                .padding(.top, 4)
            }
        }
    }
}

/** A number that counts up to its value when it is animated. */
private struct CountingText: View, Animatable {
    var value: Double

    var animatableData: Double {
        get { value }
        set { value = newValue }
    }

    var body: some View {
        Text("\(Int(value.rounded()))")
    }
}

/** The totals shown when the workout ends. The numbers count up and the zone bar fills. */
struct SummaryView: View {
    @Environment(WatchModel.self) private var model
    @State private var revealed = false

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                Label("Workout done", systemImage: "checkmark.circle.fill")
                    .font(.system(.headline, design: .rounded))
                    .foregroundStyle(HeartStatus.inZone.tint)
                    .symbolEffect(.bounce, value: revealed)

                if let summary = model.summary {
                    VStack(spacing: 0) {
                        HStack(alignment: .firstTextBaseline, spacing: 4) {
                            CountingText(value: revealed ? Double(summary.averageBpm) : 0)
                                .font(.system(size: 52, weight: .bold, design: .rounded))
                                .monospacedDigit()
                            Text("bpm")
                                .font(.system(.footnote, design: .rounded, weight: .semibold))
                                .foregroundStyle(.secondary)
                        }
                        Text("Average")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }

                    if let share = summary.inZoneShare {
                        VStack(spacing: 5) {
                            GeometryReader { proxy in
                                Capsule().fill(Brand.ink600)
                                    .overlay(alignment: .leading) {
                                        Capsule()
                                            .fill(HeartStatus.inZone.tint)
                                            .frame(width: proxy.size.width * (revealed ? share : 0))
                                    }
                            }
                            .frame(height: 8)
                            Text("\(Int((share * 100).rounded()))% in your zone")
                                .font(.system(.caption, design: .rounded, weight: .semibold))
                                .foregroundStyle(HeartStatus.inZone.tint)
                        }
                    }

                    HStack(spacing: 8) {
                        tile("Highest", "\(summary.maxBpm)")
                        tile("Lowest", "\(summary.minBpm)")
                    }
                    tile("Time", HeartMath.elapsedText(summary.durationSeconds))
                } else {
                    Text("No heart rate was recorded.")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                }

                Button("Done") { model.dismissSummary() }
                    .buttonStyle(.borderedProminent)
                    .tint(Brand.teal)
                    .padding(.top, 4)
            }
        }
        .navigationBarBackButtonHidden(true)
        .onAppear {
            withAnimation(.easeOut(duration: 1.1)) { revealed = true }
        }
    }

    private func tile(_ title: String, _ value: String) -> some View {
        VStack(spacing: 2) {
            Text(value)
                .font(.system(.title3, design: .rounded, weight: .bold))
                .monospacedDigit()
            Text(title)
                .font(.caption2)
                .foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 8)
        .background(Brand.ink700.opacity(0.8), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

/** The list of people shown when the watch has to be set to someone. People in the session come first. */
struct WatchPersonPicker: View {
    @Environment(WatchModel.self) private var model
    @State private var selected: String?

    private var ordered: [RosterPerson] {
        model.people.filter(\.inSession) + model.people.filter { !$0.inSession }
    }

    var body: some View {
        List {
            if let message = model.errorMessage {
                Text(message)
                    .font(.caption2)
                    .foregroundStyle(HeartStatus.high.tint)
                    .listRowBackground(Color.clear)
            }
            if model.isLoadingPeople && model.people.isEmpty {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Looking").font(.footnote).foregroundStyle(.secondary)
                }
                .listRowBackground(Color.clear)
            }
            ForEach(ordered) { person in
                Button {
                    selected = person.id
                    model.choose(person)
                } label: {
                    HStack(spacing: 8) {
                        Avatar(name: person.displayName, size: 32)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(person.displayName)
                                .font(.system(.headline, design: .rounded))
                                .lineLimit(1)
                            HStack(spacing: 5) {
                                Text("Tag \(person.tagId)")
                                if person.inSession {
                                    LiveDot()
                                    Text("In session")
                                }
                            }
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        }
                    }
                }
                .listRowBackground(RoundedRectangle(cornerRadius: 14, style: .continuous).fill(Brand.ink700.opacity(0.85)))
            }
            if !model.isLoadingPeople && model.people.isEmpty && model.errorMessage == nil {
                Text("No one is registered yet.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                    .listRowBackground(Color.clear)
            }
        }
        .navigationTitle("Who are you?")
        .task { await model.loadPeople() }
        .sensoryFeedback(.selection, trigger: selected)
    }
}
