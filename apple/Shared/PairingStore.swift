import Foundation
import Security

/** A thin wrapper over the Keychain, used for the hub's access key so it is not kept in plain settings. */
enum Keychain {
    private static let service = "org.kinetra.hub"

    /** Saves a value, replacing any earlier one. An empty value removes it. */
    static func set(_ value: String, for key: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrService as String: service,
                                   kSecAttrAccount as String: key]
        SecItemDelete(base as CFDictionary)
        guard !value.isEmpty, let data = value.data(using: .utf8) else { return }
        var add = base
        add[kSecValueData as String] = data
        // The key stays readable after the first unlock so the watch can reach the hub in the background
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

    /** Reads a value, or nil when nothing is stored. */
    static func get(_ key: String) -> String? {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                    kSecAttrService as String: service,
                                    kSecAttrAccount as String: key,
                                    kSecReturnData as String: true,
                                    kSecMatchLimit as String: kSecMatchLimitOne]
        var result: AnyObject?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }
}

/** Saves the hub details on the device. Only the access key goes in the Keychain, and the rest is ordinary settings. */
enum PairingStore {
    private static let urlKey = "hub.url"
    private static let fallbackKey = "hub.fallback"
    private static let personKey = "hub.person"
    private static let keyName = "hub.apikey"

    /** The saved pairing, or nil when the device has not been set up. */
    static func load() -> HubPairing? {
        let defaults = UserDefaults.standard
        guard let text = defaults.string(forKey: urlKey), let url = URL(string: text) else { return nil }
        let person = defaults.data(forKey: personKey).flatMap { try? JSONDecoder().decode(SelectedPerson.self, from: $0) }
        let fallback = defaults.string(forKey: fallbackKey).flatMap(URL.init(string:))
        return HubPairing(hubURL: url, fallbackURL: fallback, apiKey: Keychain.get(keyName) ?? "", person: person)
    }

    /** Saves the pairing, replacing any earlier one. */
    static func save(_ pairing: HubPairing) {
        let defaults = UserDefaults.standard
        defaults.set(pairing.hubURL.absoluteString, forKey: urlKey)
        defaults.set(pairing.fallbackURL?.absoluteString, forKey: fallbackKey)
        defaults.set(try? JSONEncoder().encode(pairing.person), forKey: personKey)
        Keychain.set(pairing.apiKey, for: keyName)
    }

    /** Forgets the hub and the person, for the sign out option. */
    static func clear() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: urlKey)
        defaults.removeObject(forKey: fallbackKey)
        defaults.removeObject(forKey: personKey)
        Keychain.set("", for: keyName)
    }
}
