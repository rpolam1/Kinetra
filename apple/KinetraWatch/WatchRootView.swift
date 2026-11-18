import SwiftUI

struct WatchRootView: View {
    @Environment(WatchModel.self) private var model

    var body: some View {
        NavigationStack {
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
        .tint(Brand.mint)
        .containerBackground(Brand.ink900.gradient, for: .navigation)
    }
}

struct SetupNeededView: View {
    var body: some View {
        VStack(spacing: 8) {
            PulseLogo(height: 24)
            Text("Set up on iPhone")
                .font(.system(.headline, design: .rounded))
            Text("Open Kinetra on your iPhone, connect to the hub and choose who is exercising.")
                .font(.footnote)
                .foregroundStyle(Brand.ink200)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}

struct StartingView: View {
    var body: some View {
        VStack(spacing: 10) {
            PulseLogo(height: 24)
            Text("Starting workout")
                .font(.system(.footnote, design: .rounded, weight: .semibold))
                .foregroundStyle(Brand.ink200)
            ProgressView().tint(Brand.mint)
        }
    }
}

struct ReadyView: View {
    @Environment(WatchModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                if let person = model.pairing?.person {
                    Avatar(name: person.displayName, size: 52)
                    VStack(spacing: 2) {
                        Text(person.displayName)
                            .font(.system(.headline, design: .rounded))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        Label("Tag \(person.tagId)", systemImage: "qrcode")
                            .font(.system(.caption2, design: .rounded, weight: .medium))
                            .foregroundStyle(Brand.ink200)
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
                    Label("Start", systemImage: "heart.fill")
                        .font(.system(.headline, design: .rounded))
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Brand.teal)

                Button("Change person") { model.changePerson() }
                    .font(.system(.caption2, design: .rounded, weight: .medium))
                    .foregroundStyle(Brand.ink200)
                    .buttonStyle(.plain)
            }
            .padding(.top, 2)
        }
        .navigationTitle("Kinetra")
    }
}

struct RunningView: View {
    var body: some View {
        TabView {
            LiveHeartPage()
            DetailsPage()
        }
        .tabViewStyle(.verticalPage)
        .navigationBarBackButtonHidden(true)
    }
}

struct LiveHeartPage: View {
    @Environment(WatchModel.self) private var model

    private var status: HeartStatus { model.reading.status }

    var body: some View {
        VStack(spacing: 6) {
            HeartGauge(bpm: model.displayedBpm, reading: model.reading, lineWidth: 11, showsCaption: false)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            Label(status.title, systemImage: status.symbol)
                .font(.system(.footnote, design: .rounded, weight: .bold))
                .foregroundStyle(status.tint)
                .padding(.horizontal, 10)
                .padding(.vertical, 3)
                .background(status.tint.opacity(0.18), in: Capsule())
            if let problem = model.hubProblem {
                Text(problem)
                    .font(.system(size: 10))
                    .foregroundStyle(HeartStatus.above.tint)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
            if let started = model.startedAt {
                TimelineView(.periodic(from: started, by: 1)) { context in
                    if model.localBpm == nil, context.date.timeIntervalSince(started) > 20 {
                        Text("No heart rate yet. Wear the watch snug and check Health access for Kinetra on your iPhone.")
                            .font(.system(size: 10))
                            .foregroundStyle(HeartStatus.above.tint)
                            .multilineTextAlignment(.center)
                            .lineLimit(3)
                    }
                }
            }
        }
        .padding(.horizontal, 4)
        .animation(.smooth(duration: 0.5), value: status)
    }
}

struct DetailsPage: View {
    @Environment(WatchModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                if let started = model.startedAt {
                    TimelineView(.periodic(from: started, by: 1)) { context in
                        Text(HeartMath.elapsedText(context.date.timeIntervalSince(started)))
                            .font(.system(size: 34, weight: .semibold, design: .rounded))
                            .monospacedDigit()
                    }
                }
                if let zone = model.reading.zone, model.reading.status != .unreliable {
                    Label("Zone \(zone.low) to \(zone.high)", systemImage: "scope")
                        .font(.system(.caption, design: .rounded, weight: .semibold))
                        .foregroundStyle(HeartStatus.inZone.tint)
                }
                Text(model.reading.status.coachingLine)
                    .font(.caption2)
                    .foregroundStyle(Brand.ink200)
                    .multilineTextAlignment(.center)
                HStack(spacing: 6) {
                    LiveDot(color: model.isConnected ? HeartStatus.inZone.tint : HeartStatus.above.tint, active: model.isConnected)
                    Text(model.isConnected ? "Live" : "Offline")
                        .font(.system(.caption2, design: .rounded, weight: .semibold))
                        .foregroundStyle(Brand.ink100)
                }
                Button(role: .destructive) {
                    Task { await model.end() }
                } label: {
                    Label("End workout", systemImage: "stop.fill")
                        .frame(maxWidth: .infinity)
                }
                .padding(.top, 4)
            }
        }
    }
}

struct SummaryView: View {
    @Environment(WatchModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Label("Workout done", systemImage: "checkmark.circle.fill")
                    .font(.system(.headline, design: .rounded))
                    .foregroundStyle(HeartStatus.inZone.tint)
                if let summary = model.summary {
                    VStack(spacing: 0) {
                        Text("\(summary.averageBpm)")
                            .font(.system(size: 46, weight: .bold, design: .rounded))
                            .monospacedDigit()
                        Text("AVERAGE BPM")
                            .font(.system(size: 10, weight: .semibold, design: .rounded))
                            .tracking(1)
                            .foregroundStyle(Brand.ink200)
                    }
                    stat("Highest", "\(summary.maxBpm) bpm")
                    stat("Lowest", "\(summary.minBpm) bpm")
                    if let share = summary.inZoneShare {
                        stat("In your zone", "\(Int((share * 100).rounded()))%")
                    }
                    stat("Time", HeartMath.elapsedText(summary.durationSeconds))
                } else {
                    Text("No heart rate was recorded.")
                        .font(.footnote)
                        .foregroundStyle(Brand.ink200)
                }
                Button("Done") { model.dismissSummary() }
                    .buttonStyle(.borderedProminent)
                    .tint(Brand.teal)
                    .padding(.top, 4)
            }
        }
        .navigationBarBackButtonHidden(true)
    }

    private func stat(_ title: String, _ value: String) -> some View {
        HStack {
            Text(title).font(.footnote).foregroundStyle(Brand.ink200)
            Spacer()
            Text(value).font(.footnote.weight(.semibold)).monospacedDigit()
        }
    }
}

struct WatchPersonPicker: View {
    @Environment(WatchModel.self) private var model

    private var available: [RosterPerson] { model.people.filter(\.inSession) }

    var body: some View {
        List {
            if let message = model.errorMessage {
                Text(message).font(.caption2).foregroundStyle(HeartStatus.high.tint)
            }
            if model.isLoadingPeople && model.people.isEmpty {
                ProgressView().tint(Brand.mint)
            }
            ForEach(available) { person in
                Button {
                    model.choose(person)
                } label: {
                    HStack(spacing: 8) {
                        Avatar(name: person.displayName, size: 32)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(person.displayName)
                                .font(.system(.headline, design: .rounded))
                                .lineLimit(1)
                            Text("Tag \(person.tagId)")
                                .font(.caption2)
                                .foregroundStyle(Brand.ink200)
                        }
                    }
                }
            }
            if !model.isLoadingPeople && available.isEmpty && model.errorMessage == nil {
                Text(model.people.isEmpty ? "No one is registered yet." : "No one is in a session yet. Start one in the web app.")
                    .font(.footnote)
                    .foregroundStyle(Brand.ink200)
                Button("Refresh") { Task { await model.loadPeople() } }
            }
        }
        .navigationTitle("Who are you?")
        .task { await model.loadPeople() }
    }
}
