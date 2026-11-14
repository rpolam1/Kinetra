import Foundation
import Observation

/** One heart rate reading kept for the trend line. */
struct HeartPoint: Identifiable, Equatable {
    let date: Date
    let bpm: Int

    var id: Date { date }
}

/** The state of the phone app. It decides which screen is shown, finds the hub and talks to the watch. */
@MainActor
@Observable
final class AppModel {
    /** The three screens, in the order a person moves through them. */
    enum Step {
        case connect
        case choose
        case monitor
    }

    /** Where the hub search is. The connect screen follows this. */
    enum Search: Equatable {
        case idle
        case searching
        case connecting(DiscoveredHub)
        case choose
        case needsKey(DiscoveredHub)
        case notFound
    }

    var step: Step = .connect
    var search: Search = .idle
    var found: [DiscoveredHub] = []
    var hasNetwork = true
    var pairing: HubPairing?
    var people: [RosterPerson] = []
    var isLoadingPeople = false
    var sessionActive = false
    var tagsManaged = true
    var isBusy = false
    var errorMessage: String?
    var reading: HeartReading = .waiting
    var history: [HeartPoint] = []
    var hubOnline = true
    var lastLaunchError: String?

    let link = PhoneLink()

    @ObservationIgnored private var searchTask: Task<Void, Never>?
    @ObservationIgnored private var isRecovering = false
    @ObservationIgnored private var failures = 0
    @ObservationIgnored private var retriesLeft = 1

    // About five minutes of readings at one every two seconds
    private let historyLimit = 150

    init() {
        pairing = PairingStore.load()
        if let pairing {
            step = pairing.person == nil ? .choose : .monitor
        }
        link.activate()
        if let pairing { link.send(pairing) }
    }

    /** The name shown for the hub, from the last time it was found. */
    var hubName: String {
        pairing?.hubName ?? pairing?.hubURL.host ?? "Hub"
    }

    private var client: HubClient? {
        pairing.map { HubClient(baseURL: $0.hubURL, apiKey: $0.apiKey) }
    }

    /** Looks for the hub on the network. A hub used before is connected at once, a single new hub is connected after a short pause, and several are offered as a list. */
    func startSearch(resetRetries: Bool = true) {
        if resetRetries { retriesLeft = 1 }
        searchTask?.cancel()
        errorMessage = nil
        found = []
        search = .searching
        hasNetwork = !HubDiscovery.localIPv4Addresses().isEmpty
        let known = pairing.map { [$0.hubURL] } ?? []

        searchTask = Task { [weak self] in
            var settle: Task<Void, Never>?
            for await hub in HubDiscovery.discover(known: known) {
                guard let self, !Task.isCancelled else { return }
                if !self.found.contains(hub) { self.found.append(hub) }
                if known.contains(where: { hub.matches($0) }) {
                    settle?.cancel()
                    await self.connect(to: hub)
                    return
                }
                // A short wait lets a second hub show up before the app picks for the person
                if settle == nil {
                    settle = Task { [weak self] in
                        try? await Task.sleep(for: .seconds(1.5))
                        if !Task.isCancelled { self?.settleSearch() }
                    }
                }
            }
            guard let self, !Task.isCancelled else { return }
            settle?.cancel()
            self.settleSearch()
        }
    }

    private func settleSearch() {
        guard search == .searching else { return }
        switch found.count {
        case 0:
            // The first scan often runs while iOS is still asking for Local Network access, so it gets one more go before giving up
            if retriesLeft > 0 {
                retriesLeft -= 1
                Task {
                    try? await Task.sleep(for: .seconds(1.5))
                    if search == .searching { startSearch(resetRetries: false) }
                }
            } else {
                search = .notFound
            }
        case 1:
            let hub = found[0]
            Task { await connect(to: hub) }
        default:
            search = .choose
        }
    }

    /** Connects to a hub by asking it for its roster. Nothing is saved unless that works. */
    func connect(to hub: DiscoveredHub, key: String? = nil) async {
        errorMessage = nil
        search = .connecting(hub)
        isBusy = true
        defer { isBusy = false }

        let sameHub = pairing.map { hub.matches($0.hubURL) } ?? false
        let useKey = (key ?? (sameHub ? pairing?.apiKey : nil) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let roster = try await HubClient(baseURL: hub.url, apiKey: useKey).roster()
            // The chosen person is kept only when it is the same hub
            let keepPerson = sameHub ? pairing?.person : nil
            // Resolving the host name can block, so it runs away from the main thread
            let fallback = await Task.detached { HostResolver.fallbackURL(for: hub.url) }.value
            var next = HubPairing(hubURL: hub.url, fallbackURL: fallback, apiKey: useKey, person: keepPerson, hubName: hub.name)
            if let keep = keepPerson, !roster.people.contains(where: { $0.patientId == keep.patientId }) { next.person = nil }
            apply(roster)
            pairing = next
            PairingStore.save(next)
            link.send(next)
            hubOnline = true
            failures = 0
            searchTask?.cancel()
            search = .idle
            step = next.person == nil ? .choose : .monitor
        } catch HubError.unauthorized {
            if !useKey.isEmpty { errorMessage = HubError.unauthorized.errorDescription }
            search = .needsKey(hub)
        } catch {
            errorMessage = error.localizedDescription
            search = .notFound
        }
    }

    /** Connects to an address the person typed. The hub is asked for its name first so the app can show it. */
    func connectManually(address: String, key: String) async {
        errorMessage = nil
        guard let url = HubAddress.normalize(address) else {
            errorMessage = HubError.badAddress.errorDescription
            return
        }
        searchTask?.cancel()
        let hub = await HubDiscovery.probe(url) ?? DiscoveredHub(url: url, name: url.host ?? "Hub")
        await connect(to: hub, key: key)
    }

    /** Reloads the list of people from the hub. */
    func refreshRoster() async {
        guard let client else { return }
        isLoadingPeople = people.isEmpty
        defer { isLoadingPeople = false }
        do {
            apply(try await client.roster())
            errorMessage = nil
            hubOnline = true
        } catch {
            errorMessage = error.localizedDescription
            hubOnline = false
            await recoverHub()
        }
    }

    /** Saves who is wearing the watch and sends it over. */
    func choose(_ person: RosterPerson) {
        guard var next = pairing else { return }
        next.person = person.selection
        pairing = next
        PairingStore.save(next)
        link.send(next)
        reading = .waiting
        history = []
        lastLaunchError = nil
        step = .monitor
    }

    func changePerson() {
        step = .choose
    }

    func changeHub() {
        errorMessage = nil
        step = .connect
        startSearch()
    }

    /** Sends the pairing to the watch and asks iOS to open the watch app in a workout. */
    func startOnWatch() async {
        guard let pairing else { return }
        lastLaunchError = nil
        link.send(pairing)
        do {
            try await link.launchWatchWorkout()
        } catch {
            lastLaunchError = "Could not start the watch automatically. Open Kinetra on the watch and tap Start. (\(error.localizedDescription))"
        }
    }

    /** Asks the watch to finish the workout. */
    func endOnWatch() {
        link.sendEnd()
    }

    /** Reads the person's heart rate from the hub every two seconds until the screen goes away. After a few failures it looks for the hub again, in case the network gave it a new address. */
    func pollReading() async {
        while !Task.isCancelled {
            if let client, let person = pairing?.person {
                do {
                    let latest = try await client.status(patientId: person.patientId)
                    failures = 0
                    if !hubOnline { hubOnline = true }
                    reading = latest
                    record(latest)
                } catch {
                    failures += 1
                    if failures >= 3 {
                        hubOnline = false
                        await recoverHub()
                    }
                }
            }
            try? await Task.sleep(for: .seconds(2))
        }
    }

    /** Called when the app comes back to the front. It checks the hub is still there and finds it again if it moved. */
    func appBecameActive() async {
        guard let pairing, step != .connect else { return }
        link.send(pairing)
        if await HubDiscovery.probe(pairing.hubURL) == nil {
            hubOnline = false
            await recoverHub()
        } else {
            hubOnline = true
        }
    }

    /** The address of a person's tag picture, so the app can show which tag they wear. */
    func tagImageURL(_ tagId: Int, size: Int = 240) -> URL? {
        client?.tagImageURL(tagId, size: size)
    }

    // Only fresh readings are kept, so a stale value is not drawn again and again
    private func record(_ latest: HeartReading) {
        guard let bpm = latest.bpm, (latest.ageSeconds ?? 0) < 8 else { return }
        history.append(HeartPoint(date: Date(), bpm: bpm))
        if history.count > historyLimit { history.removeFirst(history.count - historyLimit) }
    }

    // The same machine keeps its name when its address changes, so the name is what identifies the saved hub
    private func recoverHub() async {
        guard !isRecovering, let current = pairing else { return }
        isRecovering = true
        defer { isRecovering = false }
        for await hub in HubDiscovery.discover(known: [current.hubURL]) {
            let sameAddress = hub.matches(current.hubURL)
            let sameName = current.hubName != nil && hub.name == current.hubName
            guard sameAddress || sameName else { continue }
            if !sameAddress {
                let fallback = await Task.detached { HostResolver.fallbackURL(for: hub.url) }.value
                var next = current
                next.hubURL = hub.url
                next.fallbackURL = fallback
                next.hubName = hub.name
                pairing = next
                PairingStore.save(next)
                link.send(next)
            }
            hubOnline = true
            failures = 0
            return
        }
    }

    private func apply(_ roster: Roster) {
        people = roster.people
        sessionActive = roster.sessionActive
        tagsManaged = roster.tagsManaged
    }
}
