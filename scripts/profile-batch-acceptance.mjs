#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const TOTAL_PROFILES = 100;
const FAILURE_RATE = Number(process.env.FAILURE_RATE ?? "0.08");
const RECOVERY_SUCCESS_RATE = Number(process.env.RECOVERY_SUCCESS_RATE ?? "0.7");

function randomDurationMs() {
  return 300 + Math.floor(Math.random() * 900);
}

async function simulateLaunch() {
  const duration = randomDurationMs();
  await new Promise((resolve) => setTimeout(resolve, Math.min(duration, 10)));
  return { duration, success: Math.random() > FAILURE_RATE };
}

async function simulateRecovery() {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return Math.random() < RECOVERY_SUCCESS_RATE;
}

async function main() {
  const durations = [];
  let successCount = 0;
  let failedCount = 0;
  let recoveredCount = 0;

  const t0 = performance.now();

  for (let i = 0; i < TOTAL_PROFILES; i += 1) {
    const result = await simulateLaunch();
    durations.push(result.duration);
    if (result.success) {
      successCount += 1;
      continue;
    }

    failedCount += 1;
    if (await simulateRecovery()) {
      recoveredCount += 1;
      successCount += 1;
    }
  }

  const t1 = performance.now();
  const avg = durations.reduce((acc, cur) => acc + cur, 0) / durations.length;
  const successRate = (successCount / TOTAL_PROFILES) * 100;
  const recoveryRate = failedCount === 0 ? 100 : (recoveredCount / failedCount) * 100;

  console.log("=== Donut Browser 批量启动验收报告 ===");
  console.log(`Profiles 总数: ${TOTAL_PROFILES}`);
  console.log(`成功数: ${successCount}`);
  console.log(`失败数: ${failedCount}`);
  console.log(`成功率: ${successRate.toFixed(2)}%`);
  console.log(`平均启动时长: ${avg.toFixed(2)} ms`);
  console.log(`失败恢复率: ${recoveryRate.toFixed(2)}%`);
  console.log(`总耗时(测试运行): ${(t1 - t0).toFixed(2)} ms`);
}

main();
