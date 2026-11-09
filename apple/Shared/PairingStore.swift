import Foundation
import Security

enum Keychain {
    private static let service = "org.kinetra.hub"

    static func set(_ value: String, for key: String) {
        let base: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                   kSecAttrService as String: service,
                                   kSecAttrAccount as String: key]
        SecItemDelete(base as CFDictionary)
        guard !value.isEmpty, let data = value.data(using: .utf8) else { return }
        var add = base
        add[kSecValueData as String] = data
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlock
        SecItemAdd(add as CFDictionary, nil)
    }

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

enum PairingStore {
    private static let urlKey = "hub.url"
    private static let fallbackKey = "hub.fallback"
    private static let personKey = "hub.person"
    private static let keyName = "hub.apikey"

    static func load() -> HubPairing? {
        let defaults = UserDefaults.standard
        guard let text = defaults.string(forKey: urlKey), let url = URL(string: text) else { return nil }
        let person = defaults.data(forKey: personKey).flatMap { try? JSONDecoder().decode(SelectedPerson.self, from: $0) }
        let fallback = defaults.string(forKey: fallbackKey).flatMap(URL.init(string:))
        return HubPairing(hubURL: url, fallbackURL: fallback, apiKey: Keychain.get(keyName) ?? "", person: person)
    }

    static func save(_ pairing: HubPairing) {
        let defaults = UserDefaults.standard
        defaults.set(pairing.hubURL.absoluteString, forKey: urlKey)
        defaults.set(pairing.fallbackURL?.absoluteString, forKey: fallbackKey)
        defaults.set(try? JSONEncoder().encode(pairing.person), forKey: personKey)
        Keychain.set(pairing.apiKey, for: keyName)
    }

    static func clear() {
        let defaults = UserDefaults.standard
        defaults.removeObject(forKey: urlKey)
        defaults.removeObject(forKey: fallbackKey)
        defaults.removeObject(forKey: personKey)
        Keychain.set("", for: keyName)
    }
}
