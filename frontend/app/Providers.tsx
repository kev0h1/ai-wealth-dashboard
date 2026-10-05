"use client";

import { ColourProvider } from "@/components/ColourProvider";
import { IconProvider } from "@/components/IconProvider";
import DeepLinkHandler from "@/components/DeepLinkHandler";
import { AuthProvider } from "@/components/AuthProvider";
import { PreferencesProvider } from "@/components/PreferencesContext";
import { CategoriesProvider } from "@/components/CategoriesContext";
import { useSoftKeyboardAttribute } from "@/lib/useSoftKeyboardAttribute";

export function Providers({ children }: { children: React.ReactNode }) {
  useSoftKeyboardAttribute();
  return (
    <>
      {/* Outside AuthProvider's gate on purpose: a cold-start sign-in return
          arrives while AuthProvider is still checking or showing LoginScreen. */}
      <DeepLinkHandler />
      <AuthProvider>
      <PreferencesProvider>
        <CategoriesProvider>
          <ColourProvider>
            <IconProvider>{children}</IconProvider>
          </ColourProvider>
        </CategoriesProvider>
      </PreferencesProvider>
      </AuthProvider>
    </>
  );
}
