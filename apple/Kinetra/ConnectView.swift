import SwiftUI

/** The first screen. The person types the hub address and an optional access key. */
struct ConnectView: View {
    @Environment(AppModel.self) private var model
    @State private var address = ""
    @State private var key = ""
    @FocusState private var focused: Field?

    private enum Field {
        case address
        case key
    }

    // The fields are filled with the saved values so changing the hub does not mean typing everything again
    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                Image("Logo")
                    .resizable()
                    .scaledToFit()
                    .frame(height: 52)
                    .padding(.top, 24)
                    .accessibilityLabel("Kinetra")

                VStack(spacing: 8) {
                    Text("Connect to the hub").font(.title.bold())
                    Text("Enter the address of the Kinetra hub. This phone and the hub need to be on the same Wi-Fi network.")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                }

                VStack(alignment: .leading, spacing: 16) {
                    labeled("Hub address") {
                        TextField("jetson.local", text: $address)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .keyboardType(.URL)
                            .submitLabel(.next)
                            .focused($focused, equals: .address)
                            .onSubmit { focused = .key }
                    }
                    labeled("Access key (if the hub uses one)") {
                        SecureField("Optional", text: $key)
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                            .submitLabel(.go)
                            .focused($focused, equals: .key)
                            .onSubmit { connect() }
                    }
                }

                if let message = model.errorMessage {
                    ErrorBanner(message: message)
                }

                Button(action: connect) {
                    if model.isBusy {
                        ProgressView().tint(.white)
                    } else {
                        Text("Connect")
                    }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(address.trimmingCharacters(in: .whitespaces).isEmpty || model.isBusy)

                VStack(alignment: .leading, spacing: 10) {
                    Label("The technician can find the address and key in the hub setup notes.", systemImage: "info.circle")
                    Label("The first time, allow Local Network access when iOS asks.", systemImage: "wifi")
                }
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 32)
        }
        .scrollDismissesKeyboard(.interactively)
        .navigationBarTitleDisplayMode(.inline)
        .onAppear {
            if let pairing = model.pairing {
                address = pairing.hubURL.host.map { host in pairing.hubURL.port.map { "\(host):\($0)" } ?? host } ?? ""
                key = pairing.apiKey
            }
        }
    }

    /** Dismisses the keyboard and tries to connect. */
    private func connect() {
        focused = nil
        Task { await model.connect(address: address, key: key) }
    }

    /** Puts a title above a field and gives the field a rounded background. */
    private func labeled<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.subheadline.weight(.medium)).foregroundStyle(.secondary)
            content()
                .padding(14)
                .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
    }
}
