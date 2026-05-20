"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import {
  loadColours,
  persistColour,
  clearColour,
} from "@/lib/colourStore";
import { CATEGORY_COLOURS } from "@/lib/categories";

interface ColourContextValue {
  colours: Record<string, string>;
  setColour: (cat: string, hex: string) => void;
  resetColour: (cat: string) => void;
}

const ColourContext = createContext<ColourContextValue>({
  colours: { ...CATEGORY_COLOURS },
  setColour: () => {},
  resetColour: () => {},
});

export function useColours() {
  return useContext(ColourContext);
}

export function ColourProvider({ children }: { children: React.ReactNode }) {
  const [colours, setColours] = useState<Record<string, string>>(
    () => ({ ...CATEGORY_COLOURS })
  );

  useEffect(() => {
    setColours(loadColours());
  }, []);

  const setColour = useCallback((cat: string, hex: string) => {
    persistColour(cat, hex);
    setColours((prev) => ({ ...prev, [cat]: hex }));
  }, []);

  const resetColour = useCallback((cat: string) => {
    clearColour(cat);
    setColours((prev) => ({
      ...prev,
      [cat]: CATEGORY_COLOURS[cat] ?? CATEGORY_COLOURS.Other,
    }));
  }, []);

  return (
    <ColourContext.Provider value={{ colours, setColour, resetColour }}>
      {children}
    </ColourContext.Provider>
  );
}
