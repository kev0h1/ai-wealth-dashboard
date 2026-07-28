import { View, Text, Pressable, ActivityIndicator, StyleSheet } from "react-native";
import { RefreshCw, HelpCircle } from "lucide-react-native";
import { tw } from "@/lib/tw";

interface Props {
  firstName?: string;
  syncing: boolean;
  syncError: boolean;
  onSync: () => void;
  onTutorial: () => void;
  dark: boolean;
}

export function HomeHeader({ firstName, syncing, syncError, onSync, onTutorial, dark }: Props) {
  const greeting = firstName ? `Hi, ${firstName}` : "Welcome back";

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={[styles.greeting, { color: dark ? tw.color.slate100 : tw.color.slate900 }]}>
          {greeting}
        </Text>
        <View style={styles.actions}>
          <Pressable
            onPress={onTutorial}
            style={({ pressed }) => [
              styles.syncBtn,
              {
                backgroundColor: dark ? tw.color.cardDark : tw.color.cardLight,
                borderColor: dark ? tw.color.cardBorderDark : tw.color.cardBorderLight,
                transform: [{ scale: pressed ? 0.95 : 1 }],
              },
            ]}
            accessibilityLabel="Open tutorial"
          >
            <HelpCircle size={16} color={tw.color.slate500} />
          </Pressable>
          <Pressable
            onPress={onSync}
            disabled={syncing}
            style={({ pressed }) => [
              styles.syncBtn,
              {
                backgroundColor: dark ? tw.color.cardDark : tw.color.cardLight,
                borderColor: dark ? tw.color.cardBorderDark : tw.color.cardBorderLight,
                opacity: syncing ? 0.6 : 1,
                transform: [{ scale: pressed ? 0.95 : 1 }],
              },
            ]}
            accessibilityLabel="Sync accounts"
          >
            {syncing ? (
              <ActivityIndicator size={18} color={tw.color.indigo600} />
            ) : (
              <RefreshCw size={16} color={tw.color.slate500} />
            )}
          </Pressable>
        </View>
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
  container: { gap: tw.space[2] },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  greeting: {
    ...tw.text.xl,
    fontWeight: tw.weight.bold,
    letterSpacing: tw.tracking(tw.trackingEm.tight, 20),
  },
  syncBtn: {
    width: 44,
    height: 44,
    borderRadius: tw.radius.full,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 2,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: tw.space[2],
  },
  errorBanner: {
    backgroundColor: tw.color.amber50,
    borderRadius: tw.radius.lg,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[2],
    borderWidth: 1,
    borderColor: tw.color.amber500,
  },
  errorText: {
    color: tw.color.amber500,
    ...tw.text.sm,
    fontWeight: tw.weight.medium,
  },
});
