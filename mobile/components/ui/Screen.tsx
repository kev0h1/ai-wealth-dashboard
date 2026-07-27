import { View, ViewProps, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

interface Props extends ViewProps {
  children: React.ReactNode;
}

export function Screen({ children, style, ...props }: Props) {
  return (
    <SafeAreaView style={styles.safe} edges={["top"]}>
      <View style={[styles.inner, style]} {...props}>
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
    paddingHorizontal: 16,
  },
});
