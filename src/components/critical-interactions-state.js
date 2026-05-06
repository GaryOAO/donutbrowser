export function toggleState(state) {
  return { ...state, enabled: !state.enabled };
}

export function applyError(state, error) {
  return { ...state, error, status: "failed" };
}

export function updateBatchProgress(state, completed, total) {
  const safeTotal = total <= 0 ? 1 : total;
  const progress = Math.min(100, Math.max(0, Math.round((completed / safeTotal) * 100)));
  return {
    ...state,
    batchProgress: progress,
    status: progress >= 100 ? "done" : "running",
  };
}
