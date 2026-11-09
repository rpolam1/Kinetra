import Foundation
import Observation

@MainActor
@Observable
final class AppModel {
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

    init() {
        pairing = PairingStore.load()
        if let pairing {
            step = pairing.person == nil ? .choose : .monitor
        }
        link.activate()
        if let pairing { link.send(pairing) }
    }

    private var client: HubClient? {
        pairing.map { HubClient(baseURL: $0.hubURL, apiKey: $0.apiKey) }
    }

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
            let keepPerson = pairing?.hubURL == url ? pairing?.person : nil
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

    func refreshRoster() async {
        guard let client else { return }
        do {
            apply(try await client.roster())
            errorMessage = nil
        } catch {
            errorMessage = error.localizedDescription
        }
    }

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

    func endOnWatch() {
        link.sendEnd()
    }

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

    func tagImageURL(_ tagId: Int, size: Int = 240) -> URL? {
        client?.tagImageURL(tagId, size: size)
    }

    private func apply(_ roster: Roster) {
        people = roster.people
        sessionActive = roster.sessionActive
        tagsManaged = roster.tagsManaged
    }
}
