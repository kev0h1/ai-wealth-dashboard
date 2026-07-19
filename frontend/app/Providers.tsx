"use client";

import { ColourProvider } from "@/components/ColourProvider";
import { IconProvider } from "@/components/IconProvider";
import { AuthProvider } from "@/components/AuthProvider";
import { PreferencesProvider } from "@/components/PreferencesContext";
import { CategoriesProvider } from "@/components/CategoriesContext";

export function Providers({ children }: { children: React.ReactNode }) {
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
