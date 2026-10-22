use serde::{Deserialize, Serialize};
use std::process::Command;
use log::{info, warn, error};

#[derive(Debug, Serialize, Deserialize)]
pub struct Profile {
    pub name: String,
    pub workspace: String,
    pub is_active: bool,
}

/// List all Modal profiles
#[tauri::command]
pub async fn list_profiles() -> Result<Vec<Profile>, String> {
    info!("Running: modal profile list");

    let output = crate::utils::create_command("modal")
        .args(["profile", "list", "--json"])
        .output()
        .map_err(|e| {
            error!("Failed to execute modal: {}", e);
            format!("Failed to execute modal: {}", e)
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        return Err(format!("modal profile list failed: {}", stderr));
    }

    let parsed: Vec<serde_json::Value> = serde_json::from_str(&stdout)
        .map_err(|e| {
            error!("Failed to parse modal output: {}. Output was: {}", e, stdout);
            format!("Failed to parse modal output: {}", e)
        })?;

    let mut profiles = Vec::new();
    for item in parsed {
        let name = item["name"].as_str().unwrap_or("").to_string();
        let workspace = item["workspace"].as_str().unwrap_or("").to_string();
        let is_active = item["active"].as_bool().unwrap_or(false);

        if !name.is_empty() {
            profiles.push(Profile {
                name,
                workspace,
                is_active,
            });
        }
    }

    Ok(profiles)
}

/// Get the currently active profile
#[tauri::command]
pub async fn get_current_profile() -> Result<String, String> {
    info!("Running: modal profile current");

    let output = crate::utils::create_command("modal")
        .args(["profile", "current"])
        .output()
        .map_err(|e| {
            error!("Failed to execute modal: {}", e);
            format!("Failed to execute modal: {}", e)
        })?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    info!("modal profile current stdout: '{}'", stdout);
    info!("modal profile current stderr: '{}'", stderr);

    if !output.status.success() {
        return Err(format!("modal profile current failed: {}", stderr));
    }

    Ok(stdout.trim().to_string())
}

/// Activate a specific profile
#[tauri::command]
pub async fn activate_profile(name: String) -> Result<(), String> {
    info!("Activating profile: {}", name);

    let output = crate::utils::create_command("modal")
        .args(["profile", "activate", &name])
        .output()
        .map_err(|e| {
            error!("Failed to execute modal: {}", e);
            format!("Failed to execute modal: {}", e)
        })?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        error!("Failed to activate profile: {}", stderr);
        return Err(format!("Failed to activate profile: {}", stderr));
    }

    info!("Successfully activated profile: {}", name);
    Ok(())
}
