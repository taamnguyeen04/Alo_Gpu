use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct Secret {
    pub name: String,
    pub created_at: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SecretKeyValue {
    pub key: String,
    pub value: String,
}

/// List all Modal secrets
#[tauri::command]
pub async fn list_secrets(profile: Option<String>) -> Result<Vec<Secret>, String> {
    let mut cmd = crate::utils::create_command("modal");
    cmd.args(["secret", "list", "--json"]);

    // Modal CLI uses MODAL_PROFILE env var to switch workspace
    if let Some(ref p) = profile {
        cmd.env("MODAL_PROFILE", p);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute modal: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        return Err(format!("modal secret list failed: {}", stderr));
    }

    let parsed: Vec<serde_json::Value> = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse modal output: {}", e))?;

    let mut secrets = Vec::new();
    for item in parsed {
        let name = item["name"].as_str().or(item["Name"].as_str()).unwrap_or("").to_string();
        let created_at = item["created_at"].as_str().or(item["Created at"].as_str()).map(|s| s.to_string());

        if !name.is_empty() {
            secrets.push(Secret {
                name,
                created_at,
            });
        }
    }

    Ok(secrets)
}

/// Create a new secret
#[tauri::command]
pub async fn create_secret(
    name: String,
    keyvalues: Vec<SecretKeyValue>,
) -> Result<(), String> {
    let mut args = vec!["secret".to_string(), "create".to_string(), name];

    for kv in keyvalues {
        args.push(format!("{}={}", kv.key, kv.value));
    }

    let output = crate::utils::create_command("modal")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute modal: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to create secret: {}", stderr));
    }

    Ok(())
}

/// Delete a secret
#[tauri::command]
pub async fn delete_secret(name: String) -> Result<(), String> {
    let output = crate::utils::create_command("modal")
        .args(["secret", "delete", &name])
        .output()
        .map_err(|e| format!("Failed to execute modal: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to delete secret: {}", stderr));
    }

    Ok(())
}
