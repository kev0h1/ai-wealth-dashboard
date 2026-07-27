import { useRef, useState, useEffect, useCallback } from "react";
import { StyleSheet, BackHandler, View, ActivityIndicator, Platform } from "react-native";
import { useFocusEffect, useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StatusBar } from "expo-status-bar";
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
import { useAuth } from "@/lib/AuthContext";
import { useTheme } from "@/lib/ThemeContext";

const DASHBOARD_URL = "https://wealth.auriqltd.co.uk";
const NATIVE_AUTH_URL = `${DASHBOARD_URL}/api/auth/google/native`;
const NATIVE_PUSH_URL = `${DASHBOARD_URL}/api/push/native-subscribe`;
const SESSION_TOKEN_KEY = "wealth_session_token";
const EAS_PROJECT_ID = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
  ?.eas?.projectId;

const extra = (Constants.expoConfig?.extra ?? {}) as {
  googleWebClientId?: string;
  googleIosClientId?: string;
};

// Module-level Google Signin configuration (idempotent)
GoogleSignin.configure({
  webClientId: extra.googleWebClientId,
  iosClientId: extra.googleIosClientId || undefined,
  offlineAccess: false,
});

// Module-level notification handler (only set once across all tab instances)
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// Module-level push registration guard (shared across all instances)
let pushRegisteredForToken: string | null = null;

// The web BottomNav selector: nav element with Tailwind class "lg:hidden"
// In HTML the class attribute contains "lg:hidden" — in CSS the colon must be escaped.
// Stable selector: nav.lg\:hidden  (targets <nav class="lg:hidden fixed bottom-0 ...">)
const POST_LOAD_JS = `
(function() {
  var s = document.createElement('style');
  s.textContent = [
    '[style*="env(safe-area-inset-top"]{padding-top:0!important}',
    '.safe-top{padding-top:0!important}',
    '[style*="env(safe-area-inset-bottom"]{padding-bottom:0!important}',
    'nav.lg\\\\:hidden{display:none!important}',
    'body{padding-bottom:0!important;margin-bottom:0!important}'
  ].join('');
  document.head.appendChild(s);

  function send() {
    var dark = document.documentElement.classList.contains('dark');
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'update', dark: dark }));
  }
  new MutationObserver(send).observe(document.documentElement, { attributes: true });
  send();

  try {
    var token = window.localStorage.getItem('${SESSION_TOKEN_KEY}');
    if (token) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'auth', token: token }));
    }
  } catch (e) {}

  // Route reporting: patch history API and popstate to report SPA navigations
  (function() {
    function reportRoute() {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'route', path: location.pathname }));
    }
    var _pushState = history.pushState.bind(history);
    history.pushState = function() { _pushState.apply(history, arguments); reportRoute(); };
    var _replaceState = history.replaceState.bind(history);
    history.replaceState = function() { _replaceState.apply(history, arguments); reportRoute(); };
    window.addEventListener('popstate', reportRoute);
    reportRoute();
  })();
})();
true;
`;

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

interface Props {
  initialPath?: string;
}

export default function DashboardWebView({ initialPath = "" }: Props) {
  const { token: contextToken, setToken } = useAuth();
  const { dark: darkMode, setDark } = useTheme();
  const webViewRef = useRef<WebView>(null);
  const loggingIn = useRef(false);
  const firstLoadDone = useRef(false);
  const canGoBackRef = useRef(false);
  const [loading, setLoading] = useState(true);
  const insets = useSafeAreaInsets();
  const [focused, setFocused] = useState(false);

  const router = useRouter();

  // Derive this tab's top-level section from initialPath
  const mySection = (!initialPath || initialPath === "/") ? "/" : `/${initialPath.split("/").filter(Boolean)[0]}`;

  const SECTION_TO_TAB: Record<string, string> = {
    "/": "/(tabs)/",
    "/spend": "/(tabs)/spend",
    "/budget": "/(tabs)/budget",
    "/insights": "/(tabs)/insights",
    "/settings": "/(tabs)/settings",
  };

  const lastHandledSection = useRef<string | null>(null);
  const lastHandledTime = useRef<number>(0);

  const buildUrl = useCallback((tok: string | null) => {
    const path = initialPath && !initialPath.startsWith("/") ? `/${initialPath}` : initialPath;
    const base = `${DASHBOARD_URL}${path}`;
    if (tok) return `${base}${path.includes("?") ? "&" : "?"}token=${encodeURIComponent(tok)}`;
    return base;
  }, [initialPath]);

  const [sourceUri, setSourceUri] = useState(() => buildUrl(contextToken));

  const bgColor = darkMode ? "#0f172a" : "#f0f2f7";

  const openPushUrl = useCallback((url: unknown) => {
    if (typeof url !== "string" || !url) return;
    const full = url.startsWith("http") ? url : `${DASHBOARD_URL}${url}`;
    if (webViewRef.current && firstLoadDone.current) {
      webViewRef.current.injectJavaScript(`window.location.assign(${JSON.stringify(full)}); true;`);
    }
  }, []);

  // Native→web: propagate context dark value into this WebView
  useEffect(() => {
    if (!firstLoadDone.current) return;
    const jsClass = darkMode
      ? `document.documentElement.classList.add('dark');`
      : `document.documentElement.classList.remove('dark');`;
    const jsStorage = `try{localStorage.setItem('wd_dark','${darkMode ? "1" : "0"}');}catch(e){}`;
    webViewRef.current?.injectJavaScript(`${jsClass}${jsStorage}true;`);
  }, [darkMode]);

  useEffect(() => {
    const sub = Notifications.addNotificationResponseReceivedListener((response) => {
      openPushUrl(response.notification.request.content.data?.url);
      Notifications.clearLastNotificationResponseAsync().catch(() => {});
    });

    Notifications.getLastNotificationResponseAsync()
      .then((response) => {
        const url = response?.notification.request.content.data?.url;
        if (url) {
          openPushUrl(url);
          Notifications.clearLastNotificationResponseAsync().catch(() => {});
        }
      })
      .catch(() => {});

    return () => sub.remove();
  }, [openPushUrl]);

  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      const sub = BackHandler.addEventListener("hardwareBackPress", () => {
        if (canGoBackRef.current && webViewRef.current) {
          webViewRef.current.goBack();
          return true;
        }
        return false;
      });
      return () => {
        sub.remove();
        setFocused(false);
      };
    }, []),
  );

  const applyToken = useCallback((tok: string) => {
    setLoading(true);
    setSourceUri(buildUrl(tok));
  }, [buildUrl]);

  async function registerForPush(sessionToken: string) {
    if (pushRegisteredForToken === sessionToken) return;
    pushRegisteredForToken = sessionToken;
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
        pushRegisteredForToken = null;
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
      if (!res.ok) pushRegisteredForToken = null;
    } catch {
      pushRegisteredForToken = null;
    }
  }

  function onMessage(e: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === "update") setDark(!!msg.dark);
      else if (msg.type === "route" && typeof msg.path === "string") {
        const incoming = msg.path;
        // Compute top-level section: "/x/y" → "/x", "/" → "/"
        const parts = incoming.split("/").filter(Boolean);
        const section = parts.length > 0 ? `/${parts[0]}` : "/";
        const tabHref = SECTION_TO_TAB[section];
        if (tabHref && section !== mySection) {
          // Debounce: ignore same section within 300ms
          const now = Date.now();
          if (section === lastHandledSection.current && now - lastHandledTime.current < 300) return;
          lastHandledSection.current = section;
          lastHandledTime.current = now;
          router.navigate(tabHref as any);
          webViewRef.current?.injectJavaScript("history.back(); true;");
        }
      }
      else if (msg.type === "geo:request") handleGeoRequest(msg.id, msg.options);
      else if (msg.type === "camera:request") handleCameraRequest(msg.id);
      else if (msg.type === "biometrics:get") handleBiometricsGet(msg.id);
      else if (msg.type === "biometrics:set")
        SecureStore.setItemAsync("biometric_lock", msg.enabled ? "1" : "0").catch(() => {});
      else if (msg.type === "auth" && msg.token) {
        setToken(msg.token).catch(() => {});
        registerForPush(msg.token);
      } else if (msg.type === "open_external" && msg.url) {
        WebBrowser.openAuthSessionAsync(msg.url, "wealthdash://auth-complete").then((result) => {
          if (result.type === "success") webViewRef.current?.reload();
        });
      }
    } catch {}
  }

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
      // User cancelled or sign-in failed
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
    if (
      req.url.includes("auth.truelayer.com") ||
      req.url.includes("auth.yapily.com") ||
      req.url.includes("finexer.com/connect")
    ) {
      WebBrowser.openAuthSessionAsync(req.url, "wealthdash://auth-complete").then((result) => {
        if (result.type === "success") webViewRef.current?.reload();
      });
      return false;
    }
    return true;
  }

  return (
    <View style={[styles.container, { paddingTop: insets.top, backgroundColor: bgColor }]}>
      <WebView
        ref={webViewRef}
        source={{ uri: sourceUri }}
        style={[styles.webview, { backgroundColor: bgColor }]}
        javaScriptEnabled
        domStorageEnabled
        geolocationEnabled
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        injectedJavaScriptBeforeContentLoaded={Platform.OS === "ios" ? GEO_POLYFILL_JS : undefined}
        injectedJavaScript={POST_LOAD_JS}
        onMessage={onMessage}
        onNavigationStateChange={(nav) => { canGoBackRef.current = nav.canGoBack; }}
        onLoadEnd={() => {
          firstLoadDone.current = true;
          setLoading(false);
        }}
        allowsInlineMediaPlayback
        onShouldStartLoadWithRequest={onShouldStart}
      />
      {loading && (
        <View style={[styles.loading, { backgroundColor: bgColor }]}>
          <ActivityIndicator size="large" color="#4f46e5" />
        </View>
      )}
      {focused && <StatusBar style={darkMode ? "light" : "dark"} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview: { flex: 1 },
  loading: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: "center",
    justifyContent: "center",
  },
});
