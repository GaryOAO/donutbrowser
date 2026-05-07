use crate::browser::ProxySettings;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "snake_case")]
pub enum NodeProtocol {
  Http,
  Https,
  Socks5,
  Socks4,
  Ss,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PoolNode {
  pub id: String,
  pub name: String,
  pub subscription_id: String,
  pub protocol: NodeProtocol,
  pub server: String,
  pub port: u16,
  #[serde(default)]
  pub username: Option<String>,
  #[serde(default)]
  pub password: Option<String>,
  #[serde(default)]
  pub stored_proxy_id: Option<String>,
  #[serde(default)]
  pub last_latency_ms: Option<u64>,
  #[serde(default)]
  pub available: bool,
}

impl PoolNode {
  pub fn to_proxy_settings(&self) -> Option<ProxySettings> {
    let proxy_type = match self.protocol {
      NodeProtocol::Http => "http",
      NodeProtocol::Https => "https",
      NodeProtocol::Socks5 => "socks5",
      NodeProtocol::Socks4 => "socks4",
      NodeProtocol::Ss => "ss",
    };
    Some(ProxySettings {
      proxy_type: proxy_type.to_string(),
      host: self.server.clone(),
      port: self.port,
      username: self.username.clone(),
      password: self.password.clone(),
    })
  }
}

pub struct SubscriptionPoolManager {
  nodes: Mutex<Vec<PoolNode>>,
}

impl SubscriptionPoolManager {
  fn new() -> Self {
    Self {
      nodes: Mutex::new(Vec::new()),
    }
  }

  pub fn instance() -> &'static SubscriptionPoolManager {
    &SUBSCRIPTION_POOL_MANAGER
  }

  pub fn get_node(&self, node_id: &str) -> Option<PoolNode> {
    let nodes = self.nodes.lock().unwrap();
    nodes.iter().find(|n| n.id == node_id).cloned()
  }

  #[allow(dead_code)]
  pub fn list_nodes(&self) -> Vec<PoolNode> {
    let nodes = self.nodes.lock().unwrap();
    nodes.clone()
  }

  #[allow(dead_code)]
  pub fn refresh_subscription(&self, subscription_id: &str, mut new_nodes: Vec<PoolNode>) {
    let mut nodes = self.nodes.lock().unwrap();

    let existing: HashMap<(String, u16, String), String> = nodes
      .iter()
      .filter(|n| n.subscription_id == subscription_id)
      .map(|n| {
        let key = (n.server.clone(), n.port, format!("{:?}", n.protocol));
        (key, n.id.clone())
      })
      .collect();

    for new_node in &mut new_nodes {
      let key = (
        new_node.server.clone(),
        new_node.port,
        format!("{:?}", new_node.protocol),
      );
      if let Some(old_id) = existing.get(&key) {
        new_node.id = old_id.clone();
        if let Some(old) = nodes.iter().find(|n| n.id == *old_id) {
          new_node.stored_proxy_id = old.stored_proxy_id.clone();
          new_node.last_latency_ms = old.last_latency_ms;
          new_node.available = old.available;
        }
      }
    }

    nodes.retain(|n| n.subscription_id != subscription_id);
    nodes.extend(new_nodes);
  }
}

lazy_static::lazy_static! {
  static ref SUBSCRIPTION_POOL_MANAGER: SubscriptionPoolManager = SubscriptionPoolManager::new();
}
