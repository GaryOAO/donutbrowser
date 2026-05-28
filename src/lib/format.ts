// Centralized formatting helpers consolidated from multiple duplicate
// implementations across the codebase. These functions are intentionally
// pure (no React/i18n dependencies) so they can be used from hooks,
// components, and toast renderers alike.
//
// TODO(perf-refactor): migrate the following call sites to use these helpers
// and delete their local copies in a follow-up PR:
//   - src/hooks/use-browser-download.ts  (formatBytes, formatTime)
//   - src/hooks/use-version-updater.ts   (formatTimeUntilUpdate)
//   - src/components/traffic-details-dialog.tsx (formatBytes, formatBytesPerSecond)
//   - src/components/bandwidth-mini-chart.tsx (formatBytes [bytes/sec variant])
//   - src/components/custom-toast.tsx (formatBytesCompact)
//   - src/components/dns-blocklist-dialog.tsx (formatSize)

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

/**
 * Format a byte count as a human-readable string using IEC 1024-based units.
 * Matches the implementation previously found in `use-browser-download.ts` and
 * the various dialog/chart components: always emits one decimal place for
 * non-zero values above 1 KB.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / k ** i;
  const formatted =
    i === 0 ? `${Math.round(value)}` : `${Number.parseFloat(value.toFixed(1))}`;
  return `${formatted} ${BYTE_UNITS[i]}`;
}

/**
 * Compact byte formatter used by toast/inline UI: same scale as
 * {@link formatBytes} but always uses fixed-decimal `value.toFixed(1)`
 * for non-zero values >= 1 KB so widths stay stable across updates.
 */
export function formatBytesCompact(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const k = 1024;
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / k ** i;
  return `${i === 0 ? value : value.toFixed(1)} ${BYTE_UNITS[i]}`;
}

/**
 * Byte-per-second formatter (suffix `/s`). Used by traffic dialogs and the
 * bandwidth mini-chart.
 */
export function formatBytesPerSecond(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B/s";
  const k = 1024;
  const i = Math.min(
    Math.floor(Math.log(bytes) / Math.log(k)),
    BYTE_UNITS.length - 1,
  );
  const value = bytes / k ** i;
  const formatted =
    i === 0 ? `${Math.round(value)}` : `${Number.parseFloat(value.toFixed(1))}`;
  return `${formatted} ${BYTE_UNITS[i]}/s`;
}

/**
 * Shorter helper kept for parity with the DNS blocklist dialog's `formatSize`
 * which capped at MB and never used a decimal for bytes. Re-exported under the
 * same name so migration is a one-line import swap.
 */
export function formatSize(bytes: number): string {
  return formatBytes(bytes);
}

/**
 * Compact duration string (`12s`, `3m 4s`, `1h 2m`).
 * Matches `use-browser-download.ts:62` `formatTime`.
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0s";
  if (seconds < 60) {
    return `${Math.round(seconds)}s`;
  }
  if (seconds < 3600) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.round(seconds % 60);
    return `${minutes}m ${remainingSeconds}s`;
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${minutes}m`;
}

/**
 * Verbose "time until update" string (`12 seconds`, `3 minutes`, `2 hours`).
 * Matches `use-version-updater.ts:408` `formatTimeUntilUpdate`.
 */
export function formatTimeUntilUpdate(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "0 seconds";
  if (seconds < 60) {
    return `${Math.round(seconds)} seconds`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? "" : "s"}`;
}
