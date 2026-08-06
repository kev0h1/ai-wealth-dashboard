import { View, Text, StyleSheet } from "react-native";
import { tw } from "@/lib/tw";

interface Props {
  text: string;
  dark: boolean;
}

export function EvidenceChip({ text, dark }: Props) {
  return (
    <View style={[styles.chip, { backgroundColor: dark ? tw.color.slate700 : tw.color.slate100 }]}>
      <Text
        style={[styles.text, { color: dark ? tw.color.slate400 : tw.color.slate500 }]}
        numberOfLines={1}
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  chip: {
    borderRadius: tw.radius.full,
    paddingHorizontal: tw.space[3],
    paddingVertical: tw.space[1],
    alignSelf: "flex-start",
  },
  text: {
    ...tw.text.xs,
    fontWeight: tw.weight.medium,
  },
});
