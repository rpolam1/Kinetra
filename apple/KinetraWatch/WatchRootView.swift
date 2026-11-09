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

struct ReadyView: View {
    @Environment(WatchModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(spacing: 10) {
                if let person = model.pairing?.person {
                    VStack(spacing: 2) {
                        Text(person.displayName)
                            .font(.title3.bold())
                            .multilineTextAlignment(.center)
                        Label("Tag \(person.tagId)", systemImage: "qrcode")
                            .font(.footnote.weight(.medium))
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
                        .font(.headline)
                }
                .buttonStyle(.borderedProminent)
                .tint(Brand.teal)

                Button("Change person") { model.changePerson() }
                    .font(.footnote)
            }
            .padding(.top, 4)
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
    @Environment(WatchModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                HeartRing(bpm: model.displayedBpm, reading: model.reading)
                    .frame(height: 130)

                Label(model.reading.status.title, systemImage: model.reading.status.symbol)
                    .font(.headline)
                    .foregroundStyle(model.reading.status.tint)

                Text(model.reading.status.coachingLine)
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)

                if let zone = model.reading.zone, model.reading.status != .unreliable {
                    Text("Zone \(zone.low) to \(zone.high)")
                        .font(.caption2.weight(.medium))
                        .foregroundStyle(.green)
                }

                HStack(spacing: 10) {
                    if let started = model.startedAt {
                        TimelineView(.periodic(from: started, by: 1)) { context in
                            Label(HeartMath.elapsedText(context.date.timeIntervalSince(started)), systemImage: "timer")
                                .monospacedDigit()
                        }
                    }
                    Label(model.isConnected ? "Live" : "Offline", systemImage: model.isConnected ? "wifi" : "wifi.slash")
                        .foregroundStyle(model.isConnected ? Color.green : Color.orange)
                }
                .font(.caption2)

                Button(role: .destructive) {
                    Task { await model.end() }
                } label: {
                    Label("End", systemImage: "stop.fill")
                }
                .padding(.top, 6)
            }
        }
        .navigationBarBackButtonHidden(true)
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
                    stat("Average", "\(summary.averageBpm) bpm")
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
            ForEach(model.people) { person in
                Button {
                    model.choose(person)
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(person.displayName).font(.headline)
                        HStack(spacing: 6) {
                            Text("Tag \(person.tagId)").font(.caption2).foregroundStyle(.secondary)
                            if person.inSession {
                                Text("In session").font(.caption2).foregroundStyle(.green)
                            }
                        }
                    }
                }
            }
            if !model.isLoadingPeople && model.people.isEmpty && model.errorMessage == nil {
                Text("No one is registered yet.").font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle("Who are you?")
        .task { await model.loadPeople() }
    }
}
