import { Text, TextProps, StyleSheet } from "react-native";

interface Props extends TextProps {
  children: React.ReactNode;
}

export function WhisperLabel({ children, style, ...props }: Props) {
  return (
    <Text style={[styles.label, style]} {...props}>
      {children}
    </Text>
  );
}

const styles = StyleSheet.create({
  label: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    color: "#94a3b8",
  },
});
