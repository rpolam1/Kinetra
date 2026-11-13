import SwiftUI

/** Picks the screen from the current step. */
struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        NavigationStack {
            switch model.step {
            case .connect:
                ConnectView()
            case .choose:
                PersonPickerView()
            case .monitor:
                MonitorView()
            }
        }
        .tint(Brand.teal)
        .animation(.easeInOut(duration: 0.25), value: model.step)
    }
}
