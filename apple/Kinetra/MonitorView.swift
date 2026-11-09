import SwiftUI

struct MonitorView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                if let person = model.pairing?.person {
                    header(person)
                }

                HeartCard(reading: model.reading)

                watchSection

                if let message = model.lastLaunchError {
                    ErrorBanner(message: message)
                }

                VStack(spacing: 12) {
                    Button("Change person") { model.changePerson() }
                        .buttonStyle(SecondaryButtonStyle())
                }
            }
            .padding(20)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("Heart rate")
        .navigationBarTitleDisplayMode(.inline)
        .task { await model.pollReading() }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Change hub", systemImage: "wifi.router") { model.changeHub() }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
    }

    private func header(_ person: SelectedPerson) -> some View {
        HStack(spacing: 16) {
            TagThumbnail(url: model.tagImageURL(person.tagId, size: 320), size: 84)
            VStack(alignment: .leading, spacing: 4) {
                Text(person.displayName).font(.title2.bold())
                Text("Tag \(person.tagId)").font(.headline).foregroundStyle(.secondary)
                Text("Wear the watch and hold this tag where the camera can see it.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var watchSection: some View {
        VStack(alignment: .leading, spacing: 14) {
            Label(watchStatusText, systemImage: watchStatusSymbol)
                .font(.subheadline.weight(.medium))
                .foregroundStyle(watchStatusTint)
            Button {
                Task { await model.startOnWatch() }
            } label: {
                Label("Start on Apple Watch", systemImage: "applewatch.watchface")
            }
            .buttonStyle(PrimaryButtonStyle())
            .disabled(!model.link.isPaired || !model.link.isWatchAppInstalled)

            Button(role: .destructive) {
                model.endOnWatch()
            } label: {
                Label("End workout", systemImage: "stop.circle")
            }
            .buttonStyle(SecondaryButtonStyle(tint: .red))
            .disabled(!model.link.isReachable)
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private var watchStatusText: String {
        if !model.link.isPaired { return "No Apple Watch is paired with this phone" }
        if !model.link.isWatchAppInstalled { return "Install the Kinetra app on the watch" }
        if model.reading.status != .noSignal { return "Watch is sending heart rate" }
        return model.link.isReachable ? "Watch is ready. Tap Start" : "Watch is nearby but not reachable"
    }

    private var watchStatusSymbol: String {
        if !model.link.isPaired || !model.link.isWatchAppInstalled { return "exclamationmark.triangle.fill" }
        return model.reading.status != .noSignal ? "checkmark.circle.fill" : "applewatch"
    }

    private var watchStatusTint: Color {
        if !model.link.isPaired || !model.link.isWatchAppInstalled { return .orange }
        return model.reading.status != .noSignal ? .green : .secondary
    }
}
