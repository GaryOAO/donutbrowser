use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;

#[derive(Debug, Clone)]
pub struct NodeConfig<'a> {
  pub name: &'a str,
  pub server: &'a str,
  pub port: u16,
  pub protocol: &'a str,
  pub password: Option<&'a str>,
  pub extra: &'a HashMap<String, serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayInstance {
  pub node_id: String,
  pub local_socks_port: u16,
  pub local_http_port: u16,
  pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GatewayStatus {
  pub installed: bool,
  pub binary_path: Option<String>,
  pub running_instances: usize,
}

pub struct MihomoManager {
  instances: Mutex<HashMap<String, GatewayInstance>>,
  binary_path: Mutex<Option<PathBuf>>,
}

impl MihomoManager {
  pub fn new() -> Self {
    Self {
      instances: Mutex::new(HashMap::new()),
      binary_path: Mutex::new(None),
    }
  }

  pub fn instance() -> &'static MihomoManager {
    &MIHOMO_MANAGER
  }

  fn mihomo_dir() -> PathBuf {
    crate::app_dirs::mihomo_dir()
  }

  fn binary_name() -> &'static str {
    if cfg!(target_os = "windows") {
      "mihomo.exe"
    } else {
      "mihomo"
    }
  }

  pub fn detect_binary(&self) -> Option<PathBuf> {
    let local = Self::mihomo_dir().join(Self::binary_name());
    if local.exists() {
      return Some(local);
    }

    let which_cmd = if cfg!(target_os = "windows") {
      "where"
    } else {
      "which"
    };
    if let Ok(output) = std::process::Command::new(which_cmd)
      .arg("mihomo")
      .output()
    {
      if output.status.success() {
        let path_str = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !path_str.is_empty() {
          let p = PathBuf::from(path_str);
          if p.exists() {
            return Some(p);
          }
        }
      }
    }

    None
  }

  pub async fn download_binary(&self) -> Result<PathBuf, String> {
    let dir = Self::mihomo_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create mihomo dir: {e}"))?;

    let platform = Self::detect_platform()?;
    let api_url = "https://api.github.com/repos/MetaCubeX/mihomo/releases/latest";

    let client = reqwest::Client::builder()
      .user_agent("donutbrowser")
      .timeout(std::time::Duration::from_secs(30))
      .build()
      .map_err(|e| format!("Failed to build HTTP client: {e}"))?;

    let release: serde_json::Value = client
      .get(api_url)
      .send()
      .await
      .map_err(|e| format!("Failed to fetch release info: {e}"))?
      .json()
      .await
      .map_err(|e| format!("Failed to parse release info: {e}"))?;

    let assets = release["assets"]
      .as_array()
      .ok_or("No assets in release")?;

    let asset = assets
      .iter()
      .find(|a| {
        let name = a["name"].as_str().unwrap_or("");
        name.contains(&platform) && (name.ends_with(".gz") || name.ends_with(".zip"))
          && !name.contains("alpha")
          && !name.contains("compatible")
      })
      .ok_or_else(|| format!("No asset found for platform: {platform}"))?;

    let download_url = asset["browser_download_url"]
      .as_str()
      .ok_or("No download URL")?;
    let asset_name = asset["name"].as_str().ok_or("No asset name")?;

    let archive_path = dir.join(asset_name);

    let mut response = client
      .get(download_url)
      .send()
      .await
      .map_err(|e| format!("Failed to download mihomo: {e}"))?;

    let mut file =
      fs::File::create(&archive_path).map_err(|e| format!("Failed to create archive file: {e}"))?;

    use std::io::Write;
    while let Some(chunk) = response
      .chunk()
      .await
      .map_err(|e| format!("Failed to read download chunk: {e}"))?
    {
      file
        .write_all(&chunk)
        .map_err(|e| format!("Failed to write chunk: {e}"))?;
    }
    drop(file);

    let binary_path = dir.join(Self::binary_name());
    Self::extract_binary(&archive_path, &binary_path, asset_name)?;

    let _ = fs::remove_file(&archive_path);

    #[cfg(unix)]
    {
      use std::os::unix::fs::PermissionsExt;
      let mut perms = fs::metadata(&binary_path)
        .map_err(|e| format!("Failed to read binary metadata: {e}"))?
        .permissions();
      perms.set_mode(0o755);
      fs::set_permissions(&binary_path, perms)
        .map_err(|e| format!("Failed to set binary permissions: {e}"))?;
    }

    {
      let mut cached = self.binary_path.lock().unwrap();
      *cached = Some(binary_path.clone());
    }

    Ok(binary_path)
  }

  fn detect_platform() -> Result<String, String> {
    let arch = if cfg!(target_arch = "aarch64") {
      "arm64"
    } else if cfg!(target_arch = "x86_64") {
      "amd64"
    } else {
      return Err("Unsupported architecture".to_string());
    };

    let os = if cfg!(target_os = "macos") {
      "darwin"
    } else if cfg!(target_os = "linux") {
      "linux"
    } else if cfg!(target_os = "windows") {
      "windows"
    } else {
      return Err("Unsupported OS".to_string());
    };

    Ok(format!("{os}-{arch}"))
  }

  fn extract_binary(archive_path: &PathBuf, dest: &PathBuf, archive_name: &str) -> Result<(), String> {
    if archive_name.ends_with(".gz") && !archive_name.ends_with(".tar.gz") {
      let file = fs::File::open(archive_path)
        .map_err(|e| format!("Failed to open archive: {e}"))?;
      let mut gz = flate2::read::GzDecoder::new(file);
      let mut out = fs::File::create(dest)
        .map_err(|e| format!("Failed to create binary file: {e}"))?;
      std::io::copy(&mut gz, &mut out)
        .map_err(|e| format!("Failed to extract gz: {e}"))?;
    } else if archive_name.ends_with(".zip") {
      let file = fs::File::open(archive_path)
        .map_err(|e| format!("Failed to open zip: {e}"))?;
      let mut archive = zip::ZipArchive::new(file)
        .map_err(|e| format!("Failed to read zip: {e}"))?;
      let binary_name = Self::binary_name();
      for i in 0..archive.len() {
        let mut entry = archive
          .by_index(i)
          .map_err(|e| format!("Failed to read zip entry: {e}"))?;
        let entry_name = entry.name().to_string();
        if entry_name == binary_name || entry_name.ends_with(&format!("/{binary_name}")) {
          let mut out = fs::File::create(dest)
            .map_err(|e| format!("Failed to create binary: {e}"))?;
          std::io::copy(&mut entry, &mut out)
            .map_err(|e| format!("Failed to extract binary: {e}"))?;
          return Ok(());
        }
      }
      return Err("mihomo binary not found in zip archive".to_string());
    } else {
      return Err(format!("Unsupported archive format: {archive_name}"));
    }
    Ok(())
  }

  pub fn get_binary_path(&self) -> Option<PathBuf> {
    {
      let cached = self.binary_path.lock().unwrap();
      if let Some(ref p) = *cached {
        return Some(p.clone());
      }
    }
    let detected = self.detect_binary();
    if let Some(ref p) = detected {
      let mut cached = self.binary_path.lock().unwrap();
      *cached = Some(p.clone());
    }
    detected
  }

  #[allow(dead_code)]
  pub fn is_installed(&self) -> bool {
    self.get_binary_path().is_some()
  }

  pub fn get_status(&self) -> GatewayStatus {
    let binary_path = self.get_binary_path();
    let running_instances = self.instances.lock().unwrap().len();
    GatewayStatus {
      installed: binary_path.is_some(),
      binary_path: binary_path.map(|p| p.to_string_lossy().to_string()),
      running_instances,
    }
  }

  pub fn generate_config(node: &NodeConfig<'_>, socks_port: u16, http_port: u16) -> String {
    let mut proxy_fields = format!(
      "  - name: \"{}\"\n    type: {}\n    server: {}\n    port: {}",
      node.name, node.protocol, node.server, node.port
    );
    if let Some(pwd) = node.password {
      if !pwd.is_empty() {
        proxy_fields.push_str(&format!("\n    password: \"{pwd}\""));
      }
    }
    for (k, v) in node.extra {
      let val_str = match v {
        serde_json::Value::String(s) => format!("\"{s}\""),
        serde_json::Value::Bool(b) => b.to_string(),
        serde_json::Value::Number(n) => n.to_string(),
        serde_json::Value::Object(_) | serde_json::Value::Array(_) => {
          serde_json::to_string(v).unwrap_or_default()
        }
        _ => continue,
      };
      proxy_fields.push_str(&format!("\n    {k}: {val_str}"));
    }

    format!(
      "mixed-port: {http_port}\nsocks-port: {socks_port}\nallow-lan: false\nmode: global\nlog-level: warning\nproxies:\n{proxy_fields}\nproxy-groups:\n  - name: GLOBAL\n    type: select\n    proxies:\n      - \"{}\"\nrules:\n  - MATCH,GLOBAL\n",
      node.name
    )
  }

  pub async fn start_for_node(
    &self,
    node_id: &str,
    node: &NodeConfig<'_>,
  ) -> Result<GatewayInstance, String> {
    if let Some(existing) = self.get_instance(node_id) {
      return Ok(existing);
    }

    let binary = self
      .get_binary_path()
      .ok_or("Mihomo binary not found. Please install the gateway first.")?;

    let socks_port = find_free_port(17000);
    let http_port = find_free_port(socks_port + 1);

    let dir = Self::mihomo_dir();
    fs::create_dir_all(&dir).map_err(|e| format!("Failed to create mihomo dir: {e}"))?;

    let config_content = Self::generate_config(node, socks_port, http_port);

    let safe_node_id: String = node_id
      .chars()
      .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
      .collect();
    let config_path = dir.join(format!("config-{safe_node_id}.yaml"));
    fs::write(&config_path, &config_content)
      .map_err(|e| format!("Failed to write mihomo config: {e}"))?;

    let child = std::process::Command::new(&binary)
      .args([
        "-d",
        &dir.to_string_lossy(),
        "-f",
        &config_path.to_string_lossy(),
      ])
      .stdout(std::process::Stdio::null())
      .stderr(std::process::Stdio::null())
      .spawn()
      .map_err(|e| format!("Failed to spawn mihomo process: {e}"))?;

    let pid = child.id();

    let instance = GatewayInstance {
      node_id: node_id.to_string(),
      local_socks_port: socks_port,
      local_http_port: http_port,
      pid: Some(pid),
    };

    {
      let mut instances = self.instances.lock().unwrap();
      instances.insert(node_id.to_string(), instance.clone());
    }

    Ok(instance)
  }

  pub fn stop_for_node(&self, node_id: &str) -> Result<(), String> {
    let instance = {
      let mut instances = self.instances.lock().unwrap();
      instances.remove(node_id)
    };

    if let Some(inst) = instance {
      if let Some(pid) = inst.pid {
        #[cfg(unix)]
        {
          unsafe { libc::kill(pid as i32, libc::SIGTERM) };
        }
        #[cfg(windows)]
        {
          let _ = std::process::Command::new("taskkill")
            .args(["/PID", &pid.to_string(), "/F"])
            .output();
        }
      }

      let safe_node_id: String = node_id
        .chars()
        .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '_' })
        .collect();
      let config_path = Self::mihomo_dir().join(format!("config-{safe_node_id}.yaml"));
      let _ = fs::remove_file(&config_path);
    }

    Ok(())
  }

  #[allow(dead_code)]
  pub fn stop_all(&self) {
    let node_ids: Vec<String> = {
      let instances = self.instances.lock().unwrap();
      instances.keys().cloned().collect()
    };
    for node_id in node_ids {
      let _ = self.stop_for_node(&node_id);
    }
  }

  pub fn get_instance(&self, node_id: &str) -> Option<GatewayInstance> {
    let instances = self.instances.lock().unwrap();
    instances.get(node_id).cloned()
  }
}

fn find_free_port(start: u16) -> u16 {
  (start..start + 1000)
    .find(|&port| std::net::TcpListener::bind(("127.0.0.1", port)).is_ok())
    .unwrap_or(start)
}

lazy_static::lazy_static! {
  static ref MIHOMO_MANAGER: MihomoManager = MihomoManager::new();
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_find_free_port() {
    let port = find_free_port(19000);
    assert!(port >= 19000);
    assert!(std::net::TcpListener::bind(("127.0.0.1", port)).is_ok());
  }

  #[test]
  fn test_generate_config() {
    let extra = HashMap::new();
    let node = NodeConfig {
      name: "test-node",
      server: "1.2.3.4",
      port: 1234,
      protocol: "vless",
      password: Some("secret"),
      extra: &extra,
    };
    let config = MihomoManager::generate_config(&node, 17000, 17001);
    assert!(config.contains("mixed-port: 17001"));
    assert!(config.contains("socks-port: 17000"));
    assert!(config.contains("type: vless"));
    assert!(config.contains("server: 1.2.3.4"));
    assert!(config.contains("port: 1234"));
    assert!(config.contains("password: \"secret\""));
    assert!(config.contains("MATCH,GLOBAL"));
  }

  #[test]
  fn test_gateway_status_not_installed() {
    let manager = MihomoManager::new();
    let status = manager.get_status();
    assert_eq!(status.running_instances, 0);
  }

  #[test]
  fn test_detect_platform() {
    let platform = MihomoManager::detect_platform();
    assert!(platform.is_ok());
    let p = platform.unwrap();
    assert!(
      p.contains("darwin") || p.contains("linux") || p.contains("windows"),
      "unexpected platform: {p}"
    );
    assert!(p.contains("amd64") || p.contains("arm64"), "unexpected arch in: {p}");
  }
}
