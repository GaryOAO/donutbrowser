use chrono::{DateTime, Utc};
use globset::{Glob, GlobSet, GlobSetBuilder};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{BufReader, Read};
use std::path::Path;
use std::time::SystemTime;

use super::types::{SyncError, SyncResult};
use crate::profile::types::BrowserProfile;

/// Default exclude patterns for volatile browser profile files.
/// Patterns use `**/` prefix to match at any directory depth, since the sync
/// engine scans from `profiles/{uuid}/` which contains `profile/Default/...`.
pub const DEFAULT_EXCLUDE_PATTERNS: &[&str] = &[
  "**/Cache/**",
  "**/Code Cache/**",
  "**/GPUCache/**",
  "**/GrShaderCache/**",
  "**/ShaderCache/**",
  "**/DawnCache/**",
  "**/DawnGraphiteCache/**",
  "**/Service Worker/CacheStorage/**",
  "**/Service Worker/ScriptCache/**",
  "**/Session Storage/**",
  "**/blob_storage/**",
  "**/Crashpad/**",
  "**/Crash Reports/**",
  "**/BrowserMetrics/**",
  "**/optimization_guide_model_store/**",
  "**/Safe Browsing/**",
  "**/component_crx_cache/**",
  "**/cache2/**",
  "**/startupCache/**",
  "**/safebrowsing/**",
  "**/storage/temporary/**",
  "**/crashes/**",
  "**/minidumps/**",
  "*.tmp",
  "**/LOG",
  "**/LOG.old",
  "**/LOCK",
  "**/*-journal",
  "**/*-wal",
  "**/SingletonLock",
  "**/SingletonSocket",
  "**/SingletonCookie",
  "**/Secure Preferences",
  "**/GraphiteDawnCache/**",
  "**/DawnWebGPUCache/**",
  "**/BrowserMetrics*",
  "**/.DS_Store",
  ".donut-sync/**",
];

/// Current manifest schema version. v1 is the legacy "directory-level LWW" format;
/// v2 introduces millisecond mtimes, sha256, tombstones, and last_sync_ms for
/// file-level three-way conflict detection.
pub const MANIFEST_VERSION: u32 = 2;

/// A single file entry in the manifest.
///
/// v1 fields: `path`, `size`, `mtime` (seconds), `hash` (blake3).
/// v2 adds: `mtime_ms` (milliseconds, more precise) and `sha256` (canonical
/// content hash used for cross-device equality). v1 entries deserialize with
/// `mtime_ms = 0` and `sha256 = None`; callers should treat those as "fall
/// back to `mtime * 1000` and `hash`".
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ManifestFileEntry {
  pub path: String,
  pub size: u64,
  pub mtime: i64,
  pub hash: String,
  /// Millisecond mtime introduced in v2. `0` if loaded from a v1 manifest.
  #[serde(default, rename = "mtimeMs")]
  pub mtime_ms: i64,
  /// SHA-256 content hash introduced in v2. `None` if loaded from a v1 manifest;
  /// in that case `hash` (blake3) is used as the canonical equality key.
  #[serde(default)]
  pub sha256: Option<String>,
}

impl ManifestFileEntry {
  /// Effective mtime in milliseconds. Falls back to `mtime * 1000` for v1 entries.
  pub fn effective_mtime_ms(&self) -> i64 {
    if self.mtime_ms != 0 {
      self.mtime_ms
    } else {
      self.mtime.saturating_mul(1000)
    }
  }

  /// The canonical content key used to decide "same content" across devices.
  /// Prefers sha256 (v2) and falls back to blake3 hash (v1).
  pub fn content_key(&self) -> &str {
    self.sha256.as_deref().unwrap_or(self.hash.as_str())
  }
}

/// Tombstone marking a deleted file path. Stored on the manifest so other
/// devices can distinguish "never existed" from "deleted intentionally" and
/// avoid resurrecting a deletion.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TombstoneEntry {
  pub path: String,
  #[serde(rename = "deletedAtMs")]
  pub deleted_at_ms: i64,
}

/// The sync manifest for a profile
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncManifest {
  pub version: u32,
  #[serde(rename = "profileId")]
  pub profile_id: String,
  #[serde(rename = "generatedAt")]
  pub generated_at: String,
  #[serde(rename = "updatedAt")]
  pub updated_at: String,
  #[serde(rename = "excludeGlobs")]
  pub exclude_globs: Vec<String>,
  pub files: Vec<ManifestFileEntry>,
  #[serde(default)]
  pub encrypted: bool,
  /// Tombstones (deleted file events), introduced in v2.
  #[serde(default)]
  pub tombstones: Vec<TombstoneEntry>,
  /// Wall-clock ms timestamp of the last successful sync from this device's
  /// point of view. Used as the "base" in three-way conflict detection.
  #[serde(default, rename = "lastSyncMs")]
  pub last_sync_ms: Option<i64>,
}

impl SyncManifest {
  pub fn new(profile_id: String, exclude_globs: Vec<String>) -> Self {
    let now = Utc::now().to_rfc3339();
    Self {
      version: MANIFEST_VERSION,
      profile_id,
      generated_at: now.clone(),
      updated_at: now,
      exclude_globs,
      files: Vec::new(),
      encrypted: false,
      tombstones: Vec::new(),
      last_sync_ms: None,
    }
  }

  pub fn updated_at_datetime(&self) -> Option<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(&self.updated_at)
      .ok()
      .map(|dt| dt.with_timezone(&Utc))
  }

  /// Migrate a v1 manifest in-memory: ensures every file entry has `mtime_ms`
  /// derived from `mtime` and a `sha256` filled from the existing `hash` so
  /// downstream code can rely on the v2 invariants. Idempotent.
  pub fn migrate_to_v2(&mut self) {
    for f in &mut self.files {
      if f.mtime_ms == 0 {
        f.mtime_ms = f.mtime.saturating_mul(1000);
      }
      if f.sha256.is_none() {
        f.sha256 = Some(f.hash.clone());
      }
    }
    if self.version < MANIFEST_VERSION {
      self.version = MANIFEST_VERSION;
    }
  }
}

/// Local hash cache to avoid re-hashing unchanged files
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct HashCache {
  pub entries: HashMap<String, HashCacheEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HashCacheEntry {
  pub size: u64,
  pub mtime: i64,
  pub hash: String,
  /// SHA-256 cached alongside the blake3 hash. Optional for backward
  /// compatibility with v1 caches that only stored blake3.
  #[serde(default)]
  pub sha256: Option<String>,
}

impl HashCache {
  pub fn load(cache_path: &Path) -> Self {
    if !cache_path.exists() {
      return Self::default();
    }

    match fs::read_to_string(cache_path) {
      Ok(content) => serde_json::from_str(&content).unwrap_or_default(),
      Err(_) => Self::default(),
    }
  }

  pub fn save(&self, cache_path: &Path) -> SyncResult<()> {
    if let Some(parent) = cache_path.parent() {
      fs::create_dir_all(parent).map_err(|e| {
        SyncError::IoError(format!(
          "Failed to create cache directory {}: {e}",
          parent.display()
        ))
      })?;
    }

    let json = serde_json::to_string_pretty(self)
      .map_err(|e| SyncError::SerializationError(format!("Failed to serialize hash cache: {e}")))?;

    fs::write(cache_path, json).map_err(|e| {
      SyncError::IoError(format!(
        "Failed to write hash cache {}: {e}",
        cache_path.display()
      ))
    })?;

    Ok(())
  }

  pub fn get(&self, path: &str, size: u64, mtime: i64) -> Option<&str> {
    self.entries.get(path).and_then(|entry| {
      if entry.size == size && entry.mtime == mtime {
        Some(entry.hash.as_str())
      } else {
        None
      }
    })
  }

  /// Returns both blake3 and sha256 from cache if present and matching size/mtime.
  /// Returns None if missing OR if the cache entry predates v2 (no sha256 stored).
  pub fn get_pair(&self, path: &str, size: u64, mtime: i64) -> Option<(&str, &str)> {
    self.entries.get(path).and_then(|entry| {
      if entry.size == size && entry.mtime == mtime {
        entry
          .sha256
          .as_ref()
          .map(|sha| (entry.hash.as_str(), sha.as_str()))
      } else {
        None
      }
    })
  }

  pub fn insert(&mut self, path: String, size: u64, mtime: i64, hash: String) {
    self.entries.insert(
      path,
      HashCacheEntry {
        size,
        mtime,
        hash,
        sha256: None,
      },
    );
  }

  pub fn insert_pair(&mut self, path: String, size: u64, mtime: i64, hash: String, sha256: String) {
    self.entries.insert(
      path,
      HashCacheEntry {
        size,
        mtime,
        hash,
        sha256: Some(sha256),
      },
    );
  }
}

/// Build a GlobSet from exclude patterns
fn build_exclude_globset(patterns: &[String]) -> SyncResult<GlobSet> {
  let mut builder = GlobSetBuilder::new();
  for pattern in patterns {
    let glob = Glob::new(pattern)
      .map_err(|e| SyncError::InvalidData(format!("Invalid exclude pattern '{}': {e}", pattern)))?;
    builder.add(glob);
  }
  builder
    .build()
    .map_err(|e| SyncError::InvalidData(format!("Failed to build exclude globset: {e}")))
}

/// Compute both blake3 and sha256 of a file in a single pass.
/// Returns None if the file doesn't exist (was deleted).
fn hash_file(path: &Path) -> Result<Option<(String, String)>, SyncError> {
  use sha2::Digest;
  let file = match File::open(path) {
    Ok(f) => f,
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    Err(e) => {
      return Err(SyncError::IoError(format!(
        "Failed to open {}: {e}",
        path.display()
      )));
    }
  };

  let mut reader = BufReader::new(file);
  let mut blake = blake3::Hasher::new();
  let mut sha = sha2::Sha256::new();
  let mut buffer = [0u8; 65536]; // 64KB buffer

  loop {
    let bytes_read = reader
      .read(&mut buffer)
      .map_err(|e| SyncError::IoError(format!("Failed to read {}: {e}", path.display())))?;
    if bytes_read == 0 {
      break;
    }
    blake.update(&buffer[..bytes_read]);
    sha.update(&buffer[..bytes_read]);
  }

  let blake_hex = blake.finalize().to_hex().to_string();
  let sha_hex = bytes_to_hex(sha.finalize().as_slice());
  Ok(Some((blake_hex, sha_hex)))
}

/// Compute blake3 and sha256 of metadata.json after sanitizing volatile fields.
/// This prevents infinite sync loops where updating last_sync triggers a new sync.
fn hash_sanitized_metadata(path: &Path) -> Result<Option<(String, String)>, SyncError> {
  use sha2::Digest;
  let content = match fs::read_to_string(path) {
    Ok(c) => c,
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    Err(e) => {
      return Err(SyncError::IoError(format!(
        "Failed to read metadata at {}: {e}",
        path.display()
      )));
    }
  };

  let mut profile: BrowserProfile = serde_json::from_str(&content).map_err(|e| {
    SyncError::SerializationError(format!("Failed to parse metadata for hashing: {e}"))
  })?;

  // Sanitize volatile fields that should not trigger a re-sync
  profile.last_sync = None;
  profile.process_id = None;
  profile.last_launch = None;

  let sanitized_json = serde_json::to_string(&profile).map_err(|e| {
    SyncError::SerializationError(format!("Failed to serialize sanitized metadata: {e}"))
  })?;

  let mut blake = blake3::Hasher::new();
  blake.update(sanitized_json.as_bytes());
  let mut sha = sha2::Sha256::new();
  sha.update(sanitized_json.as_bytes());

  Ok(Some((
    blake.finalize().to_hex().to_string(),
    bytes_to_hex(sha.finalize().as_slice()),
  )))
}

/// Tiny lowercase-hex encoder so we don't pull in the `hex` crate just for
/// the sha256 representation in manifests.
fn bytes_to_hex(bytes: &[u8]) -> String {
  const HEX: &[u8; 16] = b"0123456789abcdef";
  let mut out = String::with_capacity(bytes.len() * 2);
  for &b in bytes {
    out.push(HEX[(b >> 4) as usize] as char);
    out.push(HEX[(b & 0x0f) as usize] as char);
  }
  out
}

/// Get mtime as a (seconds, milliseconds) unix timestamp pair.
/// Returns None if the file doesn't exist (was deleted).
fn get_mtime(path: &Path) -> Result<Option<(i64, i64)>, SyncError> {
  let metadata = match path.metadata() {
    Ok(m) => m,
    Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
    Err(e) => {
      return Err(SyncError::IoError(format!(
        "Failed to get metadata for {}: {e}",
        path.display()
      )));
    }
  };

  let mtime = metadata
    .modified()
    .map_err(|e| SyncError::IoError(format!("Failed to get mtime for {}: {e}", path.display())))?;

  let dur = mtime.duration_since(SystemTime::UNIX_EPOCH).ok();
  let secs = dur.map(|d| d.as_secs() as i64).unwrap_or(0);
  let ms = dur.map(|d| d.as_millis() as i64).unwrap_or(0);
  Ok(Some((secs, ms)))
}

/// Generate a manifest for a profile directory
pub fn generate_manifest(
  profile_id: &str,
  profile_dir: &Path,
  cache: &mut HashCache,
) -> SyncResult<SyncManifest> {
  let exclude_patterns: Vec<String> = DEFAULT_EXCLUDE_PATTERNS
    .iter()
    .map(|s| s.to_string())
    .collect();
  let globset = build_exclude_globset(&exclude_patterns)?;

  let mut manifest = SyncManifest::new(profile_id.to_string(), exclude_patterns);
  let mut max_mtime: i64 = 0;

  if !profile_dir.exists() {
    log::debug!(
      "Profile directory doesn't exist: {}, creating empty manifest",
      profile_dir.display()
    );
    return Ok(manifest);
  }

  fn walk_dir(
    dir: &Path,
    base_dir: &Path,
    globset: &GlobSet,
    cache: &mut HashCache,
    files: &mut Vec<ManifestFileEntry>,
    max_mtime: &mut i64,
  ) -> SyncResult<()> {
    let entries = fs::read_dir(dir).map_err(|e| {
      SyncError::IoError(format!("Failed to read directory {}: {e}", dir.display()))
    })?;

    for entry in entries {
      let entry = entry.map_err(|e| {
        SyncError::IoError(format!("Failed to read entry in {}: {e}", dir.display()))
      })?;

      let path = entry.path();
      let relative_path = path
        .strip_prefix(base_dir)
        .map_err(|_| SyncError::IoError("Failed to compute relative path".to_string()))?
        .to_string_lossy()
        .replace('\\', "/");

      // Check if excluded
      if globset.is_match(&relative_path) {
        continue;
      }

      // Get metadata - skip if file was deleted between directory read and metadata access
      let metadata = match path.metadata() {
        Ok(m) => m,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
          log::debug!(
            "File disappeared during manifest generation, skipping: {}",
            path.display()
          );
          continue;
        }
        Err(e) => {
          return Err(SyncError::IoError(format!(
            "Failed to get metadata for {}: {e}",
            path.display()
          )));
        }
      };

      if metadata.is_dir() {
        walk_dir(&path, base_dir, globset, cache, files, max_mtime)?;
      } else if metadata.is_file() {
        let size = metadata.len();
        let (mtime, mtime_ms) = match get_mtime(&path)? {
          Some(m) => m,
          None => {
            // File was deleted, skip it
            log::debug!(
              "File disappeared during manifest generation, skipping: {}",
              path.display()
            );
            continue;
          }
        };

        *max_mtime = (*max_mtime).max(mtime);

        // Compute (blake3, sha256). Reuse cache when both halves are present.
        let (hash, sha256) = if relative_path == "metadata.json" {
          // Special case: sanitize metadata.json before hashing to prevent sync loops
          match hash_sanitized_metadata(&path)? {
            Some(pair) => pair,
            None => {
              log::debug!(
                "File disappeared during manifest generation, skipping: {}",
                path.display()
              );
              continue;
            }
          }
        } else if let Some((cached_blake, cached_sha)) = cache.get_pair(&relative_path, size, mtime)
        {
          (cached_blake.to_string(), cached_sha.to_string())
        } else {
          match hash_file(&path)? {
            Some((blake_hex, sha_hex)) => {
              cache.insert_pair(
                relative_path.clone(),
                size,
                mtime,
                blake_hex.clone(),
                sha_hex.clone(),
              );
              (blake_hex, sha_hex)
            }
            None => {
              // File was deleted, skip it
              log::debug!(
                "File disappeared during manifest generation, skipping: {}",
                path.display()
              );
              continue;
            }
          }
        };

        files.push(ManifestFileEntry {
          path: relative_path,
          size,
          mtime,
          hash,
          mtime_ms,
          sha256: Some(sha256),
        });
      }
    }

    Ok(())
  }

  walk_dir(
    profile_dir,
    profile_dir,
    &globset,
    cache,
    &mut manifest.files,
    &mut max_mtime,
  )?;

  // Sort files for deterministic manifest
  manifest.files.sort_by(|a, b| a.path.cmp(&b.path));

  // Update the updatedAt timestamp to max mtime
  if max_mtime > 0 {
    if let Some(dt) = DateTime::from_timestamp(max_mtime, 0) {
      manifest.updated_at = dt.to_rfc3339();
    }
  }

  Ok(manifest)
}

/// A file that has been changed concurrently on both sides since the last sync.
/// The local copy is preserved; the remote copy will be downloaded under
/// `conflict_local_path` so the user can review/merge.
#[derive(Debug, Clone)]
pub struct ConflictedFile {
  /// Original path (the remote key path). Used to fetch from remote storage.
  pub path: String,
  /// Local destination path for the remote version, e.g. `Cookies.conflict-abcd-1716000000000`.
  pub conflict_local_path: String,
  /// Remote entry metadata, used for size/hash bookkeeping during download.
  pub remote_entry: ManifestFileEntry,
  /// Local entry metadata that "won" the path. Kept for diagnostics.
  pub local_entry: ManifestFileEntry,
}

/// Compute the diff between local and remote manifests
#[derive(Debug, Default)]
pub struct ManifestDiff {
  pub files_to_upload: Vec<ManifestFileEntry>,
  pub files_to_download: Vec<ManifestFileEntry>,
  pub files_to_delete_local: Vec<String>,
  pub files_to_delete_remote: Vec<String>,
  /// Files where both sides changed since the local manifest's `last_sync_ms`.
  /// Resolution: keep local, write remote next to it under `conflict_local_path`.
  pub conflicts: Vec<ConflictedFile>,
}

impl ManifestDiff {
  pub fn is_empty(&self) -> bool {
    self.files_to_upload.is_empty()
      && self.files_to_download.is_empty()
      && self.files_to_delete_local.is_empty()
      && self.files_to_delete_remote.is_empty()
      && self.conflicts.is_empty()
  }
}

/// Build a per-path tombstone lookup. The map value is the deletion timestamp
/// in milliseconds.
fn tombstone_map(manifest: &SyncManifest) -> HashMap<&str, i64> {
  manifest
    .tombstones
    .iter()
    .map(|t| (t.path.as_str(), t.deleted_at_ms))
    .collect()
}

/// Format the local destination path for a conflict copy of a remote file.
/// Form: `<original>.conflict-<device_id>-<unix_ms>`.
pub fn format_conflict_path(original: &str, device_id: &str, now_ms: i64) -> String {
  format!("{}.conflict-{}-{}", original, device_id, now_ms)
}

/// Compute what needs to be synced between local and remote.
///
/// `device_id` is used to name conflict copies so two devices syncing roughly
/// at the same time don't collide on the conflict filename.
///
/// Algorithm (v2, file-level three-way):
///   for each path in union(local.files, remote.files):
///     if only-local:
///       remote-tombstone newer than local.mtime_ms => delete local
///       else => upload
///     if only-remote:
///       local-tombstone newer than remote.mtime_ms => delete remote
///       else => download
///     if both:
///       sha256 equal => skip
///       else if both mtimes > last_sync_ms => CONFLICT (keep local, download remote-as-conflict)
///       else newer mtime wins
pub fn compute_diff(
  local: &SyncManifest,
  remote: Option<&SyncManifest>,
  device_id: &str,
) -> ManifestDiff {
  let now_ms = Utc::now().timestamp_millis();
  let mut diff = ManifestDiff::default();

  let Some(remote) = remote else {
    // No remote manifest - upload everything
    diff.files_to_upload = local.files.clone();
    return diff;
  };

  // Build hash maps for quick lookup
  let local_files: HashMap<&str, &ManifestFileEntry> =
    local.files.iter().map(|f| (f.path.as_str(), f)).collect();
  let remote_files: HashMap<&str, &ManifestFileEntry> =
    remote.files.iter().map(|f| (f.path.as_str(), f)).collect();
  let local_tomb = tombstone_map(local);
  let remote_tomb = tombstone_map(remote);

  // Safety: if local is empty but remote has files, always download from remote.
  // This prevents data loss when profile data files are deleted but metadata
  // survives — the newly generated manifest would otherwise look like a
  // full-tree deletion and wipe everything remotely.
  if local.files.is_empty() && local.tombstones.is_empty() && !remote.files.is_empty() {
    log::info!(
      "Local manifest is empty but remote has {} files — downloading from remote to recover",
      remote.files.len()
    );
    diff.files_to_download = remote.files.clone();
    return diff;
  }

  // The "last successful sync" anchor. If absent (very first sync, or a v1
  // manifest that has no `last_sync_ms`) we cannot tell whether divergence is
  // concurrent or sequential, so we fall back to "no concurrent edits" — the
  // newer-mtime wins path is used and no conflict files are written.
  let last_sync = local.last_sync_ms.unwrap_or(0);

  // Collect the union of paths so we visit each exactly once.
  let mut all_paths: Vec<&str> = local_files.keys().copied().collect();
  for p in remote_files.keys() {
    if !local_files.contains_key(p) {
      all_paths.push(p);
    }
  }
  all_paths.sort();

  for path in all_paths {
    match (local_files.get(path), remote_files.get(path)) {
      (Some(local_entry), None) => {
        // Only local. Did remote tombstone this AFTER our local edit?
        if let Some(&deleted_at) = remote_tomb.get(path) {
          if deleted_at > local_entry.effective_mtime_ms() {
            // Remote intentionally deleted it after our local change -> obey delete
            diff.files_to_delete_local.push(path.to_string());
            continue;
          }
        }
        diff.files_to_upload.push((*local_entry).clone());
      }
      (None, Some(remote_entry)) => {
        if let Some(&deleted_at) = local_tomb.get(path) {
          if deleted_at > remote_entry.effective_mtime_ms() {
            // We intentionally deleted it after the remote's change -> propagate delete
            diff.files_to_delete_remote.push(path.to_string());
            continue;
          }
        }
        diff.files_to_download.push((*remote_entry).clone());
      }
      (Some(local_entry), Some(remote_entry)) => {
        if local_entry.content_key() == remote_entry.content_key() {
          continue; // identical content, nothing to do
        }
        let local_ms = local_entry.effective_mtime_ms();
        let remote_ms = remote_entry.effective_mtime_ms();
        let local_changed_since_sync = local_ms > last_sync;
        let remote_changed_since_sync = remote_ms > last_sync;

        if last_sync > 0 && local_changed_since_sync && remote_changed_since_sync {
          // Both sides edited after the last successful sync -> real conflict.
          // Keep the local file in place, and stage the remote version as a
          // sibling conflict copy so the user can reconcile.
          diff.conflicts.push(ConflictedFile {
            path: path.to_string(),
            conflict_local_path: format_conflict_path(path, device_id, now_ms),
            remote_entry: (*remote_entry).clone(),
            local_entry: (*local_entry).clone(),
          });
          continue;
        }

        // Otherwise: newer mtime wins.
        if local_ms >= remote_ms {
          diff.files_to_upload.push((*local_entry).clone());
        } else {
          diff.files_to_download.push((*remote_entry).clone());
        }
      }
      (None, None) => unreachable!("path came from the union, must appear in one side"),
    }
  }

  diff
}

/// Get the path to the hash cache file for a profile
pub fn get_cache_path(profile_dir: &Path) -> std::path::PathBuf {
  profile_dir.join(".donut-sync").join("cache.json")
}

#[cfg(test)]
mod tests {
  use super::*;
  use tempfile::TempDir;

  #[test]
  fn test_hash_cache_operations() {
    let cache_dir = TempDir::new().unwrap();
    let cache_path = cache_dir.path().join("cache.json");

    let mut cache = HashCache::default();
    cache.insert(
      "test.txt".to_string(),
      100,
      1234567890,
      "abc123".to_string(),
    );

    assert_eq!(cache.get("test.txt", 100, 1234567890), Some("abc123"));
    assert_eq!(cache.get("test.txt", 100, 999), None); // Different mtime
    assert_eq!(cache.get("test.txt", 50, 1234567890), None); // Different size

    cache.save(&cache_path).unwrap();

    let loaded = HashCache::load(&cache_path);
    assert_eq!(loaded.get("test.txt", 100, 1234567890), Some("abc123"));
  }

  #[test]
  fn test_generate_manifest_empty_dir() {
    let temp_dir = TempDir::new().unwrap();
    let profile_dir = temp_dir.path().join("profile");
    fs::create_dir_all(&profile_dir).unwrap();

    let mut cache = HashCache::default();
    let manifest = generate_manifest("test-profile", &profile_dir, &mut cache).unwrap();

    assert_eq!(manifest.profile_id, "test-profile");
    assert_eq!(manifest.version, MANIFEST_VERSION);
    assert!(manifest.files.is_empty());
  }

  #[test]
  fn test_generate_manifest_with_files() {
    let temp_dir = TempDir::new().unwrap();
    let profile_dir = temp_dir.path().join("profile");
    fs::create_dir_all(&profile_dir).unwrap();

    fs::write(profile_dir.join("file1.txt"), "hello").unwrap();
    fs::write(profile_dir.join("file2.txt"), "world").unwrap();
    fs::create_dir_all(profile_dir.join("subdir")).unwrap();
    fs::write(profile_dir.join("subdir/file3.txt"), "nested").unwrap();

    let mut cache = HashCache::default();
    let manifest = generate_manifest("test-profile", &profile_dir, &mut cache).unwrap();

    assert_eq!(manifest.files.len(), 3);
    assert!(manifest.files.iter().any(|f| f.path == "file1.txt"));
    assert!(manifest.files.iter().any(|f| f.path == "file2.txt"));
    assert!(manifest.files.iter().any(|f| f.path == "subdir/file3.txt"));
  }

  #[test]
  fn test_generate_manifest_excludes_cache() {
    let temp_dir = TempDir::new().unwrap();
    let profile_dir = temp_dir.path().join("profile");
    fs::create_dir_all(&profile_dir).unwrap();

    fs::write(profile_dir.join("file1.txt"), "keep").unwrap();
    fs::create_dir_all(profile_dir.join("Cache")).unwrap();
    fs::write(profile_dir.join("Cache/data"), "exclude").unwrap();
    fs::create_dir_all(profile_dir.join("Code Cache")).unwrap();
    fs::write(profile_dir.join("Code Cache/wasm"), "exclude").unwrap();

    let mut cache = HashCache::default();
    let manifest = generate_manifest("test-profile", &profile_dir, &mut cache).unwrap();

    assert_eq!(manifest.files.len(), 1);
    assert_eq!(manifest.files[0].path, "file1.txt");
  }

  #[test]
  fn test_generate_manifest_excludes_nested_caches() {
    let temp_dir = TempDir::new().unwrap();
    let profile_dir = temp_dir.path().join("profile_root");
    fs::create_dir_all(&profile_dir).unwrap();

    // Simulate real Chromium structure: profile/Default/Cache/...
    let default_dir = profile_dir.join("profile/Default");
    fs::create_dir_all(&default_dir).unwrap();
    fs::write(default_dir.join("Cookies"), "keep").unwrap();
    fs::create_dir_all(default_dir.join("Cache")).unwrap();
    fs::write(default_dir.join("Cache/data_0"), "exclude").unwrap();
    fs::create_dir_all(default_dir.join("Code Cache/js")).unwrap();
    fs::write(default_dir.join("Code Cache/js/abc"), "exclude").unwrap();
    fs::create_dir_all(default_dir.join("GPUCache")).unwrap();
    fs::write(default_dir.join("GPUCache/data_0"), "exclude").unwrap();
    fs::create_dir_all(default_dir.join("Session Storage")).unwrap();
    fs::write(default_dir.join("Session Storage/000003.log"), "exclude").unwrap();
    fs::create_dir_all(default_dir.join("Local Storage/leveldb")).unwrap();
    fs::write(default_dir.join("Local Storage/leveldb/000001.ldb"), "keep").unwrap();

    // Caches at user-data-dir level
    fs::create_dir_all(profile_dir.join("profile/ShaderCache")).unwrap();
    fs::write(profile_dir.join("profile/ShaderCache/data"), "exclude").unwrap();
    fs::create_dir_all(profile_dir.join("profile/Crashpad")).unwrap();
    fs::write(profile_dir.join("profile/Crashpad/report"), "exclude").unwrap();

    // metadata.json at root
    let profile = BrowserProfile::default();
    fs::write(
      profile_dir.join("metadata.json"),
      serde_json::to_string(&profile).unwrap(),
    )
    .unwrap();

    let mut cache = HashCache::default();
    let manifest = generate_manifest("test-profile", &profile_dir, &mut cache).unwrap();

    let paths: Vec<&str> = manifest.files.iter().map(|f| f.path.as_str()).collect();
    assert!(
      paths.contains(&"metadata.json"),
      "metadata.json should be synced"
    );
    assert!(
      paths.contains(&"profile/Default/Cookies"),
      "Cookies should be synced"
    );
    assert!(
      paths.contains(&"profile/Default/Local Storage/leveldb/000001.ldb"),
      "Local Storage should be synced"
    );
    assert!(
      !paths.iter().any(|p| p.contains("Cache")),
      "Cache directories should be excluded: {paths:?}"
    );
    assert!(
      !paths.iter().any(|p| p.contains("Session Storage")),
      "Session Storage should be excluded: {paths:?}"
    );
    assert!(
      !paths.iter().any(|p| p.contains("Crashpad")),
      "Crashpad should be excluded: {paths:?}"
    );
  }

  fn make_entry(path: &str, mtime_secs: i64, sha: &str) -> ManifestFileEntry {
    ManifestFileEntry {
      path: path.to_string(),
      size: 10,
      mtime: mtime_secs,
      hash: format!("blake-{sha}"),
      mtime_ms: mtime_secs * 1000,
      sha256: Some(sha.to_string()),
    }
  }

  fn make_manifest(files: Vec<ManifestFileEntry>, last_sync_ms: Option<i64>) -> SyncManifest {
    SyncManifest {
      version: MANIFEST_VERSION,
      profile_id: "test".to_string(),
      generated_at: Utc::now().to_rfc3339(),
      updated_at: Utc::now().to_rfc3339(),
      exclude_globs: vec![],
      files,
      encrypted: false,
      tombstones: vec![],
      last_sync_ms,
    }
  }

  #[test]
  fn test_compute_diff_upload_all_when_no_remote() {
    let local = make_manifest(
      vec![
        make_entry("file1.txt", 1000, "abc"),
        make_entry("file2.txt", 2000, "def"),
      ],
      None,
    );

    let diff = compute_diff(&local, None, "device-A");

    assert_eq!(diff.files_to_upload.len(), 2);
    assert!(diff.files_to_download.is_empty());
    assert!(diff.files_to_delete_local.is_empty());
    assert!(diff.files_to_delete_remote.is_empty());
    assert!(diff.conflicts.is_empty());
  }

  #[test]
  fn test_compute_diff_detect_changes_newer_mtime_wins() {
    // last_sync_ms = 0 => no conflict detection; per-file newer-mtime wins.
    let local = make_manifest(
      vec![
        make_entry("unchanged.txt", 1000, "same"),
        make_entry("changed.txt", 2000, "new_hash"),
        make_entry("new_file.txt", 3000, "new"),
      ],
      None,
    );

    let remote = make_manifest(
      vec![
        make_entry("unchanged.txt", 1000, "same"),
        make_entry("changed.txt", 1000, "old_hash"),
        make_entry("deleted.txt", 500, "gone"),
      ],
      None,
    );

    let diff = compute_diff(&local, Some(&remote), "device-A");

    // changed.txt: local newer -> upload
    // new_file.txt: only local -> upload
    // deleted.txt: only remote, no tombstone -> download
    assert_eq!(diff.files_to_upload.len(), 2);
    assert!(diff.files_to_upload.iter().any(|f| f.path == "changed.txt"));
    assert!(diff
      .files_to_upload
      .iter()
      .any(|f| f.path == "new_file.txt"));
    assert_eq!(diff.files_to_download.len(), 1);
    assert_eq!(diff.files_to_download[0].path, "deleted.txt");
    assert!(diff.conflicts.is_empty());
  }

  #[test]
  fn test_manifest_encrypted_flag_default() {
    let json = r#"{"version":1,"profileId":"test","generatedAt":"2024-01-01T00:00:00Z","updatedAt":"2024-01-01T00:00:00Z","excludeGlobs":[],"files":[]}"#;
    let manifest: SyncManifest = serde_json::from_str(json).unwrap();
    assert!(!manifest.encrypted);
  }

  #[test]
  fn test_manifest_with_encrypted_flag() {
    let json = r#"{"version":1,"profileId":"test","generatedAt":"2024-01-01T00:00:00Z","updatedAt":"2024-01-01T00:00:00Z","excludeGlobs":[],"files":[],"encrypted":true}"#;
    let manifest: SyncManifest = serde_json::from_str(json).unwrap();
    assert!(manifest.encrypted);

    let serialized = serde_json::to_string(&manifest).unwrap();
    let deserialized: SyncManifest = serde_json::from_str(&serialized).unwrap();
    assert!(deserialized.encrypted);
  }

  #[test]
  fn test_compute_diff_empty_local_downloads_from_remote() {
    // When local has no files but remote does, always download from remote.
    // This prevents data loss when profile data is deleted but metadata survives.
    let local = make_manifest(vec![], None);

    let remote = make_manifest(
      vec![
        make_entry("Cookies", 1000, "abc"),
        make_entry("Local State", 1000, "def"),
      ],
      None,
    );

    let diff = compute_diff(&local, Some(&remote), "device-A");

    // Must download all remote files, NOT delete them
    assert_eq!(diff.files_to_download.len(), 2);
    assert!(diff.files_to_upload.is_empty());
    assert!(diff.files_to_delete_remote.is_empty());
    assert!(diff.files_to_delete_local.is_empty());
  }

  #[test]
  fn test_compute_diff_v1_manifest_loads_and_diffs() {
    // A v1 manifest on the wire (no mtime_ms, no sha256, no tombstones, no
    // lastSyncMs). We must still be able to deserialize and diff against it.
    let v1_json = r#"{
      "version": 1,
      "profileId": "p1",
      "generatedAt": "2024-01-01T00:00:00Z",
      "updatedAt": "2024-01-01T00:00:00Z",
      "excludeGlobs": [],
      "files": [
        {"path": "Cookies", "size": 100, "mtime": 1000, "hash": "blake-old"}
      ]
    }"#;
    let mut remote: SyncManifest = serde_json::from_str(v1_json).expect("v1 must deserialize");
    // mtime_ms should default to 0; sha256 to None; tombstones empty.
    assert_eq!(remote.files[0].mtime_ms, 0);
    assert!(remote.files[0].sha256.is_none());
    assert!(remote.tombstones.is_empty());
    assert_eq!(remote.version, 1);

    // Migration: fills mtime_ms and sha256-from-hash, bumps version.
    remote.migrate_to_v2();
    assert_eq!(remote.files[0].mtime_ms, 1_000_000);
    assert_eq!(remote.files[0].sha256.as_deref(), Some("blake-old"));
    assert_eq!(remote.version, MANIFEST_VERSION);

    // After migration we can diff normally against a local v2 manifest.
    let local = make_manifest(vec![make_entry("Cookies", 2000, "blake-old")], None);
    // Same content key (sha256 == blake-old on both sides after migration).
    let diff = compute_diff(&local, Some(&remote), "device-A");
    assert!(diff.is_empty(), "identical content should produce no diff");
  }

  #[test]
  fn test_compute_diff_conflict_when_both_changed_since_last_sync() {
    // The bug we're fixing: A modifies bookmarks, B modifies cookies. Without
    // file-level three-way merge, B's sync would silently delete A's change.
    let last_sync_ms = 1_000_000_i64;
    let local = make_manifest(
      vec![
        // A's change: bookmark modified after last sync
        ManifestFileEntry {
          path: "Bookmarks".to_string(),
          size: 50,
          mtime: 2000,
          hash: "blake-A".to_string(),
          mtime_ms: 2_000_000,
          sha256: Some("sha-A-bookmarks".to_string()),
        },
        // Cookies unchanged on this device since last sync
        ManifestFileEntry {
          path: "Cookies".to_string(),
          size: 30,
          mtime: 500,
          hash: "blake-cookies-old".to_string(),
          mtime_ms: 500_000,
          sha256: Some("sha-cookies-old".to_string()),
        },
      ],
      Some(last_sync_ms),
    );

    let remote = make_manifest(
      vec![
        // Bookmarks unchanged on remote
        ManifestFileEntry {
          path: "Bookmarks".to_string(),
          size: 40,
          mtime: 500,
          hash: "blake-bookmarks-old".to_string(),
          mtime_ms: 500_000,
          sha256: Some("sha-bookmarks-old".to_string()),
        },
        // B's change: cookies modified after last sync
        ManifestFileEntry {
          path: "Cookies".to_string(),
          size: 35,
          mtime: 3000,
          hash: "blake-B".to_string(),
          mtime_ms: 3_000_000,
          sha256: Some("sha-B-cookies".to_string()),
        },
      ],
      Some(last_sync_ms),
    );

    let diff = compute_diff(&local, Some(&remote), "device-A");

    // Bookmarks: only local changed -> upload (not conflict, remote is at old base)
    assert!(
      diff.files_to_upload.iter().any(|f| f.path == "Bookmarks"),
      "Bookmarks should upload, got: {diff:?}"
    );
    // Cookies: only remote changed -> download
    assert!(
      diff.files_to_download.iter().any(|f| f.path == "Cookies"),
      "Cookies should download, got: {diff:?}"
    );
    // No conflicts in this scenario (different files changed on each side).
    assert!(
      diff.conflicts.is_empty(),
      "no conflicts expected, got: {diff:?}"
    );
    // Crucially: nothing is deleted.
    assert!(diff.files_to_delete_local.is_empty());
    assert!(diff.files_to_delete_remote.is_empty());
  }

  #[test]
  fn test_compute_diff_same_file_changed_on_both_sides_is_conflict() {
    let last_sync_ms = 1_000_000_i64;
    let local = make_manifest(
      vec![ManifestFileEntry {
        path: "Bookmarks".to_string(),
        size: 50,
        mtime: 2000,
        hash: "blake-A".to_string(),
        mtime_ms: 2_000_000,
        sha256: Some("sha-A".to_string()),
      }],
      Some(last_sync_ms),
    );

    let remote = make_manifest(
      vec![ManifestFileEntry {
        path: "Bookmarks".to_string(),
        size: 60,
        mtime: 3000,
        hash: "blake-B".to_string(),
        mtime_ms: 3_000_000,
        sha256: Some("sha-B".to_string()),
      }],
      Some(last_sync_ms),
    );

    let diff = compute_diff(&local, Some(&remote), "device-X");

    assert!(diff.files_to_upload.is_empty());
    assert!(diff.files_to_download.is_empty());
    assert_eq!(diff.conflicts.len(), 1);
    let c = &diff.conflicts[0];
    assert_eq!(c.path, "Bookmarks");
    assert!(
      c.conflict_local_path
        .starts_with("Bookmarks.conflict-device-X-"),
      "got: {}",
      c.conflict_local_path
    );
    assert_eq!(c.remote_entry.sha256.as_deref(), Some("sha-B"));
    assert_eq!(c.local_entry.sha256.as_deref(), Some("sha-A"));
  }

  #[test]
  fn test_compute_diff_tombstone_arbitrates_delete_vs_modify() {
    // Local has a file with mtime=1000s. Remote has deleted that file with
    // tombstone deleted_at_ms=2_000_000 (= 2000s, newer than the local mtime).
    // The remote tombstone should win and we delete locally.
    let local = make_manifest(vec![make_entry("Old File", 1000, "sha-old")], Some(500_000));
    let mut remote = make_manifest(vec![], Some(500_000));
    remote.tombstones.push(TombstoneEntry {
      path: "Old File".to_string(),
      deleted_at_ms: 2_000_000,
    });

    let diff = compute_diff(&local, Some(&remote), "device-A");
    assert!(diff.files_to_delete_local.contains(&"Old File".to_string()));
    assert!(diff.files_to_upload.is_empty());

    // Opposite: tombstone is OLDER than local edit -> upload wins (resurrect).
    let local2 = make_manifest(vec![make_entry("Old File", 3000, "sha-new")], Some(500_000));
    let mut remote2 = make_manifest(vec![], Some(500_000));
    remote2.tombstones.push(TombstoneEntry {
      path: "Old File".to_string(),
      deleted_at_ms: 1_000_000, // 1000s; local mtime_ms=3_000_000
    });
    let diff2 = compute_diff(&local2, Some(&remote2), "device-A");
    assert!(diff2.files_to_delete_local.is_empty());
    assert!(diff2.files_to_upload.iter().any(|f| f.path == "Old File"));

    // Local tombstone propagates a delete remotely.
    let mut local3 = make_manifest(vec![], Some(500_000));
    local3.tombstones.push(TombstoneEntry {
      path: "Old File".to_string(),
      deleted_at_ms: 4_000_000,
    });
    let remote3 = make_manifest(vec![make_entry("Old File", 1000, "sha-x")], Some(500_000));
    let diff3 = compute_diff(&local3, Some(&remote3), "device-A");
    assert!(diff3
      .files_to_delete_remote
      .contains(&"Old File".to_string()));
  }

  #[test]
  fn test_generate_manifest_sanitizes_metadata() {
    let temp_dir = TempDir::new().unwrap();
    let profile_dir = temp_dir.path().join("profile");
    fs::create_dir_all(&profile_dir).unwrap();

    let profile_id = uuid::Uuid::new_v4();
    let metadata_path = profile_dir.join("metadata.json");

    let profile = BrowserProfile {
      id: profile_id,
      name: "test-profile".to_string(),
      last_sync: Some(100),
      process_id: Some(1234),
      ..Default::default()
    };

    fs::write(&metadata_path, serde_json::to_string(&profile).unwrap()).unwrap();

    let mut cache = HashCache::default();
    let manifest1 = generate_manifest(&profile_id.to_string(), &profile_dir, &mut cache).unwrap();
    let hash1 = manifest1
      .files
      .iter()
      .find(|f| f.path == "metadata.json")
      .unwrap()
      .hash
      .clone();

    // Update volatile fields
    let profile2 = BrowserProfile {
      id: profile_id,
      name: "test-profile".to_string(),
      last_sync: Some(200),
      process_id: Some(5678),
      ..Default::default()
    };

    fs::write(&metadata_path, serde_json::to_string(&profile2).unwrap()).unwrap();

    let manifest2 = generate_manifest(&profile_id.to_string(), &profile_dir, &mut cache).unwrap();
    let hash2 = manifest2
      .files
      .iter()
      .find(|f| f.path == "metadata.json")
      .unwrap()
      .hash
      .clone();

    // Hash should be identical because volatile fields are sanitized
    assert_eq!(
      hash1, hash2,
      "Metadata hash should be stable across last_sync/process_id updates"
    );

    // Change a non-volatile field
    let profile3 = BrowserProfile {
      id: profile_id,
      name: "changed-name".to_string(),
      last_sync: Some(200),
      ..Default::default()
    };

    fs::write(&metadata_path, serde_json::to_string(&profile3).unwrap()).unwrap();

    let manifest3 = generate_manifest(&profile_id.to_string(), &profile_dir, &mut cache).unwrap();
    let hash3 = manifest3
      .files
      .iter()
      .find(|f| f.path == "metadata.json")
      .unwrap()
      .hash
      .clone();

    // Hash should be different because name changed
    assert_ne!(
      hash1, hash3,
      "Metadata hash should change when non-volatile fields change"
    );
  }
}
