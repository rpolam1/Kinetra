import Foundation

enum HubError: LocalizedError, Equatable {
    case badAddress
    case unreachable
    case unauthorized
    case rejected(String)
    case invalidResponse

    var errorDescription: String? {
        switch self {
        case .badAddress: return "That address does not look right. Try something like jetson.local or 192.168.1.20."
        case .unreachable: return "Cannot reach the hub. Check that this device is on the same Wi-Fi network as the hub."
        case .unauthorized: return "The hub rejected the access key. Check the key and try again."
        case .rejected(let message): return message
        case .invalidResponse: return "The hub sent an answer this app does not understand."
        }
    }
}

enum HubAddress {
    static let defaultPort = 5000

    static func normalize(_ text: String) -> URL? {
        var trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        if !trimmed.contains("://") { trimmed = "http://" + trimmed }
        guard var parts = URLComponents(string: trimmed), let host = parts.host, !host.isEmpty else { return nil }
        guard parts.scheme == "http" || parts.scheme == "https" else { return nil }
        if parts.port == nil { parts.port = defaultPort }
        parts.path = ""
        parts.query = nil
        parts.fragment = nil
        return parts.url
    }
}

struct HubClient: Sendable {
    let baseURL: URL
    let apiKey: String
    private let session: URLSession

    init(baseURL: URL, apiKey: String, session: URLSession = HubClient.makeSession()) {
        self.baseURL = baseURL
        self.apiKey = apiKey
        self.session = session
    }

    static func makeSession() -> URLSession {
        let config = URLSessionConfiguration.default
        config.timeoutIntervalForRequest = 6
        config.timeoutIntervalForResource = 15
        config.waitsForConnectivity = false
        return URLSession(configuration: config)
    }

    private static let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    private static let encoder: JSONEncoder = {
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        return encoder
    }()

    private struct PostBody: Encodable {
        let patientId: String
        let deviceId: String
        let samples: [HeartSample]
    }

    func roster() async throws -> Roster {
        try decode(Roster.self, from: try await send("api/watch/roster"))
    }

    func status(patientId: String) async throws -> HeartReading {
        let encoded = patientId.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? patientId
        return try decode(StatusResponse.self, from: try await send("api/vitals/\(encoded)")).status
    }

    func serverTime() async throws -> Double {
        try decode(ServerTime.self, from: try await send("api/time")).t
    }

    func clockOffset() async throws -> Double {
        let before = Date().timeIntervalSince1970
        let server = try await serverTime()
        let after = Date().timeIntervalSince1970
        return server - (before + after) / 2
    }

    func post(samples: [HeartSample], patientId: String, deviceId: String) async throws -> HeartReading {
        let body = try Self.encoder.encode(PostBody(patientId: patientId, deviceId: deviceId, samples: samples))
        return try decode(VitalsResponse.self, from: try await send("api/vitals", method: "POST", body: body)).status
    }

    func tagImageURL(_ tagId: Int, size: Int = 240) -> URL {
        var parts = URLComponents(url: baseURL.appendingPathComponent("api/tags/\(tagId).png"), resolvingAgainstBaseURL: false)
        parts?.queryItems = [URLQueryItem(name: "size", value: String(size))]
        return parts?.url ?? baseURL
    }

    private func decode<T: Decodable>(_ type: T.Type, from data: Data) throws -> T {
        do {
            return try Self.decoder.decode(type, from: data)
        } catch {
            throw HubError.invalidResponse
        }
    }

    private func send(_ path: String, method: String = "GET", body: Data? = nil) async throws -> Data {
        var request = URLRequest(url: baseURL.appendingPathComponent(path))
        request.httpMethod = method
        if !apiKey.isEmpty { request.setValue(apiKey, forHTTPHeaderField: "X-API-Key") }
        if let body {
            request.httpBody = body
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }
        let data: Data
        let response: URLResponse
        do {
            (data, response) = try await session.data(for: request)
        } catch {
            throw HubError.unreachable
        }
        guard let http = response as? HTTPURLResponse else { throw HubError.invalidResponse }
        switch http.statusCode {
        case 200..<300: return data
        case 401: throw HubError.unauthorized
        default:
            let message = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
            throw HubError.rejected(message ?? "The hub returned an error (\(http.statusCode)).")
        }
    }
}

enum HostResolver {
    static func isIPAddress(_ host: String) -> Bool {
        var v4 = in_addr()
        var v6 = in6_addr()
        return inet_pton(AF_INET, host, &v4) == 1 || inet_pton(AF_INET6, host, &v6) == 1
    }

    static func ipv4(for host: String) -> String? {
        var hints = addrinfo()
        hints.ai_family = AF_INET
        hints.ai_socktype = SOCK_STREAM
        var result: UnsafeMutablePointer<addrinfo>?
        guard getaddrinfo(host, nil, &hints, &result) == 0, let info = result else { return nil }
        defer { freeaddrinfo(result) }
        var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        guard getnameinfo(info.pointee.ai_addr, info.pointee.ai_addrlen, &buffer, socklen_t(buffer.count), nil, 0, NI_NUMERICHOST) == 0 else { return nil }
        return String(cString: buffer)
    }

    static func fallbackURL(for url: URL) -> URL? {
        guard let host = url.host, !isIPAddress(host), let address = ipv4(for: host) else { return nil }
        var parts = URLComponents(url: url, resolvingAgainstBaseURL: false)
        parts?.host = address
        return parts?.url
    }
}
