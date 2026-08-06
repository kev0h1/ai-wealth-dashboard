import { Text, TextProps, StyleSheet } from "react-native";
import { tw } from "@/lib/tw";
import { useTheme } from "@/lib/ThemeContext";

interface Props extends TextProps {
  children: React.ReactNode;
}

export function WhisperLabel({ children, style, ...props }: Props) {
  const { dark } = useTheme();
  return (
    <Text
      style={[styles.label, { color: dark ? tw.color.slate500 : tw.color.slate400 }, style]}
      {...props}
    >
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: {
    ...tw.text["11"],
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.widest, 11),
  },
});
