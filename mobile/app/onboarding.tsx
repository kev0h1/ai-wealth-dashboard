import { useState, useEffect } from "react";
import { api } from "@/lib/api";
import { useAuth } from "@/lib/AuthContext";
import {
  Shell,
  WelcomeStep,
  ProfileStep,
  PaydayStep,
  BankStep,
  SecureStep,
} from "@/components/onboarding";
import { router } from "expo-router";
import * as LocalAuthentication from "expo-local-authentication";

type Step = "welcome" | "profile" | "payday" | "bank" | "secure";
const STEP_DOTS: Step[] = ["profile", "payday", "bank", "secure"];

export default function OnboardingScreen() {
  const { token } = useAuth();
  const [step, setStep] = useState<Step>("welcome");
  const [defaultName, setDefaultName] = useState("");

  useEffect(() => {
    api
      .getProfile()
      .then((p) => {
        if (p.full_name) setDefaultName(p.full_name);
      })
      .catch(() => {});
  }, []);

  const dotIndex = STEP_DOTS.indexOf(step);

  async function handleBankDone() {
    const [hasHw, enrolled] = await Promise.all([
      LocalAuthentication.hasHardwareAsync(),
      LocalAuthentication.isEnrolledAsync(),
    ]);
    if (hasHw && enrolled) {
      setStep("secure");
    } else {
      await finish(false);
    }
  }

  async function finish(_biometric: boolean) {
    try {
      await api.updateProfile(defaultName || "User", undefined, true);
    } catch {}
    router.replace("/(tabs)");
  }

  return (
    <Shell dotIndex={dotIndex}>
      {step === "welcome" && <WelcomeStep onNext={() => setStep("profile")} />}
      {step === "profile" && (
        <ProfileStep
          onNext={() => setStep("payday")}
          defaultName={defaultName}
          onNameSaved={(n) => setDefaultName(n)}
        />
      )}
      {step === "payday" && <PaydayStep onNext={() => setStep("bank")} />}
      {step === "bank" && <BankStep onNext={handleBankDone} />}
      {step === "secure" && <SecureStep onFinish={finish} />}
    </Shell>
  );
}
