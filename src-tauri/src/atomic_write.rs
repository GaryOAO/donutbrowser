//! Atomic file writes via tempfile + rename, with optional backup retention.
use std::io::Write;
use std::path::Path;

pub fn atomic_write_bytes(path: &Path, bytes: &[u8]) -> std::io::Result<()> {
  let parent = path
    .parent()
    .ok_or_else(|| std::io::Error::new(std::io::ErrorKind::InvalidInput, "no parent dir"))?;
  std::fs::create_dir_all(parent)?;
  let tmp = tempfile::Builder::new()
    .prefix(".atomic-")
    .suffix(".tmp")
    .tempfile_in(parent)?;
  {
    let mut f = tmp.as_file();
    f.write_all(bytes)?;
    f.sync_all()?;
  }
  tmp.persist(path).map_err(|e| e.error)?;
  Ok(())
}

#[allow(dead_code)]
pub fn atomic_write_json<T: serde::Serialize>(path: &Path, value: &T) -> std::io::Result<()> {
  let bytes = serde_json::to_vec_pretty(value)
    .map_err(|e| std::io::Error::new(std::io::ErrorKind::InvalidData, e))?;
  atomic_write_bytes(path, &bytes)
}
