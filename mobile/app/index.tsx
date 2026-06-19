import { useRef, useState, useEffect } from "react";
import { StyleSheet, BackHandler, View, ActivityIndicator, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, WebViewMessageEvent } from "react-native-webview";

const DASHBOARD_URL = "https://wealth.auriqltd.co.uk";
const TOKEN_KEY = "wealth_session_token";
const BG_LIGHT = "#f0f2f7";
const BG_DARK  = "#0f172a";

async function fetchSessionToken(): Promise<string> {
  const res = await fetch("https://wealth.auriqltd.co.uk/api/auth/pin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "8048" }),
  });
  const data = await res.json();
  return data.session_token ?? "";
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
  const [token, setToken] = useState<string | null>(null);
  const [darkMode, setDarkMode] = useState(false);

  useEffect(() => {
    fetchSessionToken().then(setToken).catch(() => setToken(""));
  }, []);

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
  // Light mode: dark icons on light-gray background. Dark mode: white icons on dark background.
  const barStyle = darkMode ? "light-content" : "dark-content";

  if (token === null) {
    return (
      <View style={[styles.loading, { backgroundColor: bgColor }]}>
        <StatusBar backgroundColor={bgColor} barStyle="dark-content" />
        <ActivityIndicator size="large" color="#b91c1c" />
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
  container: { flex: 1 },
  webview: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center" },
});
