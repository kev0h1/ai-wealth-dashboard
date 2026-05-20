"use client";

import { ColourProvider } from "@/components/ColourProvider";
import { AuthProvider } from "@/components/AuthProvider";
import { PreferencesProvider } from "@/components/PreferencesContext";
import { CategoriesProvider } from "@/components/CategoriesContext";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <AuthProvider>
      <PreferencesProvider>
        <CategoriesProvider>
          <ColourProvider>{children}</ColourProvider>
        </CategoriesProvider>
      </PreferencesProvider>
    </AuthProvider>
  );
}
