use std::process::Command;
use std::sync::Mutex;
use std::collections::HashMap;
use tauri::State;
use serde::{Deserialize, Serialize};

#[derive(Default)]
pub struct TensorboardState {
    pub processes: Mutex<HashMap<u16, u32>>,
}

#[derive(Debug, Serialize)]
pub struct TensorboardResponse {
    pub url: String,
    pub port: u16,
}

#[tauri::command]
pub async fn start_tensorboard(
    logdir: String,
    state: State<'_, TensorboardState>,
) -> Result<TensorboardResponse, String> {
    let port = 6006; 
    
    if let Ok(mut processes) = state.processes.lock() {
        if let Some(pid) = processes.get(&port) {
            let _ = crate::utils::create_command("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .status();
            processes.remove(&port);
        }
    }

    let child = crate::utils::create_command("tensorboard")
        .args(["--logdir", &logdir, "--port", &port.to_string(), "--host", "127.0.0.1"])
        .spawn()
        .map_err(|e| format!("Failed to start tensorboard: {}", e))?;

    let pid = child.id();
    if let Ok(mut processes) = state.processes.lock() {
        processes.insert(port, pid);
    }

    // Wait a brief moment for it to start
    tokio::time::sleep(tokio::time::Duration::from_secs(2)).await;

    Ok(TensorboardResponse {
        url: format!("http://127.0.0.1:{}", port),
        port,
    })
}

#[tauri::command]
pub async fn stop_tensorboard(
    port: u16,
    state: State<'_, TensorboardState>,
) -> Result<(), String> {
    if let Ok(mut processes) = state.processes.lock() {
        if let Some(pid) = processes.remove(&port) {
            let _ = crate::utils::create_command("taskkill")
                .args(["/F", "/PID", &pid.to_string()])
                .status();
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn create_tensorboard_dir(path: String) -> Result<(), String> {
    std::fs::create_dir_all(path).map_err(|e| format!("Failed to create directory: {}", e))
}