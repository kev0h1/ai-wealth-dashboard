import { AlertCircle, AlertTriangle, Minus, ShieldCheck } from "lucide-react";
import type { PreviewStatus } from "./state-presentation";
import styles from "./sts-tone.module.css";

export default function StateIndicator({ status }: { status: PreviewStatus }) {
  const Icon = status.tone === "risk" ? AlertTriangle : status.tone === "watch" ? AlertCircle : status.tone === "good" ? ShieldCheck : Minus;
  return <span data-g287-tone={status.tone} className={styles.stateBadge}>
    <Icon size={13} aria-hidden="true" className="shrink-0" />
    <span>{status.label}</span>
  </span>;
}
