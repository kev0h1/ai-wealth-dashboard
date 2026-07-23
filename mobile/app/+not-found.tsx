import { useEffect } from "react";
import { View } from "react-native";
import { router } from "expo-router";

// Safety net for any unmatched deep link (e.g. a bank-auth redirect variant):
// never strand the user on Expo Router's default "Unmatched Route" screen —
// send them back to the dashboard WebView.
export default function NotFound() {
  useEffect(() => {
    router.replace("/");
  }, []);
  return <View style={{ flex: 1, backgroundColor: "#0f172a" }} />;
}
