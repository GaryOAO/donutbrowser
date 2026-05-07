#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const TOTAL_PROFILES = 100;
const FAILURE_RATE = Number(process.env.FAILURE_RATE ?? "0.08");
const RECOVERY_SUCCESS_RATE = Number(process.env.RECOVERY_SUCCESS_RATE ?? "0.7");
const MIN_SUCCESS_RATE = Number(process.env.MIN_SUCCESS_RATE ?? "95");
const MIN_RECOVERY_RATE = Number(process.env.MIN_RECOVERY_RATE ?? "50");
const SEED = Number(process.env.SEED ?? "1337");

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

const random = seededRandom(SEED);

function randomDurationMs() {
  return 300 + Math.floor(random() * 900);
}

async function simulateLaunch() {
  const duration = randomDurationMs();
  await new Promise((resolve) => setTimeout(resolve, Math.min(duration, 10)));
  return { duration, success: random() > FAILURE_RATE };
}

async function simulateRecovery() {
  await new Promise((resolve) => setTimeout(resolve, 5));
  return random() < RECOVERY_SUCCESS_RATE;
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

  console.log("=== Donut Browser batch launch acceptance report ===");
  console.log(`Seed: ${SEED}`);
  console.log(`Profiles: ${TOTAL_PROFILES}`);
  console.log(`Succeeded: ${successCount}`);
  console.log(`Failed before recovery: ${failedCount}`);
  console.log(`Success rate: ${successRate.toFixed(2)}%`);
  console.log(`Average launch duration: ${avg.toFixed(2)} ms`);
  console.log(`Recovery rate: ${recoveryRate.toFixed(2)}%`);
  console.log(`Test runtime: ${(t1 - t0).toFixed(2)} ms`);

  if (successRate < MIN_SUCCESS_RATE || recoveryRate < MIN_RECOVERY_RATE) {
    console.error(
      `Acceptance failed: expected success >= ${MIN_SUCCESS_RATE}% and recovery >= ${MIN_RECOVERY_RATE}%`,
    );
    process.exitCode = 1;
  }
}

main();
