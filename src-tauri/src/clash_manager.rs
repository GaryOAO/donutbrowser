use reqwest::header::{HeaderMap, HeaderValue, AUTHORIZATION};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ApiError {
  pub code: String,
  pub message: String,
  #[serde(skip_serializing_if = "Option::is_none")]
  pub details: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClashProxyNode {
  pub name: String,
  #[serde(rename = "type")]
  pub node_type: String,
  #[serde(default)]
  pub history: Vec<ClashDelayRecord>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClashDelayRecord {
  pub delay: i64,
  pub time: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClashProxyGroup {
  pub name: String,
  #[serde(rename = "type")]
  pub group_type: String,
  #[serde(default)]
  pub now: Option<String>,
  #[serde(default)]
  pub all: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClashSubscriptionStatus {
  pub provider: String,
  pub vehicle_type: String,
  pub updated_at: Option<String>,
}

#[derive(Debug, Deserialize)]
struct ClashProxiesResponse {
  proxies: std::collections::HashMap<String, ClashProxyGroup>,
}

#[derive(Debug, Deserialize)]
struct ClashProvidersResponse {
  providers: std::collections::HashMap<String, ClashProviderDetail>,
}

#[derive(Debug, Deserialize)]
struct ClashProviderDetail {
  #[serde(rename = "vehicleType")]
  vehicle_type: Option<String>,
  updated_at: Option<String>,
}

pub struct ClashManager;

impl ClashManager {
  fn client(secret: Option<&str>) -> Result<reqwest::Client, ApiError> {
    let mut headers = HeaderMap::new();
    if let Some(s) = secret {
      if !s.trim().is_empty() {
        let value = format!("Bearer {s}");
        let hv = HeaderValue::from_str(&value).map_err(|e| ApiError {
          code: "CLASH_INVALID_SECRET".to_string(),
          message: "Invalid Clash secret".to_string(),
          details: Some(e.to_string()),
        })?;
        headers.insert(AUTHORIZATION, hv);
      }
    }

    reqwest::Client::builder()
      .default_headers(headers)
      .timeout(std::time::Duration::from_secs(10))
      .build()
      .map_err(|e| ApiError {
        code: "CLASH_CLIENT_BUILD_FAILED".to_string(),
        message: "Failed to initialize Clash HTTP client".to_string(),
        details: Some(e.to_string()),
      })
  }

  pub async fn list_groups(
    base_url: &str,
    secret: Option<&str>,
  ) -> Result<Vec<ClashProxyGroup>, ApiError> {
    let client = Self::client(secret)?;
    let url = format!("{}/proxies", base_url.trim_end_matches('/'));
    let response = client.get(url).send().await.map_err(|e| ApiError {
      code: "CLASH_NETWORK_ERROR".to_string(),
      message: "Failed to request Clash proxy groups".to_string(),
      details: Some(e.to_string()),
    })?;
    let response = response.error_for_status().map_err(|e| ApiError {
      code: "CLASH_HTTP_ERROR".to_string(),
      message: "Clash returned an error while listing proxy groups".to_string(),
      details: Some(e.to_string()),
    })?;
    let payload: ClashProxiesResponse = response.json().await.map_err(|e| ApiError {
      code: "CLASH_PARSE_ERROR".to_string(),
      message: "Failed to parse Clash proxy groups response".to_string(),
      details: Some(e.to_string()),
    })?;
    Ok(payload.proxies.into_values().collect())
  }

  pub async fn switch_proxy(
    base_url: &str,
    secret: Option<&str>,
    group: &str,
    node: &str,
  ) -> Result<(), ApiError> {
    let client = Self::client(secret)?;
    let url = format!(
      "{}/proxies/{}",
      base_url.trim_end_matches('/'),
      urlencoding::encode(group)
    );
    let body = serde_json::json!({"name": node});
    client
      .put(url)
      .json(&body)
      .send()
      .await
      .map_err(|e| ApiError {
        code: "CLASH_NETWORK_ERROR".to_string(),
        message: "Failed to switch Clash proxy".to_string(),
        details: Some(e.to_string()),
      })?
      .error_for_status()
      .map_err(|e| ApiError {
        code: "CLASH_HTTP_ERROR".to_string(),
        message: "Clash returned an error while switching proxy".to_string(),
        details: Some(e.to_string()),
      })?;
    Ok(())
  }

  pub async fn test_latency(
    base_url: &str,
    secret: Option<&str>,
    proxy: &str,
    test_url: &str,
    timeout_ms: u64,
  ) -> Result<i64, ApiError> {
    let client = Self::client(secret)?;
    let url = format!(
      "{}/proxies/{}/delay?url={}&timeout={}",
      base_url.trim_end_matches('/'),
      urlencoding::encode(proxy),
      urlencoding::encode(test_url),
      timeout_ms
    );
    let response = client
      .get(url)
      .send()
      .await
      .map_err(|e| ApiError {
        code: "CLASH_NETWORK_ERROR".to_string(),
        message: "Failed to test Clash proxy latency".to_string(),
        details: Some(e.to_string()),
      })?
      .error_for_status()
      .map_err(|e| ApiError {
        code: "CLASH_HTTP_ERROR".to_string(),
        message: "Clash returned an error while testing latency".to_string(),
        details: Some(e.to_string()),
      })?;
    let value: serde_json::Value = response.json().await.map_err(|e| ApiError {
      code: "CLASH_PARSE_ERROR".to_string(),
      message: "Failed to parse Clash latency response".to_string(),
      details: Some(e.to_string()),
    })?;
    let delay = value
      .get("delay")
      .and_then(|v| v.as_i64())
      .ok_or(ApiError {
        code: "CLASH_INVALID_RESPONSE".to_string(),
        message: "Missing delay field in Clash response".to_string(),
        details: Some(value.to_string()),
      })?;
    Ok(delay)
  }

  pub async fn subscription_status(
    base_url: &str,
    secret: Option<&str>,
  ) -> Result<Vec<ClashSubscriptionStatus>, ApiError> {
    let client = Self::client(secret)?;
    let url = format!("{}/providers/proxies", base_url.trim_end_matches('/'));
    let response = client
      .get(url)
      .send()
      .await
      .map_err(|e| ApiError {
        code: "CLASH_NETWORK_ERROR".to_string(),
        message: "Failed to query Clash subscription status".to_string(),
        details: Some(e.to_string()),
      })?
      .error_for_status()
      .map_err(|e| ApiError {
        code: "CLASH_HTTP_ERROR".to_string(),
        message: "Clash returned an error while querying subscription status".to_string(),
        details: Some(e.to_string()),
      })?;
    let payload: ClashProvidersResponse = response.json().await.map_err(|e| ApiError {
      code: "CLASH_PARSE_ERROR".to_string(),
      message: "Failed to parse Clash providers response".to_string(),
      details: Some(e.to_string()),
    })?;
    Ok(
      payload
        .providers
        .into_iter()
        .map(|(provider, v)| ClashSubscriptionStatus {
          provider,
          vehicle_type: v.vehicle_type.unwrap_or_else(|| "unknown".to_string()),
          updated_at: v.updated_at,
        })
        .collect(),
    )
  }
}
