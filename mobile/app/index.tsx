import { useRef, useState, useEffect } from "react";
import { StyleSheet, BackHandler, View, ActivityIndicator } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";

const DASHBOARD_URL = "https://wealth.auriqltd.co.uk";
const TOKEN_KEY = "wealth_session_token";

async function fetchSessionToken(): Promise<string> {
  const res = await fetch("https://wealth.auriqltd.co.uk/api/auth/pin", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ pin: "8048" }),
  });
  const data = await res.json();
  return data.session_token ?? "";
}

export default function App() {
  const webViewRef = useRef<WebView>(null);
  const [token, setToken] = useState<string | null>(null);

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

  if (token === null) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator size="large" color="#b91c1c" />
      </View>
    );
  }

  // Inject the session token into localStorage before the page loads
  // so the web app's AuthProvider sees it and skips the login screen
  const injectedJS = `
    (function() {
      try { localStorage.setItem(${JSON.stringify(TOKEN_KEY)}, ${JSON.stringify(token)}); } catch(e) {}
    })();
    true;
  `;

  return (
    <SafeAreaView style={styles.container}>
      <WebView
        ref={webViewRef}
        source={{ uri: DASHBOARD_URL }}
        style={styles.webview}
        javaScriptEnabled
        domStorageEnabled
        thirdPartyCookiesEnabled
        sharedCookiesEnabled
        injectedJavaScriptBeforeContentLoaded={injectedJS}
        allowsInlineMediaPlayback
        onShouldStartLoadWithRequest={() => true}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#f0f2f7" },
  webview: { flex: 1 },
  loading: { flex: 1, alignItems: "center", justifyContent: "center", backgroundColor: "#f0f2f7" },
});
