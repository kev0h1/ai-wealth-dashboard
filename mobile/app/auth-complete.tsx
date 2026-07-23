import { useEffect } from "react";
import { View } from "react-native";
import { router } from "expo-router";
import * as WebBrowser from "expo-web-browser";

// The bank-connect flow (TrueLayer) runs in an in-app Chrome Custom Tab opened
// via WebBrowser.openAuthSessionAsync(..., "wealthdash://auth-complete"). On
// Android the wealthdash:// scheme is also registered as an app deep link, so
// the OAuth redirect can be delivered here as a navigation instead of being
// swallowed by the auth session — which otherwise lands on Expo Router's
// "Unmatched Route" 404. Catch it, dismiss the tab, and bounce straight back to
// the dashboard WebView (index remounts and reloads with the linked account).
export default function AuthComplete() {
  useEffect(() => {
    try { WebBrowser.dismissBrowser(); } catch {}
    router.replace("/");
  }, []);
  return <View style={{ flex: 1, backgroundColor: "#0f172a" }} />;
}
