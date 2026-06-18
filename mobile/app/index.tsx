import { useRef, useState, useEffect } from "react";
import { StyleSheet, BackHandler, View, ActivityIndicator, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, WebViewMessageEvent } from "react-native-webview";

const DASHBOARD_URL = "https://wealth.auriqltd.co.uk";
const TOKEN_KEY = "wealth_session_token";

// Maps web app route colours — mirrors ThemeColor.tsx on the frontend
const DEFAULT_THEME = "#4f46e5";

async function fetchSessionToken(): Promise<string> {
  const res = await fetch("https://wealth.auriqltd.co.uk/api/auth/pin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "8048" }),
  });
  const data = await res.json();
  return data.session_token ?? "";
}

// Watches the theme-color meta tag and posts changes to the native layer
const THEME_WATCH_JS = `
  (function() {
    function send() {
      const m = document.querySelector('meta[name="theme-color"]');
      if (m) window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'themeColor', color: m.content }));
    }
    new MutationObserver(send).observe(document.head, { subtree: true, attributes: true, childList: true });
    send();
  })();
  true;
`;

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const [token, setToken] = useState<string | null>(null);
  const [themeColor, setThemeColor] = useState(DEFAULT_THEME);

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
      if (msg.type === "themeColor" && msg.color) setThemeColor(msg.color);
    } catch {}
  }

  if (token === null) {
    return (
      <View style={styles.loading}>
        <StatusBar backgroundColor="#f0f2f7" barStyle="dark-content" />
        <ActivityIndicator size="large" color="#b91c1c" />
      </View>
    );
  }

  // SafeAreaView already handles the top inset natively, so zero out the
  // env(safe-area-inset-top) padding that the web app adds on each page
  const injectedJS = `
    (function() {
      try { localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, ${JSON.stringify(token)}); } catch(e) {}
      const s = document.createElement('style');
      s.textContent = '[style*="env(safe-area-inset-top"]{padding-top:0!important}.safe-top{padding-top:0!important}';
      document.head.appendChild(s);
    })();
    true;
  `;

  return (
    <>
      <StatusBar backgroundColor={themeColor} barStyle="light-content" translucent={false} />
      {/* Top edge only — pushes content below status bar; no bottom inset so content reaches screen edge */}
      <SafeAreaView style={styles.container} edges={["top"]}>
        <WebView
          ref={webViewRef}
          source={{ uri: DASHBOARD_URL }}
          style={styles.webview}
          javaScriptEnabled
          domStorageEnabled
          thirdPartyCookiesEnabled
          sharedCookiesEnabled
          injectedJavaScriptBeforeContentLoaded={injectedJS}
          injectedJavaScript={THEME_WATCH_JS}
          onMessage={onMessage}
          allowsInlineMediaPlayback
          onShouldStartLoadWithRequest={() => true}
        />
      </SafeAreaView>
    </>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f2f7" },
  webview: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f0f2f7" },
});
