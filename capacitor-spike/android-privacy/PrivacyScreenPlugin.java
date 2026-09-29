package co.uk.auriqltd.sorted;

import android.view.Window;
import android.view.WindowManager;

import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * A122: toggles FLAG_SECURE on the activity window so the recents / app
 * switcher thumbnail is blank. The web layer calls setEnabled(true) while the
 * biometric lock preference is on. Side effect, by design of the flag: user
 * screenshots and screen recording are also blocked while enabled.
 * Installed into the generated android/ project by
 * scripts/setup-android-privacy.sh.
 */
@CapacitorPlugin(name = "PrivacyScreen")
public class PrivacyScreenPlugin extends Plugin {
    @PluginMethod
    public void setEnabled(final PluginCall call) {
        final boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        getActivity().runOnUiThread(() -> {
            Window window = getActivity().getWindow();
            if (enabled) {
                window.setFlags(WindowManager.LayoutParams.FLAG_SECURE, WindowManager.LayoutParams.FLAG_SECURE);
            } else {
                window.clearFlags(WindowManager.LayoutParams.FLAG_SECURE);
            }
            call.resolve();
        });
    }
}
