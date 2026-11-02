/**
 * Runs an Undo as a small, resumable list of writes.  A correction may have
 * changed more than one record (a saved rule also changes its matching
 * history), so "Undo" is only complete when every stage has acknowledged.
 *
 * `completed` belongs to the sheet instance. Keeping it outside React state
 * avoids a retry re-running a write that succeeded just before a render.
 */
export type TeachingUndoStage = {
  id: string;
  /** A dependent write must not run while its guard stage remains active. */
  dependsOn?: string[];
  /** An acknowledged write can lose its response. Only use for an idempotent
   * recovery outcome, never for a general failed mutation. */
  acceptsError?: (error: unknown) => boolean;
  run: () => Promise<unknown>;
};

export type TeachingUndoResult = {
  complete: boolean;
  failedStageIds: string[];
};

export async function runTeachingUndoStages(
  stages: readonly TeachingUndoStage[],
  completed: Set<string>,
): Promise<TeachingUndoResult> {
  const failedStageIds: string[] = [];

  for (const stage of stages) {
    if (completed.has(stage.id)) continue;
    if (stage.dependsOn?.some((id) => !completed.has(id))) {
      failedStageIds.push(stage.id);
      continue;
    }
    try {
      await stage.run();
      completed.add(stage.id);
    } catch (error) {
      if (stage.acceptsError?.(error)) {
        completed.add(stage.id);
        continue;
      }
      // Continue independent stages. It is more truthful to report one
      // partial undo than to leave known-safe reversals unsent.
      failedStageIds.push(stage.id);
    }
  }

  return { complete: failedStageIds.length === 0, failedStageIds };
}
