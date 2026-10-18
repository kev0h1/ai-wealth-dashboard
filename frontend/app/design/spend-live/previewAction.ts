// Keep the existing failure-state demo deterministic, even in a signed-in
// browser. Imported product components are also stopped by lib/api's gate.
export async function previewAction<T = void>(): Promise<T> {
  throw new Error("Preview only. Nothing has been saved.");
}
