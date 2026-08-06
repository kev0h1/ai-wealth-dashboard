import React from "react";
import { View, ScrollView, StyleSheet } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useTheme } from "@/lib/ThemeContext";
import { tw } from "@/lib/tw";

interface ShellProps {
  dotIndex: number;
  children: React.ReactNode;
}

export function Shell({ dotIndex, children }: ShellProps) {
  const { dark } = useTheme();

  return (
    <SafeAreaView
      edges={["top", "bottom"]}
      style={[
        styles.safe,
        { backgroundColor: dark ? tw.color.slate900 : tw.color.slate50 },
      ]}
    >
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {dotIndex >= 0 && (
          <View style={styles.dots}>
            {[0, 1, 2, 3].map((i) => (
              <View
                key={i}
                style={[
                  styles.dotBase,
                  i === dotIndex
                    ? [styles.dotActive, { backgroundColor: tw.color.indigo500 }]
                    : i < dotIndex
                    ? [
                        styles.dotCompleted,
                        {
                          backgroundColor: dark
                            ? tw.color.indigo700
                            : tw.color.indigo300,
                        },
                      ]
                    : [
                        styles.dotFuture,
                        {
                          backgroundColor: dark
                            ? tw.color.slate700
                            : tw.color.slate200,
                        },
                      ],
                ]}
              />
            ))}
          </View>
        )}
        <View style={styles.content}>{children}</View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
  },
  scroll: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
    paddingVertical: 40,
  },
  dots: {
    flexDirection: "row",
    gap: 8,
    marginBottom: 32,
  },
  dotBase: {
    height: 6,
    borderRadius: 3,
  },
  dotActive: {
    width: 24,
  },
  dotCompleted: {
    width: 16,
  },
  dotFuture: {
    width: 16,
  },
  content: {
    width: "100%",
    maxWidth: 448,
  },
});
