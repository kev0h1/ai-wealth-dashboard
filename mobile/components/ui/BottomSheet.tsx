import React, { useEffect, useRef } from "react";
import {
  Modal,
  View,
  Animated,
  Pressable,
  StyleSheet,
  useWindowDimensions,
} from "react-native";
import { tw } from "@/lib/tw";

interface BottomSheetProps {
  visible: boolean;
  onClose: () => void;
  children: React.ReactNode;
}

export function BottomSheet({ visible, onClose, children }: BottomSheetProps) {
  const { height: winH } = useWindowDimensions();
  const translateY = useRef(new Animated.Value(winH)).current;

  useEffect(() => {
    if (visible) {
      Animated.timing(translateY, {
        toValue: 0,
        duration: 280,
        useNativeDriver: true,
      }).start();
    } else {
      Animated.timing(translateY, {
        toValue: winH,
        duration: 200,
        useNativeDriver: true,
      }).start();
    }
  }, [visible, winH, translateY]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY }] }]}
        >
          <View style={styles.handle} />
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.40)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: tw.color.white,
    borderTopLeftRadius: tw.radius["3xl"],
    borderTopRightRadius: tw.radius["3xl"],
    paddingTop: tw.space[2],
    paddingBottom: tw.space[8],
    paddingHorizontal: tw.space[4],
    borderTopWidth: 1,
    borderTopColor: tw.color.cardBorderLight,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: tw.color.slate300,
    alignSelf: "center",
    marginBottom: tw.space[4],
  },
});
