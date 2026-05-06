use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::VecDeque;
use std::sync::Mutex;
use std::time::Instant;

const MAX_LOGS: usize = 500;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OperationLogEntry {
  pub timestamp: String,
  pub profile_id: Option<String>,
  pub proxy_group: Option<String>,
  pub proxy_node: Option<String>,
  pub action: String,
  pub result: String,
  pub latency_ms: u128,
  pub message: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct OperationLogFilter {
  pub profile_id: Option<String>,
  pub start_time: Option<String>,
  pub end_time: Option<String>,
}

static OPERATION_LOGS: Mutex<VecDeque<OperationLogEntry>> = Mutex::new(VecDeque::new());

pub fn mask_sensitive(value: &str) -> String {
  let lower = value.to_lowercase();
  if lower.contains("token") || lower.contains("secret") {
    "[REDACTED]".to_string()
  } else {
    value.to_string()
  }
}

pub fn record(entry: OperationLogEntry) {
  let mut logs = OPERATION_LOGS.lock().unwrap();
  logs.push_front(entry);
  while logs.len() > MAX_LOGS {
    logs.pop_back();
  }
}

pub fn operation_start() -> Instant {
  Instant::now()
}

pub fn record_operation(
  profile_id: Option<String>,
  proxy_group: Option<String>,
  proxy_node: Option<String>,
  action: &str,
  result: &str,
  started_at: Instant,
  message: Option<String>,
) {
  record(OperationLogEntry {
    timestamp: Utc::now().to_rfc3339(),
    profile_id,
    proxy_group,
    proxy_node,
    action: action.to_string(),
    result: result.to_string(),
    latency_ms: started_at.elapsed().as_millis(),
    message: message.map(|v| mask_sensitive(&v)),
  });
}

#[tauri::command]
pub fn get_recent_operation_logs(filter: Option<OperationLogFilter>) -> Vec<OperationLogEntry> {
  let logs = OPERATION_LOGS.lock().unwrap();
  logs
    .iter()
    .filter(|entry| {
      if let Some(f) = &filter {
        if let Some(pid) = &f.profile_id {
          if entry.profile_id.as_ref() != Some(pid) {
            return false;
          }
        }
        if let Some(start) = &f.start_time {
          if entry.timestamp < *start {
            return false;
          }
        }
        if let Some(end) = &f.end_time {
          if entry.timestamp > *end {
            return false;
          }
        }
      }
      true
    })
    .cloned()
    .collect()
}

#[cfg(test)]
mod tests {
  use super::*;

  fn reset_logs() {
    OPERATION_LOGS.lock().unwrap().clear();
  }

  #[test]
  fn masks_sensitive_messages() {
    assert_eq!(mask_sensitive("token=abc123"), "[REDACTED]");
    assert_eq!(mask_sensitive("SECRET leaked"), "[REDACTED]");
    assert_eq!(mask_sensitive("plain failure"), "plain failure");
  }

  #[test]
  fn filters_recent_logs_by_profile() {
    reset_logs();
    record(OperationLogEntry {
      timestamp: "2026-05-07T01:00:00Z".to_string(),
      profile_id: Some("profile-a".to_string()),
      proxy_group: None,
      proxy_node: None,
      action: "launch_browser".to_string(),
      result: "success".to_string(),
      latency_ms: 10,
      message: None,
    });
    record(OperationLogEntry {
      timestamp: "2026-05-07T02:00:00Z".to_string(),
      profile_id: Some("profile-b".to_string()),
      proxy_group: None,
      proxy_node: None,
      action: "launch_browser".to_string(),
      result: "failed".to_string(),
      latency_ms: 20,
      message: Some("failed".to_string()),
    });

    let logs = get_recent_operation_logs(Some(OperationLogFilter {
      profile_id: Some("profile-a".to_string()),
      start_time: None,
      end_time: None,
    }));

    assert_eq!(logs.len(), 1);
    assert_eq!(logs[0].profile_id.as_deref(), Some("profile-a"));
  }
}
