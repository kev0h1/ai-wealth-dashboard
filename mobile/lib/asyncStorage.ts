// Thin AsyncStorage-compatible shim backed by expo-secure-store.
// SecureStore key rules: alphanumeric, '.', '-', '_' only, max 255 chars.
// We base64url-encode keys that might contain spaces or other chars.
import * as SecureStore from "expo-secure-store";

function safeKey(key: string): string {
  // Replace any character that isn't alphanumeric, dot, dash, or underscore
  return key.replace(/[^a-zA-Z0-9._-]/g, "_");
}

export const AsyncStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      return await SecureStore.getItemAsync(safeKey(key));
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    await SecureStore.setItemAsync(safeKey(key), value);
  },
  removeItem: async (key: string): Promise<void> => {
    await SecureStore.deleteItemAsync(safeKey(key));
  },
};
