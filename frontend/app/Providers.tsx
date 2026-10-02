"use client";

import { ColourProvider } from "@/components/ColourProvider";
import { IconProvider } from "@/components/IconProvider";
import { AuthProvider } from "@/components/AuthProvider";
import { PreferencesProvider } from "@/components/PreferencesContext";
import { CategoriesProvider } from "@/components/CategoriesContext";
import { useSoftKeyboardAttribute } from "@/lib/useSoftKeyboardAttribute";

export function Providers({ children }: { children: React.ReactNode }) {
  useSoftKeyboardAttribute();
  return (
    <AuthProvider>
      <PreferencesProvider>
        <CategoriesProvider>
          <ColourProvider>
            <IconProvider>{children}</IconProvider>
          </ColourProvider>
        </CategoriesProvider>
      </PreferencesProvider>
    </AuthProvider>
  );
}
