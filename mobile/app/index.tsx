import { useRef, useState, useEffect, useCallback } from "react";
import { StyleSheet, BackHandler, View, Text, TouchableOpacity, ActivityIndicator, StatusBar, Platform, Linking } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, WebViewMessageEvent, WebViewNavigation } from "react-native-webview";
import {
  GoogleSignin,
  isSuccessResponse,
} from "@react-native-google-signin/google-signin";
import * as WebBrowser from "expo-web-browser";
import * as LocalAuthentication from "expo-local-authentication";
import * as SecureStore from "expo-secure-store";
import * as ImagePicker from "expo-image-picker";
import Constants from "expo-constants";
import * as Location from "expo-location";
import * as Notifications from "expo-notifications";

const DASHBOARD_URL = "https://wealth.auriqltd.co.uk";
const NATIVE_AUTH_URL = `${DASHBOARD_URL}/api/auth/google/native`;
const NATIVE_PUSH_URL = `${DASHBOARD_URL}/api/push/native-subscribe`;
const SESSION_TOKEN_KEY = "wealth_session_token";
const EAS_PROJECT_ID = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
  ?.eas?.projectId;
const BG_LIGHT = "#f0f2f7";
const BG_DARK  = "#0f172a";

const extra = (Constants.expoConfig?.extra ?? {}) as {
  googleWebClientId?: string;
  googleIosClientId?: string;
};

GoogleSignin.configure({
  webClientId: extra.googleWebClientId,
  iosClientId: extra.googleIosClientId || undefined,
  offlineAccess: false,
});

// In edge-to-edge mode Android ignores StatusBar.backgroundColor — the status
// bar background is always the app content behind it (bgColor). So we only
// need to track dark mode to pick the right icon colour.
const POST_LOAD_JS = `
  (function() {
    const s = document.createElement('style');
    s.textContent = '[style*="env(safe-area-inset-top"]{padding-top:0!important}.safe-top{padding-top:0!important}[style*="env(safe-area-inset-bottom"]{padding-bottom:0!important}';
    document.head.appendChild(s);

    function send() {
      const dark = document.documentElement.classList.contains('dark');
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'update', dark }));
    }
    new MutationObserver(send).observe(document.documentElement, { attributes: true });
    send();

    try {
      const token = window.localStorage.getItem('${SESSION_TOKEN_KEY}');
      if (token) {
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'auth', token: token }));
      }
    } catch (e) {}
  })();
  true;
`;

// Notifications received while the app is foregrounded should still surface.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// iOS WKWebView does not bridge navigator.geolocation to CoreLocation, so the
// in-page "Use my current location" call silently fails. We override the API to
// post a request to RN, fetch the position natively via expo-location, and
// inject the result back. Android handles geolocation natively (geolocationEnabled
// prop), so this polyfill is injected on iOS only.
const GEO_POLYFILL_JS = `
  (function() {
    if (!navigator.geolocation) navigator.geolocation = {};
    var pending = {};
    var seq = 0;
    window.__geoResolve = function(id, pos) {
      var cb = pending[id]; if (!cb) return; delete pending[id];
      if (cb.success) cb.success(pos);
    };
    window.__geoReject = function(id, err) {
      var cb = pending[id]; if (!cb) return; delete pending[id];
      if (cb.error) cb.error(err);
    };
    navigator.geolocation.getCurrentPosition = function(success, error, options) {
      var id = ++seq;
      pending[id] = { success: success, error: error };
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'geo:request', id: id, options: options || {} }));
    };
    navigator.geolocation.watchPosition = function(success, error, options) {
      navigator.geolocation.getCurrentPosition(success, error, options);
      return 0;
    };
    navigator.geolocation.clearWatch = function() {};
  })();
  true;
`;

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const loggingIn = useRef(false);
  const pushRegisteredFor = useRef<string | null>(null);
  const firstLoadDone = useRef(false);
  const [darkMode, setDarkMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sourceUri, setSourceUri] = useState(DASHBOARD_URL);
  // null = checking, false = locked, true = go
  const [unlocked, setUnlocked] = useState<boolean | null>(null);

  const tryUnlock = useCallback(async () => {
    try {
      const pref = await SecureStore.getItemAsync("biometric_lock");
      if (pref === "0") { setUnlocked(true); return; } // user turned the lock off
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      if (!hasHardware || !enrolled) { setUnlocked(true); return; } // no biometrics set up — don't lock the user out
      const res = await LocalAuthentication.authenticateAsync({
        promptMessage: "Unlock your dashboard",
      });
      setUnlocked(res.success ? true : false);
    } catch {
      setUnlocked(true); // never brick the app on an auth-layer error
    }
  }, []);

  useEffect(() => { tryUnlock(); }, [tryUnlock]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      webViewRef.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, []);

  // Tapping a push notification opens the app to the notification's target URL.
  // If a page is already loaded, navigate in-place (a source-prop change is
  // ignored when the string is identical, e.g. two transaction pushes in a row);
  // otherwise point the WebView's initial load at the target.
  const openPushUrl = useCallback((url: unknown) => {
    if (typeof url !== "string" || !url) return;
    const full = url.startsWith("http") ? url : `${DASHBOARD_URL}${url}`;
    if (webViewRef.current && firstLoadDone.current) {
      webViewRef.current.injectJavaScript(`window.location.assign(${JSON.stringify(full)}); true;`);
    } else {
      setLoading(true);
      setSourceUri(full);
    }
  }, []);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      openPushUrl(response.notification.request.content.data?.url);
      Notifications.clearLastNotificationResponseAsync().catch(() => {});
    });
    return () => sub.remove();
  }, [openPushUrl]);

  // The listener above never fires for the tap that launched the app from a
  // killed state — that response has to be fetched (and cleared, so a later
  // normal launch doesn't replay it).
  useEffect(() => {
    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        const url = response?.notification.request.content.data?.url;
        if (url) {
          openPushUrl(url);
          Notifications.clearLastNotificationResponseAsync().catch(() => {});
        }
      })
      .catch(() => {});
  }, [openPushUrl]);

  // Reload the WebView with the session token so the website stores it and
  // logs itself in.
  const applyToken = useCallback((token: string) => {
    setLoading(true);
    setSourceUri(`${DASHBOARD_URL}?token=${encodeURIComponent(token)}`);
  }, []);

  function onMessage(e: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === "update") setDarkMode(!!msg.dark);
      else if (msg.type === "geo:request") handleGeoRequest(msg.id, msg.options);
      else if (msg.type === "camera:request") handleCameraRequest(msg.id);
      else if (msg.type === "biometrics:get") handleBiometricsGet(msg.id);
      else if (msg.type === "biometrics:set") SecureStore.setItemAsync("biometric_lock", msg.enabled ? "1" : "0").catch(() => {});
      else if (msg.type === "auth" && msg.token) registerForPush(msg.token);
      else if (msg.type === "open_external" && msg.url) {
        // Use an in-app Chrome Custom Tab (Android) / SFSafariViewController (iOS)
        // so we can detect the wealthdash:// redirect and auto-close + reload.
        WebBrowser.openAuthSessionAsync(msg.url, "wealthdash://auth-complete").then(result => {
          if (result.type === "success") webViewRef.current?.reload();
        });
      }
    } catch {}
  }

  // Web Settings asks whether the biometric lock is available and enabled
  async function handleBiometricsGet(id: string) {
    let supported = false;
    let enabled = true;
    try {
      const [hasHardware, enrolled] = await Promise.all([
        LocalAuthentication.hasHardwareAsync(),
        LocalAuthentication.isEnrolledAsync(),
      ]);
      supported = hasHardware && enrolled;
      enabled = (await SecureStore.getItemAsync("biometric_lock")) !== "0";
    } catch {}
    const js = `window.dispatchEvent(new CustomEvent('native-biometrics', { detail: ${JSON.stringify({ id, supported, enabled })} })); true;`;
    webViewRef.current?.injectJavaScript(js);
  }

  // Native camera for receipt capture — the WebView file-input camera route is
  // unreliable across Android WebView versions; this always works.
  async function handleCameraRequest(id: string) {
    const send = (payload: object) => {
      const js = `window.dispatchEvent(new CustomEvent('native-camera', { detail: ${JSON.stringify({ id, ...payload })} })); true;`;
      webViewRef.current?.injectJavaScript(js);
    };
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) { send({ error: "permission" }); return; }
      const result = await ImagePicker.launchCameraAsync({ quality: 0.7, base64: true });
      if (result.canceled || !result.assets?.[0]?.base64) { send({ error: "cancelled" }); return; }
      send({ base64: result.assets[0].base64, mime: result.assets[0].mimeType ?? "image/jpeg" });
    } catch {
      send({ error: "failed" });
    }
  }

  // Once the WebView reports a logged-in session token, register this device's
  // Expo push token against it. Guarded so re-renders / navigations don't
  // re-register the same session. (Native push only works in a dev/EAS build —
  // it is a no-op in Expo Go.)
  async function registerForPush(sessionToken: string) {
    if (pushRegisteredFor.current === sessionToken) return;
    pushRegisteredFor.current = sessionToken;
    try {
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "Default",
          importance: Notifications.AndroidImportance.DEFAULT,
        });
      }
      const existing = await Notifications.getPermissionsAsync();
      let status = existing.status;
      if (status !== "granted") {
        const req = await Notifications.requestPermissionsAsync();
        status = req.status;
      }
      if (status !== "granted") {
        pushRegisteredFor.current = null;
        return;
      }
      const tokenResp = await Notifications.getExpoPushTokenAsync(
        EAS_PROJECT_ID ? { projectId: EAS_PROJECT_ID } : undefined,
      );
      const res = await fetch(NATIVE_PUSH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${sessionToken}`,
        },
        body: JSON.stringify({ token: tokenResp.data, platform: Platform.OS }),
      });
      if (!res.ok) pushRegisteredFor.current = null;
    } catch {
      pushRegisteredFor.current = null;
    }
  }

  function resolveGeo(id: number, pos: Location.LocationObject) {
    const payload = JSON.stringify({
      coords: {
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
        accuracy: pos.coords.accuracy,
        altitude: pos.coords.altitude,
        altitudeAccuracy: pos.coords.altitudeAccuracy,
        heading: pos.coords.heading,
        speed: pos.coords.speed,
      },
      timestamp: pos.timestamp,
    });
    webViewRef.current?.injectJavaScript(`window.__geoResolve(${id}, ${payload}); true;`);
  }

  function rejectGeo(id: number, code: number, message: string) {
    const payload = JSON.stringify({ code, message });
    webViewRef.current?.injectJavaScript(`window.__geoReject(${id}, ${payload}); true;`);
  }

  // Bridges the WebView's navigator.geolocation polyfill to native CoreLocation.
  async function handleGeoRequest(id: number, options?: { enableHighAccuracy?: boolean }) {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        rejectGeo(id, 1, "Location permission denied");
        return;
      }
      const accuracy = options?.enableHighAccuracy
        ? Location.Accuracy.High
        : Location.Accuracy.Balanced;
      const timeout = new Promise<never>((_, rej) =>
        setTimeout(() => rej(new Error("timeout")), 15000),
      );
      const pos = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy }),
        timeout,
      ]);
      resolveGeo(id, pos as Location.LocationObject);
    } catch {
      rejectGeo(id, 2, "Position unavailable");
    }
  }

  // The web "Continue with Google" button navigates to /api/auth/google. We
  // intercept it and run the platform-native Google Sign-In (Play Services on
  // Android, the Google SDK on iOS) — no browser, no redirect. The native SDK
  // returns an idToken which the backend verifies and exchanges for a session
  // token; we then reload the WebView with that token.
  async function startGoogleLogin() {
    if (loggingIn.current) return;
    loggingIn.current = true;
    try {
      await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
      await GoogleSignin.signOut();
      const response = await GoogleSignin.signIn();
      if (!isSuccessResponse(response)) return;
      const idToken = response.data?.idToken;
      if (!idToken) return;
      const res = await fetch(NATIVE_AUTH_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id_token: idToken }),
      });
      if (!res.ok) return;
      const data = await res.json();
      if (data.session_token) applyToken(data.session_token);
    } catch {
      // User cancelled or sign-in failed — stay on the login screen.
    } finally {
      loggingIn.current = false;
    }
  }

  function onShouldStart(req: WebViewNavigation) {
    if (
      req.url.includes("/api/auth/google") &&
      !req.url.includes("/mobile") &&
      !req.url.includes("/callback")
    ) {
      startGoogleLogin();
      return false;
    }
    // Safety net: if the WebView somehow navigates to a bank auth URL directly,
    // intercept and open in the Custom Tab instead.
    if (req.url.includes("auth.truelayer.com") || req.url.includes("auth.yapily.com") || req.url.includes("finexer.com/connect")) {
      WebBrowser.openAuthSessionAsync(req.url, "wealthdash://auth-complete").then(result => {
        if (result.type === "success") webViewRef.current?.reload();
      });
      return false;
    }
    return true;
  }

  const bgColor = darkMode ? BG_DARK : BG_LIGHT;
  // The bottom inset sits directly below the in-page bottom nav, so paint it the
  // nav's colour (white in light mode) rather than the page background to avoid
  // a mismatched strip behind the gesture bar.
  const navColor = darkMode ? BG_DARK : "#ffffff";
  const barStyle = darkMode ? "light-content" : "dark-content";

  // Biometric gate: the dashboard is full financial data — require Face/
  // fingerprint before rendering anything (devices without biometrics pass
  // straight through)
  if (unlocked !== true) {
    return (
      <>
        <StatusBar backgroundColor={bgColor} barStyle={barStyle} translucent={false} />
        <SafeAreaView style={[styles.container, { backgroundColor: bgColor, alignItems: "center", justifyContent: "center" }]}>
          {unlocked === null ? (
            <ActivityIndicator size="large" color="#4f46e5" />
          ) : (
            <View style={{ alignItems: "center", gap: 16, paddingHorizontal: 32 }}>
              <Text style={{ fontSize: 18, fontWeight: "700", color: darkMode ? "#e2e8f0" : "#0f172a" }}>
                Dashboard locked
              </Text>
              <Text style={{ fontSize: 13, textAlign: "center", color: darkMode ? "#94a3b8" : "#64748b" }}>
                Unlock with your fingerprint or face to see your finances.
              </Text>
              <TouchableOpacity
                onPress={tryUnlock}
                style={{ backgroundColor: "#4f46e5", paddingHorizontal: 28, paddingVertical: 12, borderRadius: 14 }}
              >
                <Text style={{ color: "#fff", fontWeight: "700", fontSize: 15 }}>Unlock</Text>
              </TouchableOpacity>
            </View>
          )}
        </SafeAreaView>
      </>
    );
  }

  return (
    <>
      <StatusBar backgroundColor={bgColor} barStyle={barStyle} translucent={false} />
      <SafeAreaView style={[styles.container, { backgroundColor: bgColor }]} edges={["top"]}>
        <WebView
          ref={webViewRef}
          source={{ uri: sourceUri }}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
          geolocationEnabled
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          injectedJavaScriptBeforeContentLoaded={Platform.OS === "ios" ? GEO_POLYFILL_JS : undefined}
          injectedJavaScript={POST_LOAD_JS}
          onMessage={onMessage}
          onLoadEnd={() => { firstLoadDone.current = true; setLoading(false); }}
          allowsInlineMediaPlayback
          onShouldStartLoadWithRequest={onShouldStart}
        />
        {loading && (
          <View style={[styles.loading, styles.overlay, { backgroundColor: bgColor }]}>
            <ActivityIndicator size="large" color="#4f46e5" />
          </View>
        )}
      </SafeAreaView>
      <SafeAreaView edges={["bottom"]} style={{ backgroundColor: navColor }} />
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview:   { flex: 1 },
  loading:   { alignItems: "center", justifyContent: "center" },
  overlay:   { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
});
