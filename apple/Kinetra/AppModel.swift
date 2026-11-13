import Foundation
import Observation

/** The state of the phone app. It decides which screen is shown and talks to the hub and the watch. */
@MainActor
@Observable
final class AppModel {
    /** The three screens, in the order a person moves through them. */
    enum Step {
        case connect
        case choose
        case monitor
    }

    var step: Step = .connect
    var pairing: HubPairing?
    var people: [RosterPerson] = []
    var sessionActive = false
    var tagsManaged = true
    var isBusy = false
    var errorMessage: String?
    var reading: HeartReading = .waiting
    var lastLaunchError: String?

    let link = PhoneLink()

    // A saved pairing skips the setup screens, and is sent to the watch again in case the watch missed it
    init() {
        pairing = PairingStore.load()
        if let pairing {
            step = pairing.person == nil ? .choose : .monitor
        }
        link.activate()
        if let pairing { link.send(pairing) }
    }

    /** A hub client for the saved pairing, or nil before the phone is connected. */
    private var client: HubClient? {
        pairing.map { HubClient(baseURL: $0.hubURL, apiKey: $0.apiKey) }
    }

    /** Checks the address by asking the hub for its roster. Nothing is saved unless that works. */
    func connect(address: String, key: String) async {
        errorMessage = nil
        guard let url = HubAddress.normalize(address) else {
            errorMessage = HubError.badAddress.errorDescription
            return
        }
        let trimmedKey = key.trimmingCharacters(in: .whitespacesAndNewlines)
        isBusy = true
        defer { isBusy = false }
        do {
            let roster = try await HubClient(baseURL: url, apiKey: trimmedKey).roster()
            // The chosen person is kept only when it is the same hub
            let keepPerson = pairing?.hubURL == url ? pairing?.person : nil
            // Resolving the host name can block, so it runs away from the main thread
            let fallback = await Task.detached { HostResolver.fallbackURL(for: url) }.value
            var next = HubPairing(hubURL: url, fallbackURL: fallback, apiKey: trimmedKey, person: keepPerson)
            if let keep = keepPerson, !roster.people.contains(where: { $0.patientId == keep.patientId }) { next.person = nil }
            apply(roster)
            pairing = next
            PairingStore.save(next)
            link.send(next)
            step = next.person == nil ? .choose : .monitor
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    /** Reloads the list of people from the hub. */
    func refreshRoster() async {
        guard let client else { return }
        do {
            apply(try await client.roster())
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
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
        lastLaunchError = nil
        step = .monitor
    }

    func changePerson() {
        step = .choose
    }

    func changeHub() {
        errorMessage = nil
        step = .connect
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

    /** Reads the person's heart rate from the hub every two seconds until the screen goes away. */
    func pollReading() async {
        while !Task.isCancelled {
            if let client, let person = pairing?.person {
                if let latest = try? await client.status(patientId: person.patientId) {
                    reading = latest
                }
            }
            try? await Task.sleep(for: .seconds(2))
        }
    }

    /** The address of a person's tag picture, so the app can show which tag they wear. */
    func tagImageURL(_ tagId: Int, size: Int = 240) -> URL? {
        client?.tagImageURL(tagId, size: size)
    }

    private func apply(_ roster: Roster) {
        people = roster.people
        sessionActive = roster.sessionActive
        tagsManaged = roster.tagsManaged
    }
}
