use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use crate::browser::ProxySettings;
use crate::events;
use crate::proxy_manager::{StoredProxy, PROXY_MANAGER};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PoolNodeProtocol {
  Http,
  Https,
  Socks5,
  Socks4,
  Ss,
  Vmess,
  Vless,
  Trojan,
  Hysteria,
  Hysteria2,
  Tuic,
  Unknown,
}

impl PoolNodeProtocol {
  pub fn from_clash_type(t: &str) -> Self {
    match t.to_lowercase().as_str() {
      "http" => Self::Http,
      "https" => Self::Https,
      "socks5" => Self::Socks5,
      "socks4" => Self::Socks4,
      "ss" | "shadowsocks" => Self::Ss,
      "vmess" => Self::Vmess,
      "vless" => Self::Vless,
      "trojan" => Self::Trojan,
      "hysteria" => Self::Hysteria,
      "hysteria2" => Self::Hysteria2,
      "tuic" => Self::Tuic,
      _ => Self::Unknown,
    }
  }

  pub fn is_natively_supported(&self) -> bool {
    matches!(
      self,
      Self::Http | Self::Https | Self::Socks5 | Self::Socks4 | Self::Ss
    )
  }

  pub fn to_proxy_type_str(&self) -> &'static str {
    match self {
      Self::Http => "http",
      Self::Https => "https",
      Self::Socks5 => "socks5",
      Self::Socks4 => "socks4",
      Self::Ss => "ss",
      _ => "socks5",
    }
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolNode {
  pub id: String,
  pub subscription_id: String,
  pub name: String,
  pub protocol: PoolNodeProtocol,
  pub server: String,
  pub port: u16,
  #[serde(default)]
  pub username: Option<String>,
  #[serde(default)]
  pub password: Option<String>,
  #[serde(default)]
  pub extra: HashMap<String, serde_json::Value>,
  #[serde(default)]
  pub stored_proxy_id: Option<String>,
  #[serde(default)]
  pub last_latency_ms: Option<u64>,
  #[serde(default)]
  pub available: Option<bool>,
}

impl PoolNode {
  pub fn has_unsupported_plugin(&self) -> bool {
    self
      .extra
      .get("plugin")
      .and_then(|v| v.as_str())
      .is_some_and(|p| !p.is_empty())
  }

  pub fn is_importable(&self) -> bool {
    self.protocol.is_natively_supported() && !self.has_unsupported_plugin()
  }

  pub fn to_proxy_settings(&self) -> Option<ProxySettings> {
    if !self.is_importable() {
      return None;
    }

    let (username, password) = if self.protocol == PoolNodeProtocol::Ss {
      let cipher = self
        .extra
        .get("cipher")
        .and_then(|v| v.as_str())
        .unwrap_or("aes-256-gcm")
        .to_string();
      (Some(cipher), self.password.clone())
    } else {
      (self.username.clone(), self.password.clone())
    };

    Some(ProxySettings {
      proxy_type: self.protocol.to_proxy_type_str().to_string(),
      host: self.server.clone(),
      port: self.port,
      username,
      password,
    })
  }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Subscription {
  pub id: String,
  pub name: String,
  pub url: String,
  pub node_count: usize,
  pub created_at: u64,
  pub updated_at: u64,
  #[serde(default)]
  pub last_fetch_error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct SubscriptionStore {
  subscriptions: Vec<Subscription>,
  nodes: Vec<PoolNode>,
}

fn now_secs() -> u64 {
  SystemTime::now()
    .duration_since(UNIX_EPOCH)
    .unwrap_or_default()
    .as_secs()
}

fn store_file() -> std::path::PathBuf {
  crate::app_dirs::data_subdir().join("subscription_pool.json")
}

pub struct SubscriptionPoolManager {
  subscriptions: Mutex<Vec<Subscription>>,
  nodes: Mutex<Vec<PoolNode>>,
}

impl SubscriptionPoolManager {
  pub fn instance() -> &'static SubscriptionPoolManager {
    &SUBSCRIPTION_POOL
  }

  fn load_from_disk() -> SubscriptionStore {
    let path = store_file();
    if !path.exists() {
      return SubscriptionStore {
        subscriptions: Vec::new(),
        nodes: Vec::new(),
      };
    }
    match fs::read_to_string(&path) {
      Ok(data) => serde_json::from_str(&data).unwrap_or(SubscriptionStore {
        subscriptions: Vec::new(),
        nodes: Vec::new(),
      }),
      Err(_) => SubscriptionStore {
        subscriptions: Vec::new(),
        nodes: Vec::new(),
      },
    }
  }

  fn save_to_disk(&self) -> Result<(), String> {
    let path = store_file();
    if let Some(parent) = path.parent() {
      fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let store = SubscriptionStore {
      subscriptions: self.subscriptions.lock().unwrap().clone(),
      nodes: self.nodes.lock().unwrap().clone(),
    };
    let data = serde_json::to_string_pretty(&store).map_err(|e| e.to_string())?;
    fs::write(&path, data).map_err(|e| e.to_string())?;
    Ok(())
  }

  pub fn list_subscriptions(&self) -> Vec<Subscription> {
    self.subscriptions.lock().unwrap().clone()
  }

  pub fn list_nodes(&self, subscription_id: Option<&str>) -> Vec<PoolNode> {
    let nodes = self.nodes.lock().unwrap();
    match subscription_id {
      Some(id) => nodes
        .iter()
        .filter(|n| n.subscription_id == id)
        .cloned()
        .collect(),
      None => nodes.clone(),
    }
  }

  #[allow(dead_code)]
  pub fn get_node(&self, node_id: &str) -> Option<PoolNode> {
    self
      .nodes
      .lock()
      .unwrap()
      .iter()
      .find(|n| n.id == node_id)
      .cloned()
  }

  pub async fn add_subscription(&self, name: String, url: String) -> Result<Subscription, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = now_secs();

    let nodes = fetch_and_parse_subscription(&url, &id).await?;
    let node_count = nodes.len();

    let sub = Subscription {
      id: id.clone(),
      name,
      url,
      node_count,
      created_at: now,
      updated_at: now,
      last_fetch_error: None,
    };

    {
      let mut subs = self.subscriptions.lock().unwrap();
      subs.push(sub.clone());
    }
    {
      let mut all_nodes = self.nodes.lock().unwrap();
      all_nodes.extend(nodes);
    }

    self.save_to_disk()?;
    let _ = events::emit("subscription-pool-changed", ());
    Ok(sub)
  }

  pub async fn refresh_subscription(&self, subscription_id: &str) -> Result<Subscription, String> {
    let url = {
      let subs = self.subscriptions.lock().unwrap();
      subs
        .iter()
        .find(|s| s.id == subscription_id)
        .map(|s| s.url.clone())
        .ok_or_else(|| "Subscription not found".to_string())?
    };

    let result = fetch_and_parse_subscription(&url, subscription_id).await;

    match result {
      Ok(new_nodes) => {
        let node_count = new_nodes.len();
        {
          let mut nodes = self.nodes.lock().unwrap();
          nodes.retain(|n| n.subscription_id != subscription_id);
          nodes.extend(new_nodes);
        }
        let sub = {
          let mut subs = self.subscriptions.lock().unwrap();
          let sub = subs
            .iter_mut()
            .find(|s| s.id == subscription_id)
            .ok_or_else(|| "Subscription not found".to_string())?;
          sub.node_count = node_count;
          sub.updated_at = now_secs();
          sub.last_fetch_error = None;
          sub.clone()
        };
        self.save_to_disk()?;
        let _ = events::emit("subscription-pool-changed", ());
        Ok(sub)
      }
      Err(e) => {
        {
          let mut subs = self.subscriptions.lock().unwrap();
          if let Some(sub) = subs.iter_mut().find(|s| s.id == subscription_id) {
            sub.last_fetch_error = Some(e.clone());
          }
        }
        let _ = self.save_to_disk();
        Err(e)
      }
    }
  }

  pub fn delete_subscription(&self, subscription_id: &str) -> Result<(), String> {
    {
      let mut subs = self.subscriptions.lock().unwrap();
      let len_before = subs.len();
      subs.retain(|s| s.id != subscription_id);
      if subs.len() == len_before {
        return Err("Subscription not found".to_string());
      }
    }
    {
      let mut nodes = self.nodes.lock().unwrap();
      nodes.retain(|n| n.subscription_id != subscription_id);
    }
    self.save_to_disk()?;
    let _ = events::emit("subscription-pool-changed", ());
    Ok(())
  }

  pub fn import_node_as_proxy(&self, node_id: &str) -> Result<StoredProxy, String> {
    let node = {
      let nodes = self.nodes.lock().unwrap();
      nodes
        .iter()
        .find(|n| n.id == node_id)
        .cloned()
        .ok_or_else(|| "Node not found".to_string())?
    };

    let proxy_settings = node.to_proxy_settings().ok_or_else(|| {
      format!(
        "Protocol {:?} requires external proxy gateway (mihomo/sing-box)",
        node.protocol
      )
    })?;

    let stored = StoredProxy::new(node.name.clone(), proxy_settings);
    let stored_id = stored.id.clone();
    PROXY_MANAGER.add_stored_proxy(stored.clone())?;

    {
      let mut nodes = self.nodes.lock().unwrap();
      if let Some(n) = nodes.iter_mut().find(|n| n.id == node_id) {
        n.stored_proxy_id = Some(stored_id);
      }
    }
    let _ = self.save_to_disk();
    let _ = events::emit("subscription-pool-changed", ());
    Ok(stored)
  }

  pub fn import_all_supported_nodes(&self, subscription_id: &str) -> Result<Vec<String>, String> {
    let supported_nodes: Vec<PoolNode> = {
      let nodes = self.nodes.lock().unwrap();
      nodes
        .iter()
        .filter(|n| {
          n.subscription_id == subscription_id && n.is_importable() && n.stored_proxy_id.is_none()
        })
        .cloned()
        .collect()
    };

    let mut imported_ids = Vec::new();
    for node in &supported_nodes {
      if let Some(settings) = node.to_proxy_settings() {
        let stored = StoredProxy::new(node.name.clone(), settings);
        let stored_id = stored.id.clone();
        if PROXY_MANAGER.add_stored_proxy(stored).is_ok() {
          imported_ids.push(stored_id.clone());
          let mut nodes = self.nodes.lock().unwrap();
          if let Some(n) = nodes.iter_mut().find(|n| n.id == node.id) {
            n.stored_proxy_id = Some(stored_id);
          }
        }
      }
    }

    let _ = self.save_to_disk();
    let _ = events::emit("subscription-pool-changed", ());
    let _ = events::emit("proxies-changed", ());
    Ok(imported_ids)
  }

  pub async fn test_node_latency(&self, node_id: &str) -> Result<u64, String> {
    let node = {
      let nodes = self.nodes.lock().unwrap();
      nodes
        .iter()
        .find(|n| n.id == node_id)
        .cloned()
        .ok_or_else(|| "Node not found".to_string())?
    };

    let start = std::time::Instant::now();
    let addr = format!("{}:{}", node.server, node.port);

    let result = tokio::time::timeout(
      std::time::Duration::from_secs(10),
      tokio::net::TcpStream::connect(&addr),
    )
    .await;

    match result {
      Ok(Ok(stream)) => {
        drop(stream);
        let latency = start.elapsed().as_millis() as u64;
        {
          let mut nodes = self.nodes.lock().unwrap();
          if let Some(n) = nodes.iter_mut().find(|n| n.id == node_id) {
            n.last_latency_ms = Some(latency);
            n.available = Some(true);
          }
        }
        let _ = self.save_to_disk();
        let _ = events::emit("subscription-pool-changed", ());
        Ok(latency)
      }
      Ok(Err(e)) => {
        {
          let mut nodes = self.nodes.lock().unwrap();
          if let Some(n) = nodes.iter_mut().find(|n| n.id == node_id) {
            n.available = Some(false);
          }
        }
        let _ = self.save_to_disk();
        let _ = events::emit("subscription-pool-changed", ());
        Err(format!("TCP connect to {addr} failed: {e}"))
      }
      Err(_) => {
        {
          let mut nodes = self.nodes.lock().unwrap();
          if let Some(n) = nodes.iter_mut().find(|n| n.id == node_id) {
            n.available = Some(false);
          }
        }
        let _ = self.save_to_disk();
        let _ = events::emit("subscription-pool-changed", ());
        Err(format!("Connection to {addr} timed out"))
      }
    }
  }

  pub async fn test_all_nodes_in_subscription(
    &self,
    subscription_id: &str,
  ) -> Result<(usize, usize), String> {
    let targets: Vec<(String, String)> = {
      let nodes = self.nodes.lock().unwrap();
      nodes
        .iter()
        .filter(|n| n.subscription_id == subscription_id)
        .map(|n| (n.id.clone(), format!("{}:{}", n.server, n.port)))
        .collect()
    };

    let handles: Vec<_> = targets
      .into_iter()
      .map(|(id, addr)| {
        tokio::spawn(async move {
          let start = std::time::Instant::now();
          let result = tokio::time::timeout(
            std::time::Duration::from_secs(10),
            tokio::net::TcpStream::connect(&addr),
          )
          .await;
          match result {
            Ok(Ok(stream)) => {
              drop(stream);
              (id, true, Some(start.elapsed().as_millis() as u64))
            }
            _ => (id, false, None),
          }
        })
      })
      .collect();

    let mut success = 0;
    let mut fail = 0;

    for handle in handles {
      if let Ok((id, available, latency)) = handle.await {
        if available {
          success += 1;
        } else {
          fail += 1;
        }
        let mut nodes = self.nodes.lock().unwrap();
        if let Some(n) = nodes.iter_mut().find(|n| n.id == id) {
          n.available = Some(available);
          if let Some(ms) = latency {
            n.last_latency_ms = Some(ms);
          }
        }
      }
    }

    let _ = self.save_to_disk();
    let _ = events::emit("subscription-pool-changed", ());
    Ok((success, fail))
  }
}

lazy_static::lazy_static! {
  static ref SUBSCRIPTION_POOL: SubscriptionPoolManager = {
    let store = SubscriptionPoolManager::load_from_disk();
    SubscriptionPoolManager {
      subscriptions: Mutex::new(store.subscriptions),
      nodes: Mutex::new(store.nodes),
    }
  };
}

async fn fetch_and_parse_subscription(
  url: &str,
  subscription_id: &str,
) -> Result<Vec<PoolNode>, String> {
  let client = reqwest::Client::builder()
    .timeout(std::time::Duration::from_secs(30))
    .user_agent("ClashForAndroid/2.5.12")
    .build()
    .map_err(|e| format!("HTTP client error: {e}"))?;

  let response = client
    .get(url)
    .send()
    .await
    .map_err(|e| format!("Failed to fetch subscription: {e}"))?;

  if !response.status().is_success() {
    return Err(format!("Subscription returned HTTP {}", response.status()));
  }

  let body = response
    .text()
    .await
    .map_err(|e| format!("Failed to read response: {e}"))?;

  // Try parsing as Clash YAML first
  if let Ok(nodes) = parse_clash_yaml(&body, subscription_id) {
    if !nodes.is_empty() {
      return Ok(nodes);
    }
  }

  // Try base64-decoded content (common for V2Ray subscriptions)
  if let Ok(decoded) = base64_decode_subscription(&body) {
    if let Ok(nodes) = parse_clash_yaml(&decoded, subscription_id) {
      if !nodes.is_empty() {
        return Ok(nodes);
      }
    }
    // Could be line-based URI format (ss://, vmess://, etc.)
    let nodes = parse_uri_lines(&decoded, subscription_id);
    if !nodes.is_empty() {
      return Ok(nodes);
    }
  }

  Err("Failed to parse subscription: unrecognized format".to_string())
}

fn base64_decode_subscription(input: &str) -> Result<String, String> {
  use base64::Engine;
  let trimmed = input.trim();
  // Try standard base64
  if let Ok(bytes) = base64::engine::general_purpose::STANDARD.decode(trimmed) {
    if let Ok(s) = String::from_utf8(bytes) {
      return Ok(s);
    }
  }
  // Try URL-safe base64
  if let Ok(bytes) = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(trimmed) {
    if let Ok(s) = String::from_utf8(bytes) {
      return Ok(s);
    }
  }
  Err("Not valid base64".to_string())
}

fn parse_clash_yaml(content: &str, subscription_id: &str) -> Result<Vec<PoolNode>, String> {
  let yaml: serde_yaml::Value =
    serde_yaml::from_str(content).map_err(|e| format!("YAML parse error: {e}"))?;

  let proxies = yaml
    .get("proxies")
    .and_then(|v| v.as_sequence())
    .ok_or_else(|| "No 'proxies' array found in YAML".to_string())?;

  let mut nodes = Vec::new();
  for proxy in proxies {
    if let Some(node) = parse_clash_proxy_entry(proxy, subscription_id) {
      nodes.push(node);
    }
  }

  Ok(nodes)
}

fn parse_clash_proxy_entry(value: &serde_yaml::Value, subscription_id: &str) -> Option<PoolNode> {
  let map = value.as_mapping()?;

  let name = map
    .get(serde_yaml::Value::String("name".to_string()))?
    .as_str()?
    .to_string();

  let proxy_type = map
    .get(serde_yaml::Value::String("type".to_string()))?
    .as_str()?;

  let server = map
    .get(serde_yaml::Value::String("server".to_string()))?
    .as_str()?
    .to_string();

  let port = map
    .get(serde_yaml::Value::String("port".to_string()))?
    .as_u64()? as u16;

  let protocol = PoolNodeProtocol::from_clash_type(proxy_type);

  let username = map
    .get(serde_yaml::Value::String("username".to_string()))
    .and_then(|v| v.as_str())
    .map(|s| s.to_string());

  let password = map
    .get(serde_yaml::Value::String("password".to_string()))
    .and_then(|v| v.as_str())
    .map(|s| s.to_string());

  // Store all extra fields for protocol-specific config
  let mut extra = HashMap::new();
  for (key, val) in map.iter() {
    let key_str = key.as_str().unwrap_or_default();
    if matches!(
      key_str,
      "name" | "type" | "server" | "port" | "username" | "password"
    ) {
      continue;
    }
    if let Ok(json_val) = serde_json::to_value(val) {
      extra.insert(key_str.to_string(), json_val);
    }
  }

  Some(PoolNode {
    id: uuid::Uuid::new_v4().to_string(),
    subscription_id: subscription_id.to_string(),
    name,
    protocol,
    server,
    port,
    username,
    password,
    extra,
    stored_proxy_id: None,
    last_latency_ms: None,
    available: None,
  })
}

fn parse_uri_lines(content: &str, subscription_id: &str) -> Vec<PoolNode> {
  content
    .lines()
    .filter_map(|line| {
      let line = line.trim();
      if line.is_empty() {
        return None;
      }
      parse_proxy_uri(line, subscription_id)
    })
    .collect()
}

fn parse_proxy_uri(uri: &str, subscription_id: &str) -> Option<PoolNode> {
  let (scheme, rest) = uri.split_once("://")?;
  let protocol = PoolNodeProtocol::from_clash_type(scheme);

  match protocol {
    PoolNodeProtocol::Ss => parse_ss_uri(rest, subscription_id),
    PoolNodeProtocol::Trojan => parse_trojan_uri(rest, subscription_id),
    _ => {
      // For vmess:// and other URIs, store raw
      Some(PoolNode {
        id: uuid::Uuid::new_v4().to_string(),
        subscription_id: subscription_id.to_string(),
        name: uri.chars().take(50).collect(),
        protocol,
        server: "unknown".to_string(),
        port: 0,
        username: None,
        password: None,
        extra: {
          let mut m = HashMap::new();
          m.insert(
            "raw_uri".to_string(),
            serde_json::Value::String(uri.to_string()),
          );
          m
        },
        stored_proxy_id: None,
        last_latency_ms: None,
        available: None,
      })
    }
  }
}

fn parse_ss_uri(rest: &str, subscription_id: &str) -> Option<PoolNode> {
  use base64::Engine;

  // ss://base64(method:password)@host:port#name
  // or ss://base64(method:password@host:port)#name
  let (main, name) = rest.split_once('#').unwrap_or((rest, "SS Node"));
  let name = urlencoding::decode(name)
    .unwrap_or_else(|_| name.into())
    .to_string();

  if let Some((encoded, server_part)) = main.split_once('@') {
    // Format: base64(method:password)@host:port
    let decoded = base64::engine::general_purpose::STANDARD
      .decode(encoded)
      .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(encoded))
      .ok()?;
    let decoded = String::from_utf8(decoded).ok()?;
    let (method, password) = decoded.split_once(':')?;

    let (host, port_str) = server_part.rsplit_once(':')?;
    let port: u16 = port_str.parse().ok()?;

    let mut extra = HashMap::new();
    extra.insert(
      "method".to_string(),
      serde_json::Value::String(method.to_string()),
    );

    Some(PoolNode {
      id: uuid::Uuid::new_v4().to_string(),
      subscription_id: subscription_id.to_string(),
      name,
      protocol: PoolNodeProtocol::Ss,
      server: host.to_string(),
      port,
      username: None,
      password: Some(password.to_string()),
      extra,
      stored_proxy_id: None,
      last_latency_ms: None,
      available: None,
    })
  } else {
    // Entire thing is base64
    let decoded = base64::engine::general_purpose::STANDARD
      .decode(main)
      .or_else(|_| base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(main))
      .ok()?;
    let decoded = String::from_utf8(decoded).ok()?;
    // method:password@host:port
    let (method_pass, server_part) = decoded.split_once('@')?;
    let (method, password) = method_pass.split_once(':')?;
    let (host, port_str) = server_part.rsplit_once(':')?;
    let port: u16 = port_str.parse().ok()?;

    let mut extra = HashMap::new();
    extra.insert(
      "method".to_string(),
      serde_json::Value::String(method.to_string()),
    );

    Some(PoolNode {
      id: uuid::Uuid::new_v4().to_string(),
      subscription_id: subscription_id.to_string(),
      name,
      protocol: PoolNodeProtocol::Ss,
      server: host.to_string(),
      port,
      username: None,
      password: Some(password.to_string()),
      extra,
      stored_proxy_id: None,
      last_latency_ms: None,
      available: None,
    })
  }
}

fn parse_trojan_uri(rest: &str, subscription_id: &str) -> Option<PoolNode> {
  // trojan://password@host:port?params#name
  let (main, name) = rest.split_once('#').unwrap_or((rest, "Trojan Node"));
  let name = urlencoding::decode(name)
    .unwrap_or_else(|_| name.into())
    .to_string();

  let (password_part, server_part) = main.split_once('@')?;
  let password = urlencoding::decode(password_part)
    .unwrap_or_else(|_| password_part.into())
    .to_string();

  // Remove query params
  let server_part = server_part.split('?').next().unwrap_or(server_part);
  let (host, port_str) = server_part.rsplit_once(':')?;
  let port: u16 = port_str.parse().ok()?;

  Some(PoolNode {
    id: uuid::Uuid::new_v4().to_string(),
    subscription_id: subscription_id.to_string(),
    name,
    protocol: PoolNodeProtocol::Trojan,
    server: host.to_string(),
    port,
    username: None,
    password: Some(password),
    extra: HashMap::new(),
    stored_proxy_id: None,
    last_latency_ms: None,
    available: None,
  })
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn test_parse_clash_yaml_basic() {
    let yaml = r#"
proxies:
  - name: "US Node 1"
    type: ss
    server: us1.example.com
    port: 8388
    password: secret123
    cipher: aes-256-gcm
  - name: "JP SOCKS5"
    type: socks5
    server: jp.example.com
    port: 1080
    username: user
    password: pass
  - name: "HK VMess"
    type: vmess
    server: hk.example.com
    port: 443
    uuid: test-uuid
    alterId: 0
    cipher: auto
"#;

    let nodes = parse_clash_yaml(yaml, "test-sub").unwrap();
    assert_eq!(nodes.len(), 3);

    assert_eq!(nodes[0].name, "US Node 1");
    assert_eq!(nodes[0].protocol, PoolNodeProtocol::Ss);
    assert!(nodes[0].protocol.is_natively_supported());
    assert!(nodes[0].to_proxy_settings().is_some());

    assert_eq!(nodes[1].name, "JP SOCKS5");
    assert_eq!(nodes[1].protocol, PoolNodeProtocol::Socks5);
    assert_eq!(nodes[1].username.as_deref(), Some("user"));

    assert_eq!(nodes[2].name, "HK VMess");
    assert_eq!(nodes[2].protocol, PoolNodeProtocol::Vmess);
    assert!(!nodes[2].protocol.is_natively_supported());
    assert!(nodes[2].to_proxy_settings().is_none());
  }

  #[test]
  fn test_parse_ss_uri() {
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode("aes-256-gcm:password123");
    let uri = format!("{}@server.com:8388", encoded);
    let node = parse_ss_uri(&format!("{}#TestNode", uri), "sub1").unwrap();
    assert_eq!(node.name, "TestNode");
    assert_eq!(node.server, "server.com");
    assert_eq!(node.port, 8388);
    assert_eq!(node.password.as_deref(), Some("password123"));
  }

  #[test]
  fn test_parse_trojan_uri() {
    let node =
      parse_trojan_uri("mypassword@server.com:443?sni=example.com#MyNode", "sub1").unwrap();
    assert_eq!(node.name, "MyNode");
    assert_eq!(node.server, "server.com");
    assert_eq!(node.port, 443);
    assert_eq!(node.password.as_deref(), Some("mypassword"));
    assert_eq!(node.protocol, PoolNodeProtocol::Trojan);
  }

  #[test]
  fn test_protocol_classification() {
    assert!(PoolNodeProtocol::Http.is_natively_supported());
    assert!(PoolNodeProtocol::Socks5.is_natively_supported());
    assert!(PoolNodeProtocol::Ss.is_natively_supported());
    assert!(!PoolNodeProtocol::Vmess.is_natively_supported());
    assert!(!PoolNodeProtocol::Trojan.is_natively_supported());
    assert!(!PoolNodeProtocol::Vless.is_natively_supported());
  }
}
