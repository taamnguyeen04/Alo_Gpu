use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct App {
    pub name: String,
    pub status: String,
    pub created_at: String,
}

/// List all Modal apps
#[tauri::command]
pub async fn list_apps(profile: Option<String>) -> Result<Vec<App>, String> {
    let mut cmd = crate::utils::create_command("modal");
    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.args(["app", "list", "--json"]);

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
        return Err(format!("modal app list failed: {}", stderr));
    }

    let parsed: Vec<serde_json::Value> = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse modal output: {}", e))?;

    let mut apps = Vec::new();
    for item in parsed {
        let name = item["app_id"].as_str().or(item["App ID"].as_str()).unwrap_or("").to_string();
        let status = item["state"].as_str().or(item["State"].as_str()).unwrap_or("").to_string();
        let created = item["created_at"].as_str().or(item["Created at"].as_str()).unwrap_or("").to_string();

        if !name.is_empty() {
            apps.push(App {
                name,
                status,
                created_at: created,
            });
        }
    }

    Ok(apps)
}

/// Get logs for a specific app
#[tauri::command]
pub async fn get_app_logs(app_name: String) -> Result<String, String> {
    let output = crate::utils::create_command("modal")
        .env("PYTHONIOENCODING", "utf-8")
        .args(["app", "logs", &app_name])
        .output()
        .map_err(|e| format!("Failed to execute modal: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        return Err(format!("modal app logs failed: {}", stderr));
    }

    Ok(stdout.to_string())
}

/// Stop a running Modal app
#[tauri::command]
pub async fn stop_app(app_name: String) -> Result<(), String> {
    let output = crate::utils::create_command("modal")
        .env("PYTHONIOENCODING", "utf-8")
        .args(["app", "stop", "-y", &app_name])
        .output()
        .map_err(|e| format!("Failed to execute modal: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.to_lowercase().contains("already stopped") {
            return Ok(());
        }
        return Err(format!("Failed to stop app: {}", stderr));
    }

    Ok(())
}
