
import SwiftUI

struct PersonPickerView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var shown = false

    private var available: [RosterPerson] { model.people.filter(\.inSession) }

    private var matches: [RosterPerson] {
        let text = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !text.isEmpty else { return available }
        return available.filter { $0.displayName.lowercased().contains(text) || String($0.tagId) == text }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if let message = model.errorMessage {
                    ErrorBanner(message: message)
                }
                if model.people.isEmpty {
                    emptyCard(symbol: "person.crop.rectangle.stack",
                              title: "No one is registered yet",
                              text: "Register people and assign them an AprilTag in the Kinetra web app, then pull down to refresh.")
                } else if available.isEmpty {
                    emptyCard(symbol: "figure.strengthtraining.traditional",
                              title: "No one is in a session yet",
                              text: "Start a session in the Kinetra web app and add people to it, then pull down to refresh.")
                } else if matches.isEmpty {
                    Text("No one matches \"\(query)\".")
                        .font(.subheadline)
                        .foregroundStyle(Brand.ink200)
                        .padding(.top, 20)
                } else {
                    Text("IN TODAY'S SESSION")
                        .font(.system(.caption, design: .rounded, weight: .semibold))
                        .tracking(1.2)
                        .foregroundStyle(Brand.ink300)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.horizontal, 4)
                    ForEach(Array(matches.enumerated()), id: \.element.id) { index, person in
                        row(person)
                            .staggeredEntrance(index: index, shown: shown)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.top, 8)
            .padding(.bottom, 32)
        }
        .navigationTitle("Who is exercising?")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $query, prompt: "Search by name or tag number")
        .refreshable { await model.refreshRoster() }
        .task {
            shown = true
            await model.refreshRoster()
        }
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Refresh list", systemImage: "arrow.clockwise") { Task { await model.refreshRoster() } }
                    Button("Change hub", systemImage: "wifi.router") { model.changeHub() }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
            if model.pairing?.person != nil {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Back") { model.step = .monitor }
                }
            }
        }
    }

    private func emptyCard(symbol: String, title: String, text: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: symbol)
                .font(.system(size: 34))
                .foregroundStyle(Brand.ink300)
            Text(title)
                .font(.system(.headline, design: .rounded))
                .foregroundStyle(.white)
            Text(text)
                .font(.subheadline)
                .foregroundStyle(Brand.ink200)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .cardStyle(padding: 28)
        .padding(.top, 12)
    }

    @ViewBuilder
    private func chips(for person: RosterPerson) -> some View {
        Chip(text: "Tag \(person.tagId)", symbol: "qrcode")
        if person.inView { Chip(text: "On camera", symbol: "camera.fill", tint: HeartStatus.below.tint) }
        if person.watchConnected { Chip(text: "Watch live", symbol: "applewatch", tint: HeartStatus.inZone.tint) }
    }

    private func row(_ person: RosterPerson) -> some View {
        Button {
            model.choose(person)
        } label: {
            HStack(spacing: 14) {
                Avatar(name: person.displayName, size: 46)
                VStack(alignment: .leading, spacing: 6) {
                    Text(person.displayName)
                        .font(.system(.headline, design: .rounded))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: 6) { chips(for: person) }
                        VStack(alignment: .leading, spacing: 6) { chips(for: person) }
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                TagThumbnail(url: model.tagImageURL(person.tagId), size: 44)
            }
            .cardStyle(padding: 14)
        }
        .buttonStyle(PressableStyle())
        .accessibilityLabel("\(person.displayName), tag \(person.tagId)")
    }
}
