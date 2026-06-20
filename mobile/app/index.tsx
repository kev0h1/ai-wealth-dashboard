import { useRef, useState, useEffect, useCallback } from "react";
import { StyleSheet, BackHandler, View, ActivityIndicator, StatusBar, Text, Pressable } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, WebViewMessageEvent } from "react-native-webview";

const DASHBOARD_URL = "https://wealth.auriqltd.co.uk";
const TOKEN_KEY = "wealth_session_token";
const BG_LIGHT = "#f0f2f7";
const BG_DARK  = "#0f172a";

async function fetchSessionToken(): Promise<string> {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const res = await fetch("https://wealth.auriqltd.co.uk/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: "8048" }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (data.session_token) return data.session_token;
    } catch {
      if (attempt < 2) await new Promise(r => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
  return "";
}

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
  // null = fetching, "" = all retries failed, string = ready
  const [token, setToken] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(false);

  const loadToken = useCallback(() => {
    setToken(null);
    fetchSessionToken().then(setToken);
  }, []);

  useEffect(() => { loadToken(); }, [loadToken]);

  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      webViewRef.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, []);

  function onMessage(e: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === "update") setDarkMode(!!msg.dark);
    } catch {}
  }

  const bgColor = darkMode ? BG_DARK : BG_LIGHT;
  const barStyle = darkMode ? "light-content" : "dark-content";

  if (token === null) {
    return (
      <View style={[styles.loading, { backgroundColor: BG_LIGHT }]}>
        <StatusBar backgroundColor={BG_LIGHT} barStyle="dark-content" />
        <ActivityIndicator size="large" color="#4f46e5" />
      </View>
    );
  }

  if (token === "") {
    return (
      <View style={[styles.loading, { backgroundColor: BG_LIGHT }]}>
        <StatusBar backgroundColor={BG_LIGHT} barStyle="dark-content" />
        <Text style={styles.errorTitle}>Connection failed</Text>
        <Text style={styles.errorSub}>Check your internet connection and try again.</Text>
        <Pressable style={styles.retryBtn} onPress={loadToken}>
          <Text style={styles.retryText}>Retry</Text>
        </Pressable>
      </View>
    );
  }

  const injectedJS = `
    (function() {
      try { localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, ${JSON.stringify(token)}); } catch(e) {}
    })();
    true;
  `;

  return (
    <>
      <StatusBar backgroundColor={bgColor} barStyle={barStyle} translucent={false} />
      <SafeAreaView style={[styles.container, { backgroundColor: bgColor }]} edges={["top"]}>
        <WebView
          ref={webViewRef}
          source={{ uri: DASHBOARD_URL }}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          injectedJavaScriptBeforeContentLoaded={injectedJS}
          injectedJavaScript={POST_LOAD_JS}
          onMessage={onMessage}
          allowsInlineMediaPlayback
          onShouldStartLoadWithRequest={() => true}
        />
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container:  { flex: 1 },
  webview:    { flex: 1 },
  loading:    { flex: 1, alignItems: "center", justifyContent: "center", padding: 32 },
  errorTitle: { fontSize: 17, fontWeight: "600", color: "#1e293b", marginTop: 16, textAlign: "center" },
  errorSub:   { fontSize: 14, color: "#64748b", marginTop: 8, textAlign: "center", lineHeight: 20 },
  retryBtn:   { marginTop: 24, paddingHorizontal: 32, paddingVertical: 12, borderRadius: 12, backgroundColor: "#4f46e5" },
  retryText:  { color: "#fff", fontWeight: "600", fontSize: 15 },
});
