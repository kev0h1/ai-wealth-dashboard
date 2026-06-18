import { useRef, useState, useEffect } from "react";
import { StyleSheet, BackHandler, View, ActivityIndicator, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView, WebViewMessageEvent } from "react-native-webview";
import * as NavigationBar from "expo-navigation-bar";

const DASHBOARD_URL = "https://wealth.auriqltd.co.uk";
const TOKEN_KEY = "wealth_session_token";
const DEFAULT_THEME = "#4f46e5";
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

// Returns luminance 0–1 for a hex colour
function luminance(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

const POST_LOAD_JS = `
  (function() {
    // Zero out double-safe-area padding (SafeAreaView already handles top natively)
    const s = document.createElement('style');
    s.textContent = '[style*="env(safe-area-inset-top"]{padding-top:0!important}.safe-top{padding-top:0!important}';
    document.head.appendChild(s);

    function send() {
      const m = document.querySelector('meta[name="theme-color"]');
      const dark = document.documentElement.classList.contains('dark');
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'update',
        color: m ? m.content : null,
        dark,
      }));
    }
    // Watch theme-color and dark-class changes
    new MutationObserver(send).observe(document.head, { subtree: true, attributes: true, childList: true });
    new MutationObserver(send).observe(document.documentElement, { attributes: true });
    send();
  })();
  true;
`;

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const [token, setToken] = useState<string | null>(null);
  const [themeColor, setThemeColor] = useState(DEFAULT_THEME);
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

  // Update Android navigation bar when dark mode changes
  useEffect(() => {
    const bg = darkMode ? BG_DARK : BG_LIGHT;
    NavigationBar.setBackgroundColorAsync(bg);
    NavigationBar.setButtonStyleAsync(darkMode ? "light" : "dark");
  }, [darkMode]);

  function onMessage(e: WebViewMessageEvent) {
    try {
      const msg = JSON.parse(e.nativeEvent.data);
      if (msg.type === "update") {
        if (msg.color) setThemeColor(msg.color);
        setDarkMode(!!msg.dark);
      }
    } catch {}
  }

  const bgColor = darkMode ? BG_DARK : BG_LIGHT;
  // Use dark icons on light status bar colours, light icons on dark ones
  const barStyle = luminance(themeColor) > 0.4 ? "dark-content" : "light-content";

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
      <StatusBar backgroundColor={themeColor} barStyle={barStyle} translucent={false} />
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
