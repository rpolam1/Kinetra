import SwiftUI
import UIKit

/** The first screen. The app looks for the hub on its own, and shows what it is doing. Typing an address is only needed when the search fails. */
struct ConnectView: View {
    @Environment(AppModel.self) private var model
    @State private var address = ""
    @State private var key = ""
    @State private var showManual = false
    @FocusState private var focused: Field?

    private enum Field {
        case address
        case key
    }

    private var radarMode: Radar.Mode {
        switch model.search {
        case .idle, .searching, .choose: return .searching
        case .connecting, .needsKey: return .found
        case .notFound: return .failed
        }
    }

    private var stateKey: String {
        switch model.search {
        case .idle, .searching: return "searching"
        case .connecting(let hub): return "connecting-\(hub.id)"
        case .choose: return "choose"
        case .needsKey: return "key"
        case .notFound: return "notFound"
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 22) {
                VStack(spacing: 10) {
                    PulseLogo(height: 30)
                    Text("KINETRA")
                        .font(.system(.footnote, design: .rounded, weight: .bold))
                        .tracking(5)
                        .foregroundStyle(Brand.ink200)
                }
                .padding(.top, 22)

                Radar(mode: radarMode, blips: model.found.map(\.id))
                    .frame(width: 270, height: 270)

                VStack(spacing: 18) {
                    headline
                    stateContent
                }
                .id(stateKey)
                .transition(.opacity.combined(with: .offset(y: 14)))

                if let message = model.errorMessage {
                    ErrorBanner(message: message)
                }

                manualEntry
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 36)
            .animation(.smooth(duration: 0.45), value: stateKey)
            .animation(.smooth, value: model.errorMessage)
            .animation(.smooth, value: showManual)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .navigationBarTitleDisplayMode(.inline)
        .toolbarBackground(.hidden, for: .navigationBar)
        .task {
            if model.search == .idle { model.startSearch() }
        }
        .onAppear {
            if let pairing = model.pairing {
                address = pairing.hubURL.host.map { host in pairing.hubURL.port.map { "\(host):\($0)" } ?? host } ?? ""
                key = pairing.apiKey
            }
        }
        .sensoryFeedback(trigger: stateKey) { _, new in
            if new.hasPrefix("connecting") { return .success }
            if new == "notFound" { return .warning }
            return nil
        }
    }

    // The headline and the line under it change with each stage of the search
    private var headline: some View {
        VStack(spacing: 8) {
            Text(title)
                .font(.system(.title2, design: .rounded, weight: .bold))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)
            Text(subtitle)
                .font(.subheadline)
                .foregroundStyle(Brand.ink200)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var title: String {
        switch model.search {
        case .idle, .searching: return model.found.isEmpty ? "Looking for your hub" : "Found a hub"
        case .connecting(let hub): return "Connecting to \(hub.name)"
        case .choose: return "Which hub?"
        case .needsKey(let hub): return "\(hub.name) needs its key"
        case .notFound: return model.hasNetwork ? "No hub found" : "Not on Wi-Fi"
        }
    }

    private var subtitle: String {
        switch model.search {
        case .idle, .searching: return "Checking this Wi-Fi network. It only takes a few seconds."
        case .connecting(let hub): return hub.host
        case .choose: return "More than one hub is on this network."
        case .needsKey: return "Enter the access key from the hub setup notes."
        case .notFound:
            return model.hasNetwork
                ? "Make sure the hub is running and this phone is on the same Wi-Fi network."
                : "Join the same Wi-Fi network as the hub, then search again."
        }
    }

    @ViewBuilder
    private var stateContent: some View {
        switch model.search {
        case .idle, .searching, .connecting:
            Text("If iOS asks, allow Local Network access. Without it the phone cannot see the hub.")
                .font(.footnote)
                .foregroundStyle(Brand.ink300)
                .multilineTextAlignment(.center)
                .padding(.horizontal, 12)

        case .choose:
            VStack(spacing: 10) {
                ForEach(Array(model.found.enumerated()), id: \.element.id) { index, hub in
                    Button {
                        Task { await model.connect(to: hub) }
                    } label: {
                        HStack(spacing: 14) {
                            Image(systemName: "wifi.router.fill")
                                .font(.title3)
                                .foregroundStyle(Brand.mint)
                                .frame(width: 40, height: 40)
                                .background(Brand.mint.opacity(0.14), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                            VStack(alignment: .leading, spacing: 2) {
                                Text(hub.name).font(.system(.headline, design: .rounded)).foregroundStyle(.white)
                                Text(hub.host).font(.footnote).foregroundStyle(Brand.ink300)
                            }
                            Spacer()
                            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Brand.ink400)
                        }
                        .cardStyle(padding: 14)
                    }
                    .buttonStyle(PressableStyle())
                    .transition(.opacity.combined(with: .offset(y: 12)))
                    .animation(.smooth.delay(Double(index) * 0.06), value: model.found.count)
                }
            }

        case .needsKey(let hub):
            VStack(spacing: 14) {
                SecureField("", text: $key, prompt: Text("Access key").foregroundStyle(Brand.ink300))
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.go)
                    .focused($focused, equals: .key)
                    .onSubmit { Task { await model.connect(to: hub, key: key) } }
                    .fieldStyle()
                Button {
                    focused = nil
                    Task { await model.connect(to: hub, key: key) }
                } label: {
                    Text("Connect")
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(key.trimmingCharacters(in: .whitespaces).isEmpty)
            }

        case .notFound:
            VStack(spacing: 12) {
                Button {
                    model.startSearch()
                } label: {
                    Label("Search again", systemImage: "arrow.clockwise")
                }
                .buttonStyle(PrimaryButtonStyle())

                if !model.hasNetwork || model.errorMessage == nil {
                    Button {
                        if let url = URL(string: UIApplication.openSettingsURLString) { UIApplication.shared.open(url) }
                    } label: {
                        Label("Check Local Network access", systemImage: "gearshape")
                    }
                    .buttonStyle(SoftButtonStyle())
                }
            }
        }
    }

    // The manual option stays out of the way, since most people never need it
    private var manualEntry: some View {
        VStack(spacing: 14) {
            Button {
                showManual.toggle()
                if showManual { focused = .address }
            } label: {
                HStack(spacing: 6) {
                    Text(showManual ? "Hide manual entry" : "Enter an address instead")
                    Image(systemName: "chevron.down")
                        .rotationEffect(.degrees(showManual ? 180 : 0))
                }
            }
            .buttonStyle(GhostButtonStyle())

            if showManual {
                VStack(spacing: 12) {
                    TextField("", text: $address, prompt: Text("jetson.local or 192.168.1.20").foregroundStyle(Brand.ink300))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .submitLabel(.next)
                        .focused($focused, equals: .address)
                        .onSubmit { focused = .key }
                        .fieldStyle()
                    SecureField("", text: $key, prompt: Text("Access key (optional)").foregroundStyle(Brand.ink300))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .focused($focused, equals: .key)
                        .onSubmit { connectManually() }
                        .fieldStyle()
                    Button(action: connectManually) {
                        if model.isBusy { ProgressView().tint(.white) } else { Text("Connect") }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty || model.isBusy)
                }
                .transition(.opacity.combined(with: .offset(y: -8)))
            }
        }
        .padding(.top, 6)
    }

    private func connectManually() {
        focused = nil
        Task { await model.connectManually(address: address, key: key) }
    }
}

private extension View {
    /** The rounded input box used for the address and key. */
    func fieldStyle() -> some View {
        self
            .foregroundStyle(.white)
            .padding(16)
            .background(Brand.ink800, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).strokeBorder(.white.opacity(0.08), lineWidth: 1))
    }
}

/** The search animation. Rings spread out from the centre and a beam sweeps around while the app looks. Each hub that is found shows up as a dot. */
private struct Radar: View {
    enum Mode {
        case searching
        case found
        case failed
    }

    let mode: Mode
    let blips: [String]

    private var tint: Color {
        switch mode {
        case .searching: return Brand.mint
        case .found: return HeartStatus.inZone.tint
        case .failed: return HeartStatus.above.tint
        }
    }

    // The same hub always appears at the same spot, because the position comes from its id
    private func blipPosition(_ id: String, radius: CGFloat) -> CGPoint {
        let sum = id.unicodeScalars.reduce(0) { $0 &+ Int($1.value) }
        let angle = Double(sum % 360) * .pi / 180
        let distance = radius * (0.5 + 0.35 * CGFloat((sum / 7) % 10) / 10)
        return CGPoint(x: cos(angle) * distance, y: sin(angle) * distance)
    }

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / 30.0, paused: mode != .searching)) { context in
            let time = context.date.timeIntervalSinceReferenceDate
            GeometryReader { proxy in
                let radius = min(proxy.size.width, proxy.size.height) / 2

                ZStack {
                    ForEach(0..<3, id: \.self) { index in
                        let phase = mode == .searching
                            ? (time / 2.6 + Double(index) / 3).truncatingRemainder(dividingBy: 1)
                            : 0.38 + Double(index) * 0.26
                        Circle()
                            .stroke(tint.opacity((1 - phase) * (mode == .searching ? 0.6 : 0.25)), lineWidth: 1.5)
                            .scaleEffect(0.22 + 0.78 * phase)
                    }

                    if mode == .searching {
                        Circle()
                            .fill(AngularGradient(stops: [.init(color: .clear, location: 0), .init(color: .clear, location: 0.8), .init(color: tint.opacity(0.4), location: 1)], center: .center))
                            .rotationEffect(.degrees(time * 140))
                            .mask(Circle())
                    }

                    ForEach(blips, id: \.self) { id in
                        let point = blipPosition(id, radius: radius)
                        LiveDot(color: .white)
                            .scaleEffect(1.3)
                            .offset(x: point.x, y: point.y)
                            .transition(.scale.combined(with: .opacity))
                    }

                    Circle()
                        .fill(Brand.ink800)
                        .overlay(Circle().strokeBorder(tint.opacity(0.5), lineWidth: 1.5))
                        .frame(width: 78, height: 78)
                        .shadow(color: tint.opacity(0.45), radius: 18)
                        .overlay {
                            Image(systemName: symbol)
                                .font(.system(size: 30, weight: .semibold))
                                .foregroundStyle(tint)
                                .contentTransition(.symbolEffect(.replace))
                        }
                }
                .frame(width: proxy.size.width, height: proxy.size.height)
            }
        }
        .animation(.smooth, value: mode)
        .animation(.spring(response: 0.5, dampingFraction: 0.7), value: blips)
        .accessibilityHidden(true)
    }

    private var symbol: String {
        switch mode {
        case .searching: return "wifi"
        case .found: return "checkmark"
        case .failed: return "wifi.exclamationmark"
        }
    }
}
