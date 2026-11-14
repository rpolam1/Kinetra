import Foundation
import Network

/** A hub found on the local network. */
struct DiscoveredHub: Identifiable, Hashable, Sendable {
    let url: URL
    let name: String

    var id: String { url.absoluteString }
    var host: String { url.host ?? url.absoluteString }

    /** True when both addresses point at the same machine and port. */
    func matches(_ other: URL) -> Bool {
        url.host == other.host && (url.port ?? HubAddress.defaultPort) == (other.port ?? HubAddress.defaultPort)
    }
}

/** A flag that lets exactly one caller win, so a continuation is never resumed twice. */
private final class OneShot: @unchecked Sendable {
    private let lock = NSLock()
    private var spent = false

    func claim() -> Bool {
        lock.lock()
        defer { lock.unlock() }
        if spent { return false }
        spent = true
        return true
    }
}

/** A thread safe set, used to report each hub once even when several searches find it. */
private final class SeenSet: @unchecked Sendable {
    private let lock = NSLock()
    private var items = Set<String>()

    func insert(_ item: String) -> Bool {
        lock.lock()
        defer { lock.unlock() }
        return items.insert(item).inserted
    }
}

/** Finds the hub on the same Wi-Fi network without the person typing an address. */
enum HubDiscovery {
    static let hubHeader = "X-Hub"
    static let hubHeaderValue = "exercise-hub"

    // Short timeouts keep a scan of a whole network quick, since most addresses are empty
    private static let probeSession: URLSession = {
        let config = URLSessionConfiguration.ephemeral
        config.timeoutIntervalForRequest = 1.5
        config.timeoutIntervalForResource = 3
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }()

    /** Asks one address for its health page and returns the hub when it answers like one. The hub marks every answer with a header, so other web servers are ignored. */
    static func probe(_ url: URL) async -> DiscoveredHub? {
        var request = URLRequest(url: url.appendingPathComponent("api/health"))
        request.timeoutInterval = 1.5
        guard let (data, response) = try? await probeSession.data(for: request),
              let http = response as? HTTPURLResponse,
              http.value(forHTTPHeaderField: hubHeader) == hubHeaderValue else { return nil }
        let body = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        let name = (body?["name"] as? String).flatMap { $0.isEmpty ? nil : $0 }
        return DiscoveredHub(url: url, name: name ?? url.host ?? "Hub")
    }

    /** The IPv4 addresses of this device on Wi-Fi or Ethernet. It is empty when the device is not on a local network. */
    static func localIPv4Addresses() -> [String] {
        var list: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&list) == 0, let first = list else { return [] }
        defer { freeifaddrs(list) }
        var found: [String] = []
        for pointer in sequence(first: first, next: { $0.pointee.ifa_next }) {
            let entry = pointer.pointee
            guard let address = entry.ifa_addr, address.pointee.sa_family == UInt8(AF_INET) else { continue }
            let flags = Int32(entry.ifa_flags)
            guard flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0 else { continue }
            let name = String(cString: entry.ifa_name)
            // The en0 interface is Wi-Fi, and bridge interfaces cover a phone that is sharing its connection
            guard name.hasPrefix("en") || name.hasPrefix("bridge") else { continue }
            var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(address, socklen_t(address.pointee.sa_len), &buffer, socklen_t(buffer.count), nil, 0, NI_NUMERICHOST) == 0 else { continue }
            let ip = String(cString: buffer)
            if !ip.hasPrefix("169.254.") { found.append(ip) }
        }
        return found
    }

    /** Tries to open a TCP connection. A closed or unreachable port fails fast, which is what makes scanning a whole network practical. */
    static func portOpen(host: String, port: UInt16, timeout: TimeInterval) async -> Bool {
        await withCheckedContinuation { continuation in
            let connection = NWConnection(host: NWEndpoint.Host(host), port: NWEndpoint.Port(rawValue: port) ?? 5000, using: .tcp)
            let shot = OneShot()
            let finish: @Sendable (Bool) -> Void = { ok in
                if shot.claim() {
                    connection.cancel()
                    continuation.resume(returning: ok)
                }
            }
            connection.stateUpdateHandler = { state in
                switch state {
                case .ready: finish(true)
                case .failed, .cancelled: finish(false)
                // Waiting means there is no route to that address, so it is not worth waiting for
                case .waiting: finish(false)
                default: break
                }
            }
            connection.start(queue: .global(qos: .userInitiated))
            DispatchQueue.global().asyncAfter(deadline: .now() + timeout) { finish(false) }
        }
    }

    /** Looks for hubs and reports each one as soon as it is found. Addresses that were used before are tried first, then common names, then every address on the local network. The stream ends when the search is finished. */
    static func discover(known: [URL] = []) -> AsyncStream<DiscoveredHub> {
        AsyncStream { continuation in
            let task = Task.detached {
                let seen = SeenSet()
                let report: @Sendable (DiscoveredHub) -> Void = { hub in
                    if seen.insert(hub.id) { continuation.yield(hub) }
                }
                await searchKnown(known, report: report)
                if !Task.isCancelled { await scanNetwork(report: report) }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    // Saved addresses and the usual names are tried together, because that is the fastest way to a hit
    private static func searchKnown(_ known: [URL], report: @escaping @Sendable (DiscoveredHub) -> Void) async {
        var urls = known
        for name in ["kinetra.local", "jetson.local"] {
            if let url = URL(string: "http://\(name):\(HubAddress.defaultPort)") { urls.append(url) }
        }
        await withTaskGroup(of: DiscoveredHub?.self) { group in
            for url in urls {
                group.addTask { await probe(url) }
            }
            for await hub in group {
                if let hub { report(hub) }
            }
        }
    }

    // Every address on the same /24 network is checked, with a window of connections open at once so the phone is not flooded
    private static func scanNetwork(report: @escaping @Sendable (DiscoveredHub) -> Void) async {
        let own = localIPv4Addresses()
        var hosts: [String] = []
        for ip in own {
            let parts = ip.split(separator: ".")
            guard parts.count == 4 else { continue }
            let base = parts[0...2].joined(separator: ".")
            for last in 1...254 {
                let host = "\(base).\(last)"
                if host != ip && !hosts.contains(host) { hosts.append(host) }
            }
        }
        guard !hosts.isEmpty else { return }
        let port = UInt16(HubAddress.defaultPort)
        let window = 64

        await withTaskGroup(of: DiscoveredHub?.self) { group in
            var next = 0
            func submit(_ host: String, to group: inout TaskGroup<DiscoveredHub?>) {
                group.addTask {
                    guard await portOpen(host: host, port: port, timeout: 0.8),
                          let url = URL(string: "http://\(host):\(port)") else { return nil }
                    return await probe(url)
                }
            }
            while next < min(window, hosts.count) {
                submit(hosts[next], to: &group)
                next += 1
            }
            while let result = await group.next() {
                if let hub = result { report(hub) }
                if Task.isCancelled {
                    group.cancelAll()
                    break
                }
                if next < hosts.count {
                    submit(hosts[next], to: &group)
                    next += 1
                }
            }
        }
    }
}
