package co.uk.auriqltd.sorted;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Read-only notification state and an OS-settings hand-off for Sorted's web
 * layer. Permission prompts and FCM registration deliberately stay in the
 * existing PushNotifications plugin.
 */
@CapacitorPlugin(name = "SortedNotifications")
public class SortedNotificationsPlugin extends Plugin {
    private static final String MONEY_UPDATES_CHANNEL = "money_updates";

    @PluginMethod
    public void getStatus(PluginCall call) {
        boolean appEnabled = NotificationManagerCompat.from(getContext()).areNotificationsEnabled();
        boolean channelEnabled = true;

        // Channels were introduced in Android 8. A missing channel means this
        // binary has not created it yet, not that the person disabled it.
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.app.NotificationManager manager = getContext().getSystemService(android.app.NotificationManager.class);
            android.app.NotificationChannel channel = manager == null ? null : manager.getNotificationChannel(MONEY_UPDATES_CHANNEL);
            channelEnabled = channel == null || channel.getImportance() != android.app.NotificationManager.IMPORTANCE_NONE;
        }

        JSObject result = new JSObject();
        result.put("enabled", appEnabled && channelEnabled);
        result.put("channelEnabled", channelEnabled);
        call.resolve(result);
    }

    @PluginMethod
    public void openSettings(PluginCall call) {
        try {
            Intent intent;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            } else {
                intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                    .setData(Uri.fromParts("package", getContext().getPackageName(), null));
            }
            getActivity().startActivity(intent);
            call.resolve();
        } catch (Exception error) {
            call.reject("Could not open Android notification settings", error);
        }
    }
}
