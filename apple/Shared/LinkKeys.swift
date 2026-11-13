import Foundation

/** The keys of the messages sent between the phone and the watch. */
enum LinkKey {
    static let pairing = "pairing"
    static let command = "command"
}

/** The commands the phone can send to the watch. */
enum LinkCommand {
    static let end = "end"
}
