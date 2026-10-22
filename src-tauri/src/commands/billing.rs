use serde::{Deserialize, Serialize};
use std::process::Command;
use log::error;

#[derive(Debug, Serialize, Deserialize)]
pub struct BillingSummary {
    pub metered_cost: Option<String>,
    pub billed_cost: Option<String>,
    pub credits: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct BillingRates {
    pub cpu_hour_cost: Option<String>,
    pub mem_gib_hour_cost: Option<String>,
    pub gpu_hour_cost_a100_80gb: Option<String>,
    pub gpu_hour_cost_h100: Option<String>,
    pub gpu_hour_cost_l4: Option<String>,
    pub gpu_hour_cost_t4: Option<String>,
    // we can parse this dynamically as a map if needed, but returning full JSON Value is easier for React
}

#[tauri::command]
pub async fn get_billing_summary(profile: Option<String>) -> Result<serde_json::Value, String> {
    let mut cmd = crate::utils::create_command("modal");
    cmd.args(["billing", "summary", "--json"]);

    if let Some(ref p) = profile {
        cmd.env("MODAL_PROFILE", p);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute modal: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        return Err(format!("modal billing summary failed: {}", stderr));
    }

    let parsed: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse modal output: {}", e))?;

    Ok(parsed)
}

#[tauri::command]
pub async fn get_billing_rates(profile: Option<String>) -> Result<serde_json::Value, String> {
    let mut cmd = crate::utils::create_command("modal");
    cmd.args(["billing", "rates", "--json"]);

    if let Some(ref p) = profile {
        cmd.env("MODAL_PROFILE", p);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to execute modal: {}", e))?;

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);

    if !output.status.success() {
        return Err(format!("modal billing rates failed: {}", stderr));
    }

    let parsed: serde_json::Value = serde_json::from_str(&stdout)
        .map_err(|e| format!("Failed to parse modal output: {}", e))?;

    Ok(parsed)
}
