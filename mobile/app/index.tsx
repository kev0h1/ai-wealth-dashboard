import { useRef, useState, useEffect, useCallback } from "react";
import { StyleSheet, BackHandler, View, ActivityIndicator, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, WebViewMessageEvent, WebViewNavigation } from "react-native-webview";
import {
  GoogleSignin,
  isSuccessResponse,
} from "@react-native-google-signin/google-signin";
import Constants from "expo-constants";

const DASHBOARD_URL = "https://wealth.auriqltd.co.uk";
const NATIVE_AUTH_URL = `${DASHBOARD_URL}/api/auth/google/native`;
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
    s.textContent = '[style*="env(safe-area-inset-top"]{padding-top:0!important}.safe-top{padding-top:0!important}';
    document.head.appendChild(s);

    function send() {
      const dark = document.documentElement.classList.contains('dark');
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'update', dark }));
    }
    new MutationObserver(send).observe(document.documentElement, { attributes: true });
    send();
  })();
  true;
`;

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const loggingIn = useRef(false);
  const [darkMode, setDarkMode] = useState(false);
  const [loading, setLoading] = useState(true);
  const [sourceUri, setSourceUri] = useState(DASHBOARD_URL);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      webViewRef.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, []);

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
    } catch {}
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
    return true;
  }

  const bgColor = darkMode ? BG_DARK : BG_LIGHT;
  const barStyle = darkMode ? "light-content" : "dark-content";

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
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          injectedJavaScript={POST_LOAD_JS}
          onMessage={onMessage}
          onLoadEnd={() => setLoading(false)}
          allowsInlineMediaPlayback
          onShouldStartLoadWithRequest={onShouldStart}
        />
        {loading && (
          <View style={[styles.loading, styles.overlay, { backgroundColor: bgColor }]}>
            <ActivityIndicator size="large" color="#4f46e5" />
          </View>
        )}
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  webview:   { flex: 1 },
  loading:   { alignItems: "center", justifyContent: "center" },
  overlay:   { position: "absolute", top: 0, left: 0, right: 0, bottom: 0 },
});
