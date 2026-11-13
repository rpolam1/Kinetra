import Foundation
import WatchConnectivity

/** The watch side of the link to the iPhone. It receives the hub details and the end command. */
final class WatchLink: NSObject, WCSessionDelegate, @unchecked Sendable {
    var onPairing: (@Sendable (HubPairing) -> Void)?
    var onEnd: (@Sendable () -> Void)?

    /** Starts the connection. The delegate is set first so no event is missed. */
    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    // Details sent while the watch app was closed are waiting, so they are read as soon as the connection is ready
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

    /** Decodes the hub details and passes them on. Anything that does not decode is ignored. */
    private func deliver(_ context: [String: Any]) {
        guard let data = context[LinkKey.pairing] as? Data,
              let pairing = try? JSONDecoder().decode(HubPairing.self, from: data) else { return }
        onPairing?(pairing)
    }
}
