import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import { AsyncStorage } from "@/lib/asyncStorage";
import { CATEGORY_COLOURS, DEFAULT_CUSTOM_COLOUR } from "@/lib/shared";

const COLOUR_STORE_KEY = "wd_category_colours";

interface ColourContextValue {
  colours: Record<string, string>;
  setColour: (cat: string, hex: string) => void;
  resetColour: (cat: string) => void;
  resetAllColours: () => void;
}

const ColourContext = createContext<ColourContextValue>({
  colours: { ...CATEGORY_COLOURS },
  setColour: () => {},
  resetColour: () => {},
  resetAllColours: () => {},
});

export function useColours() {
  return useContext(ColourContext);
}

export function ColourProvider({ children }: { children: React.ReactNode }) {
  const [colours, setColours] = useState<Record<string, string>>({ ...CATEGORY_COLOURS });

  useEffect(() => {
    AsyncStorage.getItem(COLOUR_STORE_KEY)
      .then((raw) => {
        if (raw) {
          const overrides = JSON.parse(raw) as Record<string, string>;
          setColours({ ...CATEGORY_COLOURS, ...overrides });
        }
      })
      .catch(() => {});
  }, []);

  const persistOverrides = useCallback((next: Record<string, string>) => {
    // Only persist overrides (delta from defaults)
    const overrides: Record<string, string> = {};
    for (const [cat, hex] of Object.entries(next)) {
      if (CATEGORY_COLOURS[cat] !== hex) overrides[cat] = hex;
    }
    AsyncStorage.setItem(COLOUR_STORE_KEY, JSON.stringify(overrides)).catch(() => {});
  }, []);

  const setColour = useCallback((cat: string, hex: string) => {
    setColours((prev) => {
      const next = { ...prev, [cat]: hex };
      persistOverrides(next);
      return next;
    });
  }, [persistOverrides]);

  const resetColour = useCallback((cat: string) => {
    setColours((prev) => {
      const next = { ...prev, [cat]: CATEGORY_COLOURS[cat] ?? DEFAULT_CUSTOM_COLOUR };
      persistOverrides(next);
      return next;
    });
  }, [persistOverrides]);

  const resetAllColours = useCallback(() => {
    const next = { ...CATEGORY_COLOURS };
    setColours(next);
    AsyncStorage.removeItem(COLOUR_STORE_KEY).catch(() => {});
  }, []);

  return (
    <ColourContext.Provider value={{ colours, setColour, resetColour, resetAllColours }}>
      {children}
    </ColourContext.Provider>
  );
}
