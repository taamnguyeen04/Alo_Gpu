use serde::{Deserialize, Serialize};
use std::process::Command;

#[derive(Debug, Serialize, Deserialize)]
pub struct Volume {
    pub name: String,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct FileItem {
    pub name: String,
    #[serde(rename = "type")]
    pub file_type: String,
    pub size: String,
    pub modified: String,
}

/// List all Modal volumes
#[tauri::command]
pub async fn list_volumes(profile: Option<String>) -> Result<Vec<Volume>, String> {
    let mut cmd = crate::utils::create_command("modal");
    cmd.env("PYTHONIOENCODING", "utf-8");
    cmd.args(["volume", "list", "--json"]);

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
        return Err(format!("modal volume list failed: {}", stderr));
    }

    let parsed: Vec<serde_json::Value> = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse modal output: {}", e))?;

    let mut volumes = Vec::new();
    for item in parsed {
        // Modal 1.5.4 uses snake_case, fallback to Title Case for older versions
        let name = item["name"].as_str().or(item["Name"].as_str()).unwrap_or("").to_string();
        let created = item["created_at"].as_str().or(item["Created at"].as_str()).unwrap_or("").to_string();

        if !name.is_empty() {
            volumes.push(Volume {
                name,
                created_at: created,
            });
        }
    }

    Ok(volumes)
}

/// List files in a volume
#[tauri::command]
pub async fn volume_ls(volume_name: String, path: Option<String>) -> Result<Vec<FileItem>, String> {
    let mut args = vec!["volume".to_string(), "ls".to_string(), volume_name, "--json".to_string()];

    if let Some(p) = path {
        args.push(p);
    }

    let output = crate::utils::create_command("modal")
        .env("PYTHONIOENCODING", "utf-8")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute modal: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        return Err(format!("modal volume ls failed: {}", stderr));
    }

    let parsed: Vec<serde_json::Value> = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse modal output: {}", e))?;

    let mut files = Vec::new();
    for item in parsed {
        let name = item["filename"].as_str().or(item["Filename"].as_str()).unwrap_or("").to_string();
        let file_type = item["type"].as_str().or(item["Type"].as_str()).unwrap_or("file").to_string();
        let modified = item["created_modified"].as_str().or(item["Created/Modified"].as_str()).unwrap_or("").to_string();
        let size = item["size"].as_str().or(item["Size"].as_str()).unwrap_or("").to_string();

        if !name.is_empty() {
            files.push(FileItem {
                name,
                file_type: if file_type == "dir" { "directory".to_string() } else { "file".to_string() },
                size,
                modified,
            });
        }
    }

    Ok(files)
}

/// Create a new volume
#[tauri::command]
pub async fn volume_create(name: String) -> Result<(), String> {
    let output = crate::utils::create_command("modal")
        .env("PYTHONIOENCODING", "utf-8")
        .args(["volume", "create", &name])
        .output()
        .map_err(|e| format!("Failed to execute modal: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to create volume: {}", stderr));
    }

    Ok(())
}

/// Delete a volume
#[tauri::command]
pub async fn volume_delete(name: String) -> Result<(), String> {
    let output = crate::utils::create_command("modal")
        .env("PYTHONIOENCODING", "utf-8")
        .args(["volume", "delete", &name])
        .output()
        .map_err(|e| format!("Failed to execute modal: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to delete volume: {}", stderr));
    }

    Ok(())
}

/// Upload file to volume (modal volume put)
#[tauri::command]
pub async fn volume_put(volume_name: String, local_path: String, remote_path: Option<String>) -> Result<(), String> {
    let mut args = vec!["volume".to_string(), "put".to_string(), "--force".to_string(), volume_name.clone(), local_path.clone()];

    if let Some(path) = remote_path {
        args.push(path);
    }

    let output = crate::utils::create_command("modal")
        .env("PYTHONIOENCODING", "utf-8")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute modal volume put: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to upload to volume: {}", stderr));
    }

    Ok(())
}

/// Download file from volume (modal volume get)
#[tauri::command]
pub async fn volume_get(volume_name: String, remote_path: String, local_path: Option<String>) -> Result<(), String> {
    let mut args = vec!["volume".to_string(), "get".to_string(), "--force".to_string(), volume_name.clone(), remote_path.clone()];

    if let Some(path) = local_path {
        args.push(path);
    }

    let output = crate::utils::create_command("modal")
        .env("PYTHONIOENCODING", "utf-8")
        .args(&args)
        .output()
        .map_err(|e| format!("Failed to execute modal volume get: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to download from volume: {}", stderr));
    }

    Ok(())
}

/// Delete file from volume (modal volume rm)
#[tauri::command]
pub async fn volume_rm(volume_name: String, path: String) -> Result<(), String> {
    let output = crate::utils::create_command("modal")
        .env("PYTHONIOENCODING", "utf-8")
        .args(["volume", "rm", "-r", &volume_name, &path])
        .output()
        .map_err(|e| format!("Failed to execute modal volume rm: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to delete file: {}", stderr));
    }

    Ok(())
}

/// Copy file within a volume (modal volume cp)
#[tauri::command]
pub async fn volume_cp(volume_name: String, source: String, dest: String) -> Result<(), String> {
    let output = crate::utils::create_command("modal")
        .env("PYTHONIOENCODING", "utf-8")
        .args(["volume", "cp", &volume_name, &source, &dest])
        .output()
        .map_err(|e| format!("Failed to execute modal volume cp: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to copy file: {}", stderr));
    }

    Ok(())
}

#[tauri::command]
pub async fn volume_read_file(volume_name: String, path: String) -> Result<String, String> {
    use std::env;
    use std::fs;
    
    // Create temp file path
    let mut temp_dir = env::temp_dir();
    let file_name = std::path::Path::new(&path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("temp_file");
        
    let unique_name = format!("{}_{}", uuid::Uuid::new_v4(), file_name);
    temp_dir.push(unique_name);
    
    let local_path = temp_dir.to_string_lossy().to_string();

    // Download to temp file
    let output = crate::utils::create_command("modal")
        .env("PYTHONIOENCODING", "utf-8")
        .args(["volume", "get", "--force", &volume_name, &path, &local_path])
        .output()
        .map_err(|e| format!("Failed to execute modal volume get: {}", e))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        return Err(format!("Failed to download file to read: {}", stderr));
    }
    
    // Read the file based on extension
    let ext = std::path::Path::new(&path)
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_lowercase();
        
    let result = if ["png", "jpg", "jpeg", "gif", "webp", "bmp", "ico"].contains(&ext.as_str()) {
        // Read as base64
        fs::read(&temp_dir)
            .map(|bytes| {
                use base64::{Engine as _, engine::general_purpose::STANDARD};
                let mime = match ext.as_str() {
                    "png" => "image/png",
                    "jpg" | "jpeg" => "image/jpeg",
                    "gif" => "image/gif",
                    "webp" => "image/webp",
                    "bmp" => "image/bmp",
                    "ico" => "image/x-icon",
                    _ => "application/octet-stream"
                };
                format!("data:{};base64,{}", mime, STANDARD.encode(bytes))
            })
            .map_err(|e| format!("Failed to read temp file: {}", e))
    } else {
        // Read as text
        fs::read_to_string(&temp_dir)
            .map_err(|e| format!("Failed to read temp file: {}", e))
    };
    
    // Cleanup temp file
    let _ = fs::remove_file(&temp_dir);
    
    result
}
