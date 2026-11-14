import SwiftUI

/** A searchable list of the people who can wear the watch. Those in today's session come first. */
struct PersonPickerView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""
    @State private var shown = false
    @State private var chosen: String?
    @FocusState private var searching: Bool

    // A name or a tag number both work, so a volunteer can type whichever is quicker
    private var matches: [RosterPerson] {
        let text = query.trimmingCharacters(in: .whitespaces).lowercased()
        guard !text.isEmpty else { return model.people }
        return model.people.filter { $0.displayName.lowercased().contains(text) || String($0.tagId) == text }
    }

    private var inSession: [RosterPerson] { matches.filter(\.inSession) }
    private var others: [RosterPerson] { matches.filter { !$0.inSession } }

    var body: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                header
                searchField

                if let message = model.errorMessage {
                    ErrorBanner(message: message)
                }

                if model.isLoadingPeople && model.people.isEmpty {
                    ForEach(0..<5, id: \.self) { _ in placeholder }
                } else if model.people.isEmpty {
                    emptyState
                } else if matches.isEmpty {
                    noMatches
                } else {
                    if !inSession.isEmpty {
                        sectionTitle("In today's session")
                        ForEach(Array(inSession.enumerated()), id: \.element.id) { index, person in
                            row(person, index: index)
                        }
                    }
                    if !others.isEmpty {
                        sectionTitle(model.sessionActive ? "Other registered people" : "Registered people")
                            .padding(.top, inSession.isEmpty ? 0 : 10)
                        ForEach(Array(others.enumerated()), id: \.element.id) { index, person in
                            row(person, index: index + inSession.count)
                        }
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 36)
            .animation(.smooth, value: matches.map(\.id))
            .animation(.smooth, value: model.errorMessage)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .refreshable { await model.refreshRoster() }
        .task {
            await model.refreshRoster()
            shown = true
        }
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .toolbar {
            ToolbarItem(placement: .topBarLeading) {
                if model.pairing?.person != nil {
                    Button {
                        model.step = .monitor
                    } label: {
                        Label("Back", systemImage: "chevron.left")
                            .labelStyle(.titleAndIcon)
                    }
                } else {
                    HubChip(name: model.hubName, online: model.hubOnline)
                }
            }
            ToolbarItem(placement: .topBarTrailing) {
                Menu {
                    Button("Refresh list", systemImage: "arrow.clockwise") { Task { await model.refreshRoster() } }
                    Button("Change hub", systemImage: "wifi.router") { model.changeHub() }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
            }
        }
        .sensoryFeedback(.selection, trigger: chosen)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Who is exercising?")
                .font(.system(size: 32, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
            HStack(spacing: 8) {
                LiveDot(color: model.sessionActive ? HeartStatus.inZone.tint : Brand.ink300, active: model.sessionActive)
                Text(model.sessionActive ? "Session running" : "No session running")
                    .font(.system(.subheadline, design: .rounded, weight: .medium))
                    .foregroundStyle(Brand.ink200)
                if model.pairing?.person != nil {
                    Spacer()
                    HubChip(name: model.hubName, online: model.hubOnline)
                }
            }
        }
        .padding(.top, 4)
        .padding(.bottom, 6)
    }

    private var searchField: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass").foregroundStyle(Brand.ink300)
            TextField("", text: $query, prompt: Text("Search by name or tag number").foregroundStyle(Brand.ink300))
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.search)
                .focused($searching)
                .foregroundStyle(.white)
            if !query.isEmpty {
                Button {
                    query = ""
                } label: {
                    Image(systemName: "xmark.circle.fill").foregroundStyle(Brand.ink400)
                }
                .transition(.scale.combined(with: .opacity))
            }
        }
        .padding(14)
        .background(Brand.ink800.opacity(0.92), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 16, style: .continuous).strokeBorder(searching ? Brand.mint.opacity(0.6) : Color.white.opacity(0.07), lineWidth: 1))
        .animation(.smooth(duration: 0.25), value: searching)
        .animation(.smooth(duration: 0.25), value: query.isEmpty)
        .padding(.bottom, 4)
    }

    private func sectionTitle(_ text: String) -> some View {
        Text(text.uppercased())
            .font(.system(.caption, design: .rounded, weight: .semibold))
            .tracking(1.2)
            .foregroundStyle(Brand.ink300)
            .padding(.leading, 4)
            .padding(.top, 6)
    }

    private func row(_ person: RosterPerson, index: Int) -> some View {
        Button {
            chosen = person.id
            model.choose(person)
        } label: {
            HStack(spacing: 14) {
                Avatar(name: person.displayName, size: 50)
                    .overlay {
                        if person.watchConnected {
                            Circle().strokeBorder(HeartStatus.inZone.tint, lineWidth: 2.5).padding(-4)
                        }
                    }
                VStack(alignment: .leading, spacing: 7) {
                    Text(person.displayName)
                        .font(.system(.headline, design: .rounded))
                        .foregroundStyle(.white)
                    HStack(spacing: 6) {
                        Chip(text: "Tag \(person.tagId)", symbol: "qrcode")
                        if person.inView { Chip(text: "On camera", symbol: "camera.fill", tint: HeartStatus.below.tint) }
                        if person.watchConnected { Chip(text: "Watch live", symbol: "applewatch", tint: HeartStatus.inZone.tint) }
                    }
                }
                Spacer(minLength: 6)
                TagThumbnail(url: model.tagImageURL(person.tagId), size: 40)
            }
            .cardStyle(padding: 14)
        }
        .buttonStyle(PressableStyle())
        .staggeredEntrance(index: index, shown: shown)
        .accessibilityLabel("\(person.displayName), tag \(person.tagId)")
    }

    private var placeholder: some View {
        HStack(spacing: 14) {
            Circle().fill(Brand.ink700).frame(width: 50, height: 50)
            VStack(alignment: .leading, spacing: 10) {
                RoundedRectangle(cornerRadius: 5).fill(Brand.ink700).frame(width: 140, height: 14)
                RoundedRectangle(cornerRadius: 5).fill(Brand.ink700).frame(width: 90, height: 10)
            }
            Spacer()
        }
        .cardStyle(padding: 14)
        .shimmering()
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "person.crop.rectangle.stack")
                .font(.system(size: 40))
                .foregroundStyle(Brand.mint)
                .symbolEffect(.pulse)
            Text("No one is registered yet")
                .font(.system(.headline, design: .rounded))
                .foregroundStyle(.white)
            Text("Register people and give them an AprilTag in the Kinetra web app, then pull down to refresh.")
                .font(.subheadline)
                .foregroundStyle(Brand.ink200)
                .multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
        .padding(.horizontal, 12)
    }

    private var noMatches: some View {
        VStack(spacing: 8) {
            Image(systemName: "magnifyingglass").font(.title).foregroundStyle(Brand.ink400)
            Text("No one matches \"\(query)\"")
                .font(.subheadline)
                .foregroundStyle(Brand.ink200)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 40)
    }
}
