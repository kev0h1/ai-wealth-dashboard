import { useLocalSearchParams, useRouter } from "expo-router";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { ChevronLeft } from "lucide-react-native";
import DashboardWebView from "@/components/DashboardWebView";
import { useTheme } from "@/lib/ThemeContext";

export default function WebScreen() {
  const { path, title, tutorial } = useLocalSearchParams<{ path: string; title: string; tutorial?: string }>();
  const router = useRouter();
  const { dark } = useTheme();
  const insets = useSafeAreaInsets();

  const bgColor = dark ? "#0f172a" : "#f0f2f7";
  const inkColor = dark ? "#f1f5f9" : "#0f172a";
  const borderColor = dark ? "#334155" : "#f1f5f9";

  return (
    <View style={[styles.container, { backgroundColor: bgColor }]}>
      {/* Native header */}
      <View
        style={[
          styles.header,
          {
            paddingTop: insets.top,
            backgroundColor: dark ? "#0f172a" : "#ffffff",
            borderBottomColor: borderColor,
          },
        ]}
      >
        <Pressable
          onPress={() => router.back()}
          style={({ pressed }) => [
            styles.backBtn,
            { transform: [{ scale: pressed ? 0.95 : 1 }] },
          ]}
          accessibilityLabel="Go back"
        >
          <ChevronLeft size={24} color="#4f46e5" />
        </Pressable>
        <Text style={[styles.headerTitle, { color: inkColor }]} numberOfLines={1}>
          {title ?? ""}
        </Text>
        <View style={styles.backBtn} />
      </View>

      <DashboardWebView initialPath={path ?? ""} startTutorial={tutorial === "1"} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: "row",
    alignItems: "flex-end",
    paddingHorizontal: 8,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  headerTitle: {
    flex: 1,
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
  },
});
