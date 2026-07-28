import { Text, TextProps, StyleSheet } from "react-native";
import { tw } from "@/lib/tw";

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
    ...tw.text["11"],
    fontWeight: tw.weight.semibold,
    textTransform: "uppercase",
    letterSpacing: tw.tracking(tw.trackingEm.wide, 11),
    color: tw.color.slate400,
  },
});
