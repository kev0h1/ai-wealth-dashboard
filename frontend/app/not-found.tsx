import Link from "next/link";
import ErrorState, { ERROR_PRIMARY_ACTION } from "@/components/ErrorState";

// G215: designed 404 (Next's default is an unstyled white page).
export default function NotFound() {
  return (
    <div className="min-h-dvh bg-[#f0f2f7] dark:bg-[#0f172a]">
      <ErrorState
        heading="That page isn’t here"
        message="The link may be old or mistyped. Your money is exactly where you left it."
        actions={<Link href="/" className={ERROR_PRIMARY_ACTION}>Back to Home</Link>}
      />
    </div>
  );
}
