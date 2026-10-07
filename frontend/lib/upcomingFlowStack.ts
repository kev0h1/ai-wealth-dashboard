/** Pure Back-stack search for UpcomingFlowSheet.returnTo. `views` is the whole stack, `depth` the current index. */
export type ReturnPlan = { kind: "none" } | { kind: "back" } | { kind: "go"; delta: number };

export function planReturn<View>(views: readonly View[], depth: number, match: (view: View) => boolean): ReturnPlan {
  for (let index = depth - 1; index >= 0; index -= 1) {
    if (match(views[index])) return index === depth - 1 ? { kind: "back" } : { kind: "go", delta: index - depth };
  }
  return { kind: "none" };
}
