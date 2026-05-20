"use client";

interface SpinnerProps {
  size?: number;
  color?: string;
}

export default function Spinner({ size = 24, color = "#4f46e5" }: SpinnerProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      style={{ animation: "spin 0.8s linear infinite" }}
    >
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      <circle
        cx="12"
        cy="12"
        r="10"
        stroke={color}
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="40 20"
        opacity="0.8"
      />
    </svg>
  );
}
