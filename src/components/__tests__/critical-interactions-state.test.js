import test from "node:test";
import assert from "node:assert/strict";

import {
  applyError,
  toggleState,
  updateBatchProgress,
} from "../critical-interactions-state.js";

const baseState = {
  enabled: false,
  error: null,
  batchProgress: 0,
  status: "idle",
};

test("toggleState flips enabled", () => {
  const next = toggleState(baseState);
  assert.equal(next.enabled, true);
});

test("applyError stores the error and marks failed", () => {
  const next = applyError(baseState, "node switch failed");
  assert.equal(next.error, "node switch failed");
  assert.equal(next.status, "failed");
});

test("updateBatchProgress updates percentage and status", () => {
  const running = updateBatchProgress(baseState, 25, 100);
  assert.equal(running.batchProgress, 25);
  assert.equal(running.status, "running");

  const done = updateBatchProgress(baseState, 100, 100);
  assert.equal(done.batchProgress, 100);
  assert.equal(done.status, "done");
});

test("updateBatchProgress clamps invalid values", () => {
  const negative = updateBatchProgress(baseState, -10, 100);
  assert.equal(negative.batchProgress, 0);
  assert.equal(negative.status, "running");

  const overflow = updateBatchProgress(baseState, 120, 100);
  assert.equal(overflow.batchProgress, 100);
  assert.equal(overflow.status, "done");

  const zeroTotal = updateBatchProgress(baseState, 1, 0);
  assert.equal(zeroTotal.batchProgress, 100);
  assert.equal(zeroTotal.status, "done");
});
