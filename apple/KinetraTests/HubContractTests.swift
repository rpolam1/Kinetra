import XCTest

/** Tests that the app reads and writes the same JSON as the Python hub. The samples are shaped like the hub's real answers. */
final class HubContractTests: XCTestCase {
    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }()

    func testDecodesAVitalsResponseFromTheHub() throws {
        let json = #"{"accepted": 1, "ok": true, "status": {"age_seconds": 0.0, "bpm": 120, "message": "In target zone", "status": "in_zone", "zone": {"high": 132, "low": 108, "max": 180, "resting": 60}}}"#
        let response = try decoder.decode(VitalsResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.accepted, 1)
        XCTAssertEqual(response.status.bpm, 120)
        XCTAssertEqual(response.status.status, .inZone)
        XCTAssertEqual(response.status.zone, HeartZone(low: 108, high: 132, max: 180, resting: 60))
    }

    func testDecodesAReadingWithoutAZone() throws {
        let json = #"{"accepted": 1, "ok": true, "status": {"age_seconds": 0.0, "bpm": 100, "message": "No target zone set. Heart rate shown for reference", "status": "no_target", "zone": null}}"#
        let response = try decoder.decode(VitalsResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.status.status, .noTarget)
        XCTAssertNil(response.status.zone)
    }

    func testDecodesAStatusWithNoSignal() throws {
        let json = #"{"patient_id": "P-0001", "status": {"age_seconds": null, "bpm": null, "message": "No heart-rate signal", "status": "no_signal", "zone": null}}"#
        let response = try decoder.decode(StatusResponse.self, from: Data(json.utf8))
        XCTAssertEqual(response.patientId, "P-0001")
        XCTAssertNil(response.status.bpm)
        XCTAssertEqual(response.status.status, .noSignal)
    }

    func testDecodesTheRosterTheWatchPickerUses() throws {
        let json = #"{"people": [{"display_name": "Ana K.", "in_session": true, "in_view": false, "patient_id": "P-0001", "tag_id": 12, "watch_connected": true}], "server_time": 1000.0, "session_active": true, "tags_managed": true}"#
        let roster = try decoder.decode(Roster.self, from: Data(json.utf8))
        XCTAssertTrue(roster.sessionActive)
        XCTAssertEqual(roster.people.first?.tagId, 12)
        XCTAssertEqual(roster.people.first?.selection, SelectedPerson(tagId: 12, patientId: "P-0001", displayName: "Ana K."))
    }

    func testEveryHubStatusIsKnown() throws {
        for status in ["no_signal", "no_target", "unreliable", "below", "in_zone", "above", "high"] {
            XCTAssertNotNil(HeartStatus(rawValue: status), status)
        }
    }

    func testSamplesAreSentWithTheKeysTheHubExpects() throws {
        struct Body: Encodable {
            let patientId: String
            let deviceId: String
            let samples: [HeartSample]
        }
        let encoder = JSONEncoder()
        encoder.keyEncodingStrategy = .convertToSnakeCase
        let data = try encoder.encode(Body(patientId: "P-0001", deviceId: "Watch", samples: [HeartSample(t: 10, bpm: 90)]))
        let object = try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
        XCTAssertEqual(object["patient_id"] as? String, "P-0001")
        XCTAssertEqual(object["device_id"] as? String, "Watch")
        let sample = try XCTUnwrap((object["samples"] as? [[String: Any]])?.first)
        XCTAssertEqual(sample["t"] as? Double, 10)
        XCTAssertEqual(sample["bpm"] as? Double, 90)
    }
}

/** Tests for turning typed text into a hub address. */
final class HubAddressTests: XCTestCase {
    func testAddsSchemeAndDefaultPort() {
        XCTAssertEqual(HubAddress.normalize("jetson.local")?.absoluteString, "http://jetson.local:5000")
        XCTAssertEqual(HubAddress.normalize(" 192.168.1.20 ")?.absoluteString, "http://192.168.1.20:5000")
    }

    func testKeepsAnExplicitPortAndScheme() {
        XCTAssertEqual(HubAddress.normalize("jetson.local:8080")?.absoluteString, "http://jetson.local:8080")
        XCTAssertEqual(HubAddress.normalize("https://hub.example.com/extra?x=1")?.absoluteString, "https://hub.example.com:5000")
    }

    func testRejectsNonsense() {
        XCTAssertNil(HubAddress.normalize(""))
        XCTAssertNil(HubAddress.normalize("   "))
        XCTAssertNil(HubAddress.normalize("ftp://hub"))
    }

    func testRecognisesIPAddresses() {
        XCTAssertTrue(HostResolver.isIPAddress("192.168.1.20"))
        XCTAssertFalse(HostResolver.isIPAddress("jetson.local"))
    }

    func testBuildsTheTagImageAddress() {
        let client = HubClient(baseURL: URL(string: "http://jetson.local:5000")!, apiKey: "")
        XCTAssertEqual(client.tagImageURL(12, size: 200).absoluteString, "http://jetson.local:5000/api/tags/12.png?size=200")
    }
}
