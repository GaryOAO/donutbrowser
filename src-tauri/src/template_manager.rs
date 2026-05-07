use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::camoufox_manager::CamoufoxConfig;
use crate::events;
use crate::profile::types::ProxyBindingMode;
use crate::wayfern_manager::WayfernConfig;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProfileTemplate {
  pub id: String,
  pub name: String,
  pub browser: String,
  pub version: String,
  #[serde(default = "default_release_type")]
  pub release_type: String,
  #[serde(default)]
  pub proxy_binding_mode: ProxyBindingMode,
  #[serde(default)]
  pub camoufox_config: Option<CamoufoxConfig>,
  #[serde(default)]
  pub wayfern_config: Option<WayfernConfig>,
  #[serde(default)]
  pub ephemeral: bool,
  #[serde(default)]
  pub dns_blocklist: Option<String>,
  #[serde(default)]
  pub launch_hook: Option<String>,
  #[serde(default)]
  pub extension_group_id: Option<String>,
  pub created_at: u64,
  pub updated_at: u64,
}

fn default_release_type() -> String {
  "stable".to_string()
}

fn now_secs() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs()
}

fn templates_file() -> std::path::PathBuf {
  crate::app_dirs::data_subdir().join("templates.json")
}

pub struct TemplateManager {
  templates: Mutex<Vec<ProfileTemplate>>,
}

impl TemplateManager {
  pub fn instance() -> &'static TemplateManager {
    &TEMPLATE_MANAGER
  }

  fn load_from_disk() -> Vec<ProfileTemplate> {
    let path = templates_file();
    if !path.exists() {
      return Vec::new();
    }
    match fs::read_to_string(&path) {
      Ok(data) => serde_json::from_str(&data).unwrap_or_default(),
      Err(_) => Vec::new(),
    }
  }

  fn save_to_disk(templates: &[ProfileTemplate]) -> Result<(), String> {
    let path = templates_file();
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let data = serde_json::to_string_pretty(templates).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn list_templates(&self) -> Vec<ProfileTemplate> {
    let lock = self.templates.lock().unwrap();
    lock.clone()
  }

  pub fn get_template(&self, id: &str) -> Option<ProfileTemplate> {
    let lock = self.templates.lock().unwrap();
    lock.iter().find(|t| t.id == id).cloned()
  }

  pub fn create_template(&self, mut template: ProfileTemplate) -> Result<ProfileTemplate, String> {
    let mut lock = self.templates.lock().unwrap();
    template.id = uuid::Uuid::new_v4().to_string();
    let now = now_secs();
    template.created_at = now;
    template.updated_at = now;
    lock.push(template.clone());
    Self::save_to_disk(&lock)?;
    let _ = events::emit("templates-changed", ());
    Ok(template)
  }

  pub fn update_template(&self, id: &str, name: String) -> Result<ProfileTemplate, String> {
    let mut lock = self.templates.lock().unwrap();
    let template = lock
      .iter_mut()
      .find(|t| t.id == id)
      .ok_or_else(|| "Template not found".to_string())?;
    template.name = name;
    template.updated_at = now_secs();
    let result = template.clone();
    Self::save_to_disk(&lock)?;
    let _ = events::emit("templates-changed", ());
    Ok(result)
  }

  pub fn delete_template(&self, id: &str) -> Result<(), String> {
    let mut lock = self.templates.lock().unwrap();
    let len_before = lock.len();
    lock.retain(|t| t.id != id);
    if lock.len() == len_before {
      return Err("Template not found".to_string());
    }
    Self::save_to_disk(&lock)?;
    let _ = events::emit("templates-changed", ());
    Ok(())
  }
}

lazy_static::lazy_static! {
  static ref TEMPLATE_MANAGER: TemplateManager = TemplateManager {
    templates: Mutex::new(TemplateManager::load_from_disk()),
  };
}
