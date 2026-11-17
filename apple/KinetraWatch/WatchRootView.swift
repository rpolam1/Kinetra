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
                ProgressView("Starting").tint(Brand.teal)
            case .running:
                RunningView()
            case .summary:
                SummaryView()
            }
        }
        .tint(Brand.teal)
    }
}

struct SetupNeededView: View {
    var body: some View {
        VStack(spacing: 8) {
            Image(systemName: "iphone.and.arrow.forward")
                .font(.title)
                .foregroundStyle(Brand.teal)
            Text("Set up on iPhone")
                .font(.headline)
            Text("Open Kinetra on your iPhone, connect to the hub and choose who is exercising.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}

struct Avatar: View {
    let name: String

    var body: some View {
        ZStack {
            Circle().fill(Brand.teal.gradient)
            Text(String(name.prefix(1)).uppercased())
                .font(.system(.title3, design: .rounded, weight: .bold))
                .foregroundStyle(.white)
        }
    }
}

struct ReadyView: View {
    @Environment(WatchModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                if let person = model.pairing?.person {
                    Avatar(name: person.displayName)
                        .frame(width: 46, height: 46)
                    VStack(spacing: 1) {
                        Text(person.displayName)
                            .font(.system(.headline, design: .rounded))
                            .lineLimit(1)
                            .minimumScaleFactor(0.7)
                        Label("Tag \(person.tagId)", systemImage: "qrcode")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
                if let message = model.errorMessage {
                    Text(message).font(.caption2).foregroundStyle(.red).multilineTextAlignment(.center)
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
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            .padding(.top, 2)
        }
        .navigationTitle("Kinetra")
    }
}

struct HeartRing: View {
    let bpm: Int?
    let reading: HeartReading

    private var tint: Color { reading.status.tint }

    var body: some View {
        ZStack {
            Circle().stroke(Color.white.opacity(0.15), lineWidth: 12)
            if let zone = reading.zone, reading.status != .unreliable {
                let band = HeartMath.zoneBand(zone)
                Circle()
                    .trim(from: band.lowerBound, to: band.upperBound)
                    .stroke(Color.green.opacity(0.35), style: StrokeStyle(lineWidth: 12, lineCap: .butt))
                    .rotationEffect(.degrees(-90))
            }
            if let bpm {
                Circle()
                    .trim(from: 0, to: max(0.02, HeartMath.position(bpm: bpm, zone: reading.zone)))
                    .stroke(tint, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                    .animation(.easeOut(duration: 0.4), value: bpm)
            }
            VStack(spacing: 0) {
                Image(systemName: "heart.fill")
                    .font(.caption)
                    .foregroundStyle(tint)
                    .symbolEffect(.pulse, isActive: bpm != nil)
                Text(bpm.map(String.init) ?? "--")
                    .font(.system(size: 44, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .contentTransition(.numericText())
                Text("BPM")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(.secondary)
            }
        }
        .padding(8)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Heart rate \(bpm.map(String.init) ?? "unknown") beats per minute. \(reading.status.title)")
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
        VStack(spacing: 4) {
            HeartRing(bpm: model.displayedBpm, reading: model.reading)
                .frame(maxHeight: .infinity)
            Label(status.title, systemImage: status.symbol)
                .font(.system(.footnote, design: .rounded, weight: .bold))
                .foregroundStyle(status.tint)
                .padding(.horizontal, 10)
                .padding(.vertical, 3)
                .background(status.tint.opacity(0.18), in: Capsule())
            if let problem = model.hubProblem {
                Text(problem)
                    .font(.system(size: 10))
                    .foregroundStyle(.orange)
                    .multilineTextAlignment(.center)
                    .lineLimit(3)
            }
            if let started = model.startedAt {
                TimelineView(.periodic(from: started, by: 1)) { context in
                    if model.localBpm == nil, context.date.timeIntervalSince(started) > 20 {
                        Text("No heart rate yet. Wear the watch snug and check Health access for Kinetra on your iPhone.")
                            .font(.system(size: 10))
                            .foregroundStyle(.orange)
                            .multilineTextAlignment(.center)
                            .lineLimit(3)
                    }
                }
            }
        }
        .padding(.horizontal, 4)
        .background {
            LinearGradient(colors: [status.tint.opacity(0.30), .clear], startPoint: .top, endPoint: .center)
                .ignoresSafeArea()
        }
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
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.green)
                }
                Text(model.reading.status.coachingLine)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
                Label(model.isConnected ? "Live" : "Offline", systemImage: model.isConnected ? "wifi" : "wifi.slash")
                    .font(.caption2)
                    .foregroundStyle(model.isConnected ? Color.green : Color.orange)
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
                    .font(.headline)
                    .foregroundStyle(.green)
                if let summary = model.summary {
                    VStack(spacing: 0) {
                        Text("\(summary.averageBpm)")
                            .font(.system(size: 46, weight: .bold, design: .rounded))
                            .monospacedDigit()
                        Text("AVERAGE BPM")
                            .font(.system(size: 10, weight: .semibold))
                            .foregroundStyle(.secondary)
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
                        .foregroundStyle(.secondary)
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
            Text(title).font(.footnote).foregroundStyle(.secondary)
            Spacer()
            Text(value).font(.footnote.weight(.semibold)).monospacedDigit()
        }
    }
}

struct WatchPersonPicker: View {
    @Environment(WatchModel.self) private var model

    var body: some View {
        List {
            if let message = model.errorMessage {
                Text(message).font(.caption2).foregroundStyle(.red)
            }
            if model.isLoadingPeople && model.people.isEmpty {
                ProgressView()
            }
            ForEach(model.people.filter(\.inSession)) { person in
                Button {
                    model.choose(person)
                } label: {
                    HStack(spacing: 8) {
                        Avatar(name: person.displayName)
                            .frame(width: 30, height: 30)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(person.displayName)
                                .font(.system(.headline, design: .rounded))
                                .lineLimit(1)
                            HStack(spacing: 6) {
                                Text("Tag \(person.tagId)").font(.caption2).foregroundStyle(.secondary)
                                if person.inSession {
                                    Text("In session").font(.caption2).foregroundStyle(.green)
                                }
                            }
                        }
                    }
                }
            }
            if !model.isLoadingPeople && !model.people.contains(where: \.inSession) && model.errorMessage == nil {
                Text(model.people.isEmpty ? "No one is registered yet." : "No one is in a session yet. Start one in the web app.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
                Button("Refresh") { Task { await model.loadPeople() } }
            }
        }
        .navigationTitle("Who are you?")
        .task { await model.loadPeople() }
    }
}