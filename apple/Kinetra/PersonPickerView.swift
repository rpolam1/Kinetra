import SwiftUI

/** A searchable list of the people who can wear the watch. Those in today's session come first. */
struct PersonPickerView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    /** The people matching the search, which can be a name or a tag number. */
    private var matches: [RosterPerson] {
        let text = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !text.isEmpty else { return model.people }
        return model.people.filter { $0.displayName.lowercased().contains(text) || String($0.tagId) == text }
    }

    private var inSession: [RosterPerson] { matches.filter(\.inSession) }
    private var others: [RosterPerson] { matches.filter { !$0.inSession } }

    var body: some View {
        List {
            if let message = model.errorMessage {
                Section { ErrorBanner(message: message).listRowInsets(EdgeInsets()).listRowBackground(Color.clear) }
            }
            if model.people.isEmpty {
                Section { emptyState }
            } else if matches.isEmpty {
                Section { Text("No one matches \"\(query)\".").foregroundStyle(.secondary) }
            }
            if !inSession.isEmpty {
                Section("In today's session") {
                    ForEach(inSession) { row($0) }
                }
            }
            if !others.isEmpty {
                Section(model.sessionActive ? "Other registered people" : "Registered people") {
                    ForEach(others) { row($0) }
                }
            }
        }
        .navigationTitle("Who is exercising?")
        .navigationBarTitleDisplayMode(.large)
        .searchable(text: $query, prompt: "Search by name or tag number")
        .refreshable { await model.refreshRoster() }
        .task { await model.refreshRoster() }
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

    /** What is shown when no one is registered yet. */
    private var emptyState: some View {
        VStack(spacing: 10) {
            Image(systemName: "person.crop.rectangle.stack").font(.largeTitle).foregroundStyle(.secondary)
            Text("No one is registered yet").font(.headline)
            Text("Register people and assign them an AprilTag in the Kinetra web app, then pull down to refresh.")
                .font(.subheadline)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 24)
    }

    /** One person in the list. */
    private func row(_ person: RosterPerson) -> some View {
        Button {
            model.choose(person)
        } label: {
            HStack(spacing: 14) {
                TagThumbnail(url: model.tagImageURL(person.tagId))
                VStack(alignment: .leading, spacing: 6) {
                    Text(person.displayName).font(.headline).foregroundStyle(.primary)
                    Text("Tag \(person.tagId)").font(.subheadline).foregroundStyle(.secondary)
                    HStack(spacing: 6) {
                        if person.inView { Badge(text: "On camera", symbol: "camera.fill", tint: .blue) }
                        if person.watchConnected { Badge(text: "Watch live", symbol: "applewatch", tint: .green) }
                    }
                }
                Spacer()
                Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.tertiary)
            }
            .padding(.vertical, 4)
        }
        .accessibilityLabel("\(person.displayName), tag \(person.tagId)")
    }
}
