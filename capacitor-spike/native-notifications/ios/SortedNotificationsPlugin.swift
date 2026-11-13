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
        // G466: the plugin is normally registered at startup through
        // packageClassList (added by setup-ios-notifications.sh), which is
        // what puts it in Capacitor.PluginHeaders the same way the npm
        // plugins are. Only fall back to a manual registration if that did
        // not happen, so it is never registered (and exported) twice.
        guard let bridge = bridge, bridge.plugin(withName: "SortedNotifications") == nil else { return }
        bridge.registerPluginInstance(SortedNotificationsPlugin())
    }
}
