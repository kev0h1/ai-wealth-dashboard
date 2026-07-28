import { View, ViewProps, StyleSheet, useWindowDimensions } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { tw } from "@/lib/tw";

interface Props extends ViewProps {
  children: React.ReactNode;
}

export function Screen({ children, style, ...props }: Props) {
  const { width: winW } = useWindowDimensions();
  const gutter = Math.max(0, (winW - 430) / 2) + tw.space[4];
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={[styles.inner, { paddingHorizontal: gutter }, style]} {...props}>
        {children}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: "#f0f2f7",
  },
  inner: {
    flex: 1,
  },
});
