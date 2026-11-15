import SwiftUI

/** Picks the screen from the current step, with a soft cross fade between them. */
struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            ZStack {
                switch model.step {
                case .connect:
                    ConnectView()
                        .transition(.opacity.combined(with: .scale(scale: 0.97)))
                case .choose:
                    PersonPickerView()
                        .transition(.opacity.combined(with: .scale(scale: 1.02)))
                case .monitor:
                    MonitorView()
                        .transition(.opacity.combined(with: .scale(scale: 1.02)))
                }
            }
            .background { AppBackdrop() }
            .animation(.smooth(duration: 0.5), value: model.step)
        }
        .tint(Brand.mint)
        .preferredColorScheme(.dark)
    }
}