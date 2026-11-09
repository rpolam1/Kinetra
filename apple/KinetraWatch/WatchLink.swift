import Foundation
import WatchConnectivity

final class WatchLink: NSObject, WCSessionDelegate, @unchecked Sendable {
    var onPairing: (@Sendable (HubPairing) -> Void)?
    var onEnd: (@Sendable () -> Void)?

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated else { return }
        deliver(session.receivedApplicationContext)
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        deliver(applicationContext)
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        if message[LinkKey.command] as? String == LinkCommand.end {
            onEnd?()
        }
    }

    private func deliver(_ context: [String: Any]) {
        guard let data = context[LinkKey.pairing] as? Data,
              let pairing = try? JSONDecoder().decode(HubPairing.self, from: data) else { return }
        onPairing?(pairing)
    }
}
