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

test("状态切换：toggleState 会翻转 enabled", () => {
  const next = toggleState(baseState);
  assert.equal(next.enabled, true);
});

test("错误提示：applyError 会写入错误并标记 failed", () => {
  const next = applyError(baseState, "节点切换失败");
  assert.equal(next.error, "节点切换失败");
  assert.equal(next.status, "failed");
});

test("批量任务进度：updateBatchProgress 正确更新百分比与状态", () => {
  const running = updateBatchProgress(baseState, 25, 100);
  assert.equal(running.batchProgress, 25);
  assert.equal(running.status, "running");

  const done = updateBatchProgress(baseState, 100, 100);
  assert.equal(done.batchProgress, 100);
  assert.equal(done.status, "done");
});
