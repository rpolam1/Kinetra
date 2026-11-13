import XCTest

/** Tests for the heart rate calculations shared by the phone and the watch. */
final class HeartMathTests: XCTestCase {
    // Resting 60 and max 180 make the zone edges land on easy numbers, 0.4 and 0.6 of the scale
    private let zone = HeartZone(low: 108, high: 132, max: 180, resting: 60)

    func testPositionIsClampedBetweenRestingAndMax() {
        XCTAssertEqual(HeartMath.position(bpm: 60, zone: zone), 0, accuracy: 0.0001)
        XCTAssertEqual(HeartMath.position(bpm: 120, zone: zone), 0.5, accuracy: 0.0001)
        XCTAssertEqual(HeartMath.position(bpm: 200, zone: zone), 1, accuracy: 0.0001)
        XCTAssertEqual(HeartMath.position(bpm: 40, zone: zone), 0, accuracy: 0.0001)
    }

    func testPositionWithoutAZoneUsesATwoHundredScale() {
        XCTAssertEqual(HeartMath.position(bpm: 100, zone: nil), 0.5, accuracy: 0.0001)
    }

    func testZoneBandMatchesTheZoneEdges() {
        let band = HeartMath.zoneBand(zone)
        XCTAssertEqual(band.lowerBound, 0.4, accuracy: 0.0001)
        XCTAssertEqual(band.upperBound, 0.6, accuracy: 0.0001)
    }

    func testSummaryCountsTimeInEachBand() throws {
        var samples: [HeartSample] = []
        let bpms: [Double] = [90, 90, 90, 90, 90, 120, 120, 120, 120, 120, 120, 120, 120, 120, 120, 145, 145, 145, 145, 145]
        for (index, bpm) in bpms.enumerated() { samples.append(HeartSample(t: Double(index), bpm: bpm)) }
        let summary = try XCTUnwrap(HeartMath.summarize(samples, zone: zone))
        XCTAssertEqual(summary.samples, 20)
        XCTAssertEqual(summary.minBpm, 90)
        XCTAssertEqual(summary.maxBpm, 145)
        XCTAssertEqual(summary.secondsBelow, 5)
        XCTAssertEqual(summary.secondsInZone, 10)
        XCTAssertEqual(summary.secondsAbove, 5)
        XCTAssertEqual(try XCTUnwrap(summary.inZoneShare), 0.5, accuracy: 0.0001)
    }

    func testSummaryWithoutAZoneHasNoZoneTimes() throws {
        let summary = try XCTUnwrap(HeartMath.summarize([HeartSample(t: 0, bpm: 100), HeartSample(t: 5, bpm: 110)], zone: nil))
        XCTAssertNil(summary.secondsInZone)
        XCTAssertNil(summary.inZoneShare)
        XCTAssertEqual(summary.averageBpm, 105)
    }

    func testLongGapsAreCapped() throws {
        let summary = try XCTUnwrap(HeartMath.summarize([HeartSample(t: 0, bpm: 120), HeartSample(t: 600, bpm: 120)], zone: zone))
        XCTAssertEqual(summary.secondsInZone, 11)
    }

    func testNoSamplesGiveNoSummary() {
        XCTAssertNil(HeartMath.summarize([], zone: zone))
    }

    func testElapsedText() {
        XCTAssertEqual(HeartMath.elapsedText(65), "1:05")
        XCTAssertEqual(HeartMath.elapsedText(3725), "1:02:05")
        XCTAssertEqual(HeartMath.elapsedText(-3), "0:00")
    }
}
