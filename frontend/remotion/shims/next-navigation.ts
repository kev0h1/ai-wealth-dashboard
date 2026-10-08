// Remotion CLI only: next/navigation hooks without a Next router.
export function useRouter() {
  return { push() {}, replace() {}, back() {}, forward() {}, refresh() {}, prefetch() {} };
}
export function useSearchParams() {
  return new URLSearchParams();
}
export function usePathname() {
  return "/";
}
