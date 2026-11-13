import Capacitor
import UIKit
import UserNotifications

@objc(SortedNotificationsPlugin)
public class SortedNotificationsPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "SortedNotificationsPlugin"
    public let jsName = "SortedNotifications"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "getStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "openSettings", returnType: CAPPluginReturnPromise),
    ]

    @objc public func getStatus(_ call: CAPPluginCall) {
        UNUserNotificationCenter.current().getNotificationSettings { settings in
            let enabled: Bool
            switch settings.authorizationStatus {
            case .authorized, .provisional, .ephemeral:
                enabled = true
            case .denied, .notDetermined:
                enabled = false
            @unknown default:
                enabled = false
            }
            call.resolve(["enabled": enabled])
        }
    }

    @objc public func openSettings(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            guard let url = URL(string: UIApplication.openSettingsURLString) else {
                call.reject("Could not create the iOS Settings URL")
                return
            }
            UIApplication.shared.open(url, options: [:]) { opened in
                if opened {
                    call.resolve()
                } else {
                    call.reject("Could not open iOS notification settings")
                }
            }
        }
    }
}

public final class SortedBridgeViewController: CAPBridgeViewController {
    public override func capacitorDidLoad() {
        super.capacitorDidLoad()
        // G466: belt-and-braces. The plugin is also registered via
        // packageClassList at bridge start (setup-ios-notifications.sh); this
        // runtime fallback remains, and only runs if that did not happen so
        // it is never registered twice. The NSLog lines are on-device
        // evidence for the next TestFlight build (device console / Xcode).
        NSLog("[G466] capacitorDidLoad controller=%@ isSortedBridge=%@", String(describing: type(of: self)), String(self is SortedBridgeViewController))
        NSLog("[G466] SortedNotifications registered before fallback: %@", String(bridge?.plugin(withName: "SortedNotifications") != nil))
        defer { NSLog("[G466] SortedNotifications registered after fallback: %@", String(bridge?.plugin(withName: "SortedNotifications") != nil)) }
        guard let bridge = bridge, bridge.plugin(withName: "SortedNotifications") == nil else { return }
        bridge.registerPluginInstance(SortedNotificationsPlugin())
    }
}
