import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { RefreshCw } from "lucide-react-native";

interface Props {
  firstName?: string;
  syncing: boolean;
  syncError: boolean;
  onSync: () => void;
  dark: boolean;
}

export function HomeHeader({ firstName, syncing, syncError, onSync, dark }: Props) {
  const greeting = firstName ? `Hi, ${firstName}` : "Welcome back";

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={[styles.greeting, { color: dark ? "#f1f5f9" : "#0f172a" }]}>
          {greeting}
        </Text>
        <Pressable
          onPress={onSync}
          disabled={syncing}
          style={({ pressed }) => [
            styles.syncBtn,
            {
              backgroundColor: dark ? "#1e293b" : "#ffffff",
              borderColor: dark ? "#334155" : "#f1f5f9",
              opacity: syncing ? 0.6 : 1,
              transform: [{ scale: pressed ? 0.95 : 1 }],
            },
          ]}
          accessibilityLabel="Sync accounts"
        >
          {syncing ? (
            <ActivityIndicator size={18} color="#4f46e5" />
          ) : (
            <RefreshCw size={18} color={dark ? "#94a3b8" : "#64748b"} />
          )}
        </Pressable>
      </View>
      {syncError && (
        <View style={styles.errorBanner}>
          <Text style={styles.errorText}>Sync failed — tap to retry</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 8 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  greeting: {
    fontSize: 22,
    fontWeight: "700",
    letterSpacing: -0.4,
  },
  syncBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  errorBanner: {
    backgroundColor: "#fef3c726",
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: "#f59e0b40",
  },
  errorText: {
    color: "#f59e0b",
    fontSize: 13,
    fontWeight: "500",
  },
});
