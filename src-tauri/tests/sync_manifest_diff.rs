//! Integration tests for the file-level three-way `compute_diff`. These
//! exercise the new conflict / tombstone / v1-migration behavior introduced
//! when manifest v2 was rolled out. They use only the public sync API and
//! ephemeral in-memory manifests — no network, no real profile dir.

use chrono::Utc;
use donutbrowser_lib::sync::manifest::ManifestFileEntry;
use donutbrowser_lib::sync::manifest::{format_conflict_path, MANIFEST_VERSION};
use donutbrowser_lib::sync::{compute_diff, ConflictedFile, SyncManifest, TombstoneEntry};

fn entry(path: &str, mtime_secs: i64, sha: &str) -> ManifestFileEntry {
  ManifestFileEntry {
    path: path.to_string(),
    size: 10,
    mtime: mtime_secs,
    hash: format!("blake-{sha}"),
    mtime_ms: mtime_secs * 1000,
    sha256: Some(sha.to_string()),
  }
}

fn manifest(files: Vec<ManifestFileEntry>, last_sync_ms: Option<i64>) -> SyncManifest {
  SyncManifest {
    version: MANIFEST_VERSION,
    profile_id: "p1".to_string(),
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
fn both_devices_change_same_file_produces_conflict_not_data_loss() {
  // The bug we're fixing: device A modifies "Bookmarks", device B modifies
  // "Bookmarks" too. Old algorithm: whichever side synced second silently
  // overwrote the other. New algorithm: emit a ConflictedFile entry so the
  // local copy is preserved and the remote is staged as `*.conflict-*`.
  let last_sync_ms = 1_000_000_i64;
  let local = manifest(
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
  let remote = manifest(
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
  let ConflictedFile {
    path,
    conflict_local_path,
    ..
  } = &diff.conflicts[0];
  assert_eq!(path, "Bookmarks");
  assert!(conflict_local_path.starts_with("Bookmarks.conflict-device-X-"));
}

#[test]
fn different_files_changed_on_each_side_merges_without_conflict() {
  // The real-world scenario from the bug report: A modifies bookmark, B
  // modifies cookie. Neither side should lose work, and no conflict file
  // should be created — both sides converge by simple upload+download.
  let last_sync_ms = 1_000_000_i64;
  let local = manifest(
    vec![
      ManifestFileEntry {
        path: "Bookmarks".to_string(),
        size: 50,
        mtime: 2000,
        hash: "blake-A".to_string(),
        mtime_ms: 2_000_000,
        sha256: Some("sha-A-bookmarks".to_string()),
      },
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
  let remote = manifest(
    vec![
      ManifestFileEntry {
        path: "Bookmarks".to_string(),
        size: 40,
        mtime: 500,
        hash: "blake-bookmarks-old".to_string(),
        mtime_ms: 500_000,
        sha256: Some("sha-bookmarks-old".to_string()),
      },
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

  let diff = compute_diff(&local, Some(&remote), "device-X");
  assert!(diff.conflicts.is_empty(), "no conflict expected: {diff:?}");
  assert!(diff.files_to_upload.iter().any(|f| f.path == "Bookmarks"));
  assert!(diff.files_to_download.iter().any(|f| f.path == "Cookies"));
  // Crucially: nothing is deleted.
  assert!(diff.files_to_delete_local.is_empty());
  assert!(diff.files_to_delete_remote.is_empty());
}

#[test]
fn delete_vs_modify_tombstone_wins_when_newer() {
  // Remote deletion is more recent than local edit -> propagate the delete.
  let local = manifest(vec![entry("Old", 1000, "x")], Some(500_000));
  let mut remote = manifest(vec![], Some(500_000));
  remote.tombstones.push(TombstoneEntry {
    path: "Old".to_string(),
    deleted_at_ms: 2_000_000,
  });
  let diff = compute_diff(&local, Some(&remote), "device-X");
  assert!(diff.files_to_delete_local.contains(&"Old".to_string()));
}

#[test]
fn delete_vs_modify_modify_wins_when_newer() {
  // Local edit is more recent than the remote tombstone -> resurrect the
  // file by uploading.
  let local = manifest(vec![entry("Old", 3000, "y")], Some(500_000));
  let mut remote = manifest(vec![], Some(500_000));
  remote.tombstones.push(TombstoneEntry {
    path: "Old".to_string(),
    deleted_at_ms: 1_000_000,
  });
  let diff = compute_diff(&local, Some(&remote), "device-X");
  assert!(diff.files_to_delete_local.is_empty());
  assert!(diff.files_to_upload.iter().any(|f| f.path == "Old"));
}

#[test]
fn v1_manifest_loads_migrates_and_diffs_cleanly() {
  // A v1 manifest on the wire must deserialize, migrate in place, and then
  // produce a coherent diff against a v2 local manifest with identical
  // content.
  let v1_json = r#"{
    "version": 1,
    "profileId": "p1",
    "generatedAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z",
    "excludeGlobs": [],
    "files": [
      {"path": "Cookies", "size": 100, "mtime": 1000, "hash": "blake-cookies"}
    ]
  }"#;
  let mut remote: SyncManifest = serde_json::from_str(v1_json).unwrap();
  assert_eq!(remote.version, 1);
  remote.migrate_to_v2();
  assert_eq!(remote.version, MANIFEST_VERSION);
  assert_eq!(remote.files[0].mtime_ms, 1_000_000);
  // Falls back to blake3 hash as the canonical sha256 key during migration.
  assert_eq!(remote.files[0].sha256.as_deref(), Some("blake-cookies"));

  let local = manifest(vec![entry("Cookies", 1000, "blake-cookies")], None);
  let diff = compute_diff(&local, Some(&remote), "device-X");
  assert!(diff.is_empty(), "identical content must produce empty diff");
}

#[test]
fn format_conflict_path_is_stable_and_distinct() {
  let a = format_conflict_path("Cookies", "deviceA", 1234);
  let b = format_conflict_path("Cookies", "deviceB", 1234);
  let c = format_conflict_path("Cookies", "deviceA", 5678);
  assert_eq!(a, "Cookies.conflict-deviceA-1234");
  assert_ne!(a, b);
  assert_ne!(a, c);
}
