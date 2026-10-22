use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::time::{SystemTime, UNIX_EPOCH};
use log::{info, error};
use tauri::{AppHandle, Manager};

// ---------------------------------------------------------------------------
// Data models
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaggleAccount {
    pub id: String,
    pub label: String,
    pub username: String,
    pub auth_method: String, // "legacy_key" | "api_token" | "oauth"
    pub source: String,      // "managed" (app store) | "global" (~/.kaggle)
    pub key_hint: String,    // e.g. "••••abcd" — never the full secret
    pub is_active_global: bool,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaggleActiveGlobal {
    pub username: String,
    pub source: String, // "env_token" | "access_token" | "legacy_key" | "oauth" | "cli_env" | "none"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaggleQuota {
    pub resource: String, // "GPU" | "TPU"
    pub used_hours: f64,
    pub remaining_hours: f64,
    pub total_hours: f64,
    pub refresh_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct AccountMeta {
    id: String,
    label: String,
    username: String,
    auth_method: String,
    created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
struct ActivePointer {
    id: String,
    username: String,
    set_at: String,
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------

/// Root directory for accounts managed by this app:
/// <app_data_dir>/kaggle/accounts/<id>/
fn accounts_root(app: &AppHandle) -> Result<PathBuf, String> {
    let data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    Ok(data_dir.join("kaggle").join("accounts"))
}

fn account_dir(app: &AppHandle, id: &str) -> Result<PathBuf, String> {
    if id.is_empty() || id.contains('/') || id.contains('\\') || id.contains("..") {
        return Err(format!("Invalid account id: {}", id));
    }
    Ok(accounts_root(app)?.join(id))
}

fn id_from_label(label: &str) -> String {
    let mut slug = String::new();
    for c in label.chars() {
        if c.is_ascii_alphanumeric() {
            slug.push(c.to_ascii_lowercase());
        } else if !slug.ends_with('-') {
            slug.push('-');
        }
    }
    while slug.starts_with('-') {
        slug.remove(0);
    }
    while slug.ends_with('-') {
        slug.pop();
    }
    if slug.is_empty() {
        slug = "account".to_string();
    }
    slug
}

/// Generate an unused id: "<slug>", "<slug>-2", "<slug>-3", ...
fn unique_id(app: &AppHandle, label: &str) -> Result<String, String> {
    let slug = id_from_label(label);
    let root = accounts_root(app)?;
    let mut id = slug.clone();
    let mut n = 2;
    while root.join(&id).exists() {
        id = format!("{}-{}", slug, n);
        n += 1;
    }
    Ok(id)
}

fn now_unix() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs().to_string())
        .unwrap_or_else(|_| "0".to_string())
}

// ---------------------------------------------------------------------------
// File helpers
// ---------------------------------------------------------------------------

fn read_account_meta(dir: &Path) -> Result<AccountMeta, String> {
    let path = dir.join("account.json");
    let raw = fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read {}: {}", path.display(), e))?;
    serde_json::from_str(&raw)
        .map_err(|e| format!("Failed to parse account.json: {}", e))
}

fn write_account_meta(dir: &Path, meta: &AccountMeta) -> Result<(), String> {
    let path = dir.join("account.json");
    let raw = serde_json::to_string_pretty(meta)
        .map_err(|e| format!("Failed to serialize account.json: {}", e))?;
    fs::write(&path, raw)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))
}

fn secure_write(path: &Path, content: &str) -> Result<(), String> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create {}: {}", parent.display(), e))?;
    }
    fs::write(path, content)
        .map_err(|e| format!("Failed to write {}: {}", path.display(), e))?;
    // Restrictive permissions on unix (best-effort, ignored on Windows)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

/// Read {"username": "...", "key": "..."} from a kaggle.json file
fn read_kaggle_json(path: &Path) -> Option<(String, String)> {
    let raw = fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let username = v.get("username")?.as_str()?.to_string();
    let key = v.get("key")?.as_str()?.to_string();
    if username.is_empty() || key.is_empty() {
        return None;
    }
    Some((username, key))
}

/// Read a top-level string field from a JSON file
fn read_json_string_field(path: &Path, field: &str) -> Option<String> {
    let raw = fs::read_to_string(path).ok()?;
    let v: serde_json::Value = serde_json::from_str(&raw).ok()?;
    let s = v.get(field)?.as_str()?.to_string();
    if s.is_empty() {
        None
    } else {
        Some(s)
    }
}

fn secret_hint(secret: &str) -> String {
    let n = secret.chars().count();
    if n <= 4 {
        "••••".to_string()
    } else {
        let tail: String = secret.chars().skip(n - 4).collect();
        format!("••••{}", tail)
    }
}

/// Home kaggle dir (~/.kaggle on all platforms)
fn kaggle_home() -> Result<PathBuf, String> {
    dirs::home_dir()
        .map(|h| h.join(".kaggle"))
        .ok_or_else(|| "Failed to resolve home directory".to_string())
}

// ---------------------------------------------------------------------------
// Command construction
// ---------------------------------------------------------------------------

/// Build a Command that runs `kaggle` against the account's credentials by
/// injecting environment variables (never mutating ~/.kaggle for data calls).
fn kaggle_command_for_account(app: &AppHandle, account_id: &str) -> Result<Command, String> {
    if let Some(meta) = try_read_account_meta_for(app, account_id) {
        let dir = account_dir(app, account_id)?;
        let mut cmd = crate::utils::create_command("kaggle");
        cmd.env("PYTHONIOENCODING", "utf-8");
        match meta.auth_method.as_str() {
            "legacy_key" => {
                // The CLI reads <KAGGLE_CONFIG_DIR>/kaggle.json.
                // KAGGLE_API_TOKEN has HIGHER priority than the legacy key,
                // so it must be removed to avoid overriding this account.
                cmd.env("KAGGLE_CONFIG_DIR", &dir);
                cmd.env_remove("KAGGLE_API_TOKEN");
            }
            "api_token" => {
                let token_path = dir.join("token");
                let token = fs::read_to_string(&token_path)
                    .map_err(|e| format!("Failed to read token file: {}", e))?
                    .trim()
                    .to_string();
                cmd.env("KAGGLE_API_TOKEN", token);
                cmd.env_remove("KAGGLE_USERNAME");
                cmd.env_remove("KAGGLE_KEY");
            }
            _ => {
                // "global" accounts: run with default env (auth resolves
                // from ~/.kaggle itself thanks to the CLI's built-in OAuth
                // credentials flow).
            }
        }
        Ok(cmd)
    } else {
        Err(format!("Account not found: {}", account_id))
    }
}

fn try_read_account_meta_for(app: &AppHandle, id: &str) -> Option<AccountMeta> {
    let dir = account_dir(app, id).ok()?;
    read_account_meta(&dir).ok()
}

fn run_command(mut cmd: Command, args: &[&str]) -> Result<Output, String> {
    cmd.args(args);
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    cmd.output()
        .map_err(|e| format!("Failed to execute kaggle CLI: {}", e))
}

// ---------------------------------------------------------------------------
// Verification (used by add-account)
// ---------------------------------------------------------------------------

/// Verify credentials by making a real authenticated call.
/// First tries `kaggle quota -v` (2.x). If the CLI is an old 1.x that has no
/// "quota" command, falls back to `kaggle competitions list -q -v`.
fn verify_credentials<F: Fn() -> Command>(make_cmd: F) -> Result<(), String> {
    let out = run_command(make_cmd(), &["quota", "-v"])?;
    if out.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    let unknown_quota = stderr.contains("invalid choice") || stderr.contains("unrecognized");
    if !unknown_quota {
        return Err(format!("Verification failed: {}", stderr.trim()));
    }
    let out2 = run_command(make_cmd(), &["competitions", "list", "-q", "-v"])?;
    if out2.status.success() {
        return Ok(());
    }
    let stderr2 = String::from_utf8_lossy(&out2.stderr).to_string();
    Err(format!("Verification failed: {}", stderr2.trim()))
}

/// Extract username from `kaggle config view` output (line "- username: <value>")
fn parse_config_username(stdout: &str) -> Option<String> {
    for line in stdout.lines() {
        let line = line.trim();
        if line.starts_with("- username") {
            let rest = line.strip_prefix("- username").unwrap_or("");
            let val = rest.trim_start_matches(':').trim();
            if !val.is_empty() && val != "None" {
                return Some(val.to_string());
            }
        }
    }
    None
}

// ---------------------------------------------------------------------------
// Global (~/.kaggle) detection
// ---------------------------------------------------------------------------

fn detect_active_global() -> KaggleActiveGlobal {
    let home = match kaggle_home() {
        Ok(p) => p,
        Err(_) => {
            return KaggleActiveGlobal {
                username: String::new(),
                source: "none".to_string(),
            }
        }
    };

    // 1. KAGGLE_API_TOKEN env var set at app launch has the highest priority.
    if let Ok(tok) = std::env::var("KAGGLE_API_TOKEN") {
        if !tok.trim().is_empty() {
            return KaggleActiveGlobal {
                username: String::new(),
                source: "env_token".to_string(),
            };
        }
    }

    // 2. ~/.kaggle/access_token (or access_token.txt)
    if home.join("access_token").exists() || home.join("access_token.txt").exists() {
        return KaggleActiveGlobal {
            username: String::new(),
            source: "access_token".to_string(),
        };
    }

    // 3. ~/.kaggle/kaggle.json (legacy API key)
    if let Some((username, _key)) = read_kaggle_json(&home.join("kaggle.json")) {
        return KaggleActiveGlobal {
            username,
            source: "legacy_key".to_string(),
        };
    }

    // 4. ~/.kaggle/credentials.json (OAuth refresh token from `kaggle auth login`)
    if home.join("credentials.json").exists() {
        let username = read_json_string_field(&home.join("credentials.json"), "username")
            .unwrap_or_default();
        return KaggleActiveGlobal {
            username,
            source: "oauth".to_string(),
        };
    }

    KaggleActiveGlobal {
        username: String::new(),
        source: "cli_env".to_string(),
    }
}

/// Backup an existing file next to itself, then replace it with `content`.
fn backup_and_write(path: &Path, content: &str) -> Result<(), String> {
    if path.exists() {
        let ts = now_unix();
        let backup = path.with_file_name(format!(
            "{}.bak-{}",
            path.file_name()
                .map(|f| f.to_string_lossy().to_string())
                .unwrap_or_else(|| "file".to_string()),
            ts
        ));
        fs::copy(path, &backup)
            .map_err(|e| format!("Failed to backup {}: {}", path.display(), e))?;
        info!("Backed up {} -> {}", path.display(), backup.display());
    }
    secure_write(path, content)
}

fn read_active_pointer(app: &AppHandle) -> Option<ActivePointer> {
    let root = accounts_root(app).ok()?.parent()?.to_path_buf().join("active.json");
    let raw = fs::read_to_string(root).ok()?;
    serde_json::from_str(&raw).ok()
}

fn write_active_pointer(app: &AppHandle, pointer: &ActivePointer) -> Result<(), String> {
    let root = accounts_root(app)?;
    let path = root
        .parent()
        .ok_or("Invalid accounts root")?
        .join("active.json");
    let raw = serde_json::to_string_pretty(pointer)
        .map_err(|e| format!("Failed to serialize active.json: {}", e))?;
    fs::write(&path, raw).map_err(|e| format!("Failed to write active.json: {}", e))
}

// ---------------------------------------------------------------------------
// Commands: CLI availability
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kaggle_cli_available() -> Result<bool, String> {
    info!("Checking kaggle CLI availability");
    let mut cmd = crate::utils::create_command("kaggle");
    cmd.env("PYTHONIOENCODING", "utf-8");
    match cmd.args(["--version"]).output() {
        Ok(out) => Ok(out.status.success()),
        Err(_) => Ok(false),
    }
}

// ---------------------------------------------------------------------------
// Commands: list accounts
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kaggle_list_accounts(app: AppHandle) -> Result<Vec<KaggleAccount>, String> {
    info!("Listing Kaggle accounts");
    let active = detect_active_global();
    let pointer = read_active_pointer(&app).map(|p| p.id).unwrap_or_default();

    let mut accounts: Vec<KaggleAccount> = Vec::new();

    // 1. Managed accounts (<app_data>/kaggle/accounts/*)
    let root = accounts_root(&app)?;
    if root.is_dir() {
        let mut entries: Vec<PathBuf> = fs::read_dir(&root)
            .map_err(|e| format!("Failed to read accounts dir: {}", e))?
            .filter_map(|e| e.ok().map(|e| e.path()))
            .filter(|p| p.is_dir())
            .collect();
        entries.sort_by_key(|p| p.file_name().map(|f| f.to_string_lossy().to_string()));

        for dir in entries {
            let meta = match read_account_meta(&dir) {
                Ok(m) => m,
                Err(_) => continue, // skip invalid dirs silently
            };
            let key_hint = match meta.auth_method.as_str() {
                "legacy_key" => read_kaggle_json(&dir.join("kaggle.json"))
                    .map(|(_, k)| secret_hint(&k))
                    .unwrap_or_default(),
                "api_token" => fs::read_to_string(dir.join("token"))
                    .map(|t| secret_hint(t.trim()))
                    .unwrap_or_default(),
                _ => String::new(),
            };
            let username_matches = !meta.username.is_empty()
                && meta.username == active.username
                && !active.username.is_empty();
            let is_active_global = username_matches || pointer == meta.id;
            accounts.push(KaggleAccount {
                id: meta.id,
                label: meta.label,
                username: meta.username,
                auth_method: meta.auth_method,
                source: "managed".to_string(),
                key_hint,
                is_active_global,
                created_at: meta.created_at,
            });
        }
    }

    // 2. Virtual "global" entries — what the plain CLI currently sees in ~/.kaggle.
    //    These are read-only views (imported/managed externally by the user).
    let managed_usernames: Vec<String> = accounts.iter().map(|a| a.username.clone()).collect();

    if let Ok(home) = kaggle_home() {
        // Legacy kaggle.json in ~/.kaggle
        if let Some((username, key)) = read_kaggle_json(&home.join("kaggle.json")) {
            if !managed_usernames.contains(&username) {
                accounts.push(KaggleAccount {
                    id: "global-legacy".to_string(),
                    label: "(~/.kaggle legacy key)".to_string(),
                    username,
                    auth_method: "legacy_key".to_string(),
                    source: "global".to_string(),
                    key_hint: secret_hint(&key),
                    is_active_global: active.source == "legacy_key",
                    created_at: String::new(),
                });
            }
        }
        // OAuth credentials.json in ~/.kaggle
        if home.join("credentials.json").exists() {
            let username = read_json_string_field(&home.join("credentials.json"), "username")
                .unwrap_or_default();
            if !managed_usernames.contains(&username) {
                accounts.push(KaggleAccount {
                    id: "global-oauth".to_string(),
                    label: "(~/.kaggle OAuth)".to_string(),
                    username,
                    auth_method: "oauth".to_string(),
                    source: "global".to_string(),
                    key_hint: String::new(),
                    is_active_global: active.source == "oauth",
                    created_at: String::new(),
                });
            }
        }
        // A dangling access_token without matching account above
        if active.source == "access_token"
            && !accounts.iter().any(|a| a.auth_method == "api_token")
        {
            accounts.push(KaggleAccount {
                id: "global-token".to_string(),
                label: "(~/.kaggle access token)".to_string(),
                username: String::new(),
                auth_method: "api_token".to_string(),
                source: "global".to_string(),
                key_hint: String::new(),
                is_active_global: true,
                created_at: String::new(),
            });
        }
    }

    Ok(accounts)
}

// ---------------------------------------------------------------------------
// Commands: get active global
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kaggle_get_active_global() -> Result<KaggleActiveGlobal, String> {
    Ok(detect_active_global())
}

// ---------------------------------------------------------------------------
// Commands: add accounts
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kaggle_add_account(
    app: AppHandle,
    label: String,
    username: String,
    key: String,
) -> Result<KaggleAccount, String> {
    info!("Adding Kaggle account (legacy key): {}", label);
    let label = label.trim().to_string();
    let username = username.trim().to_string();
    let key = key.trim().to_string();
    if label.is_empty() || username.is_empty() || key.is_empty() {
        return Err("Label, username and key are all required.".to_string());
    }

    let id = unique_id(&app, &label)?;
    let dir = account_dir(&app, &id)?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create account dir: {}", e))?;

    // Write the real kaggle.json (the format the CLI reads)
    let kaggle_json = serde_json::json!({ "username": username, "key": key });
    let kaggle_json_raw = serde_json::to_string_pretty(&kaggle_json)
        .map_err(|e| format!("Failed to serialize kaggle.json: {}", e))?;
    secure_write(&dir.join("kaggle.json"), &kaggle_json_raw)?;

    // Verify with a real authenticated CLI call
    let verify_err = verify_credentials(|| {
        let mut cmd = crate::utils::create_command("kaggle");
        cmd.env("PYTHONIOENCODING", "utf-8");
        cmd.env("KAGGLE_CONFIG_DIR", &dir);
        cmd.env_remove("KAGGLE_API_TOKEN");
        cmd
    });
    if let Err(verify_err) = verify_err {
        // Rollback: remove the half-created account dir
        let _ = fs::remove_dir_all(&dir);
        return Err(verify_err);
    }

    // Capture the actual credentials state via config view (extra sanity log)
    let mut view_cmd = crate::utils::create_command("kaggle");
    view_cmd.env("PYTHONIOENCODING", "utf-8");
    view_cmd.env("KAGGLE_CONFIG_DIR", &dir);
    view_cmd.env_remove("KAGGLE_API_TOKEN");
    if let Ok(out) = run_command(view_cmd, &["config", "view"]) {
        if !out.status.success() {
            let stderr = String::from_utf8_lossy(&out.stderr);
            error!("kaggle config view stderr: {}", stderr);
        }
    }

    let meta = AccountMeta {
        id: id.clone(),
        label: label.clone(),
        username: username.clone(),
        auth_method: "legacy_key".to_string(),
        created_at: now_unix(),
    };
    write_account_meta(&dir, &meta)?;

    Ok(KaggleAccount {
        id,
        label: meta.label,
        username: meta.username,
        auth_method: meta.auth_method,
        source: "managed".to_string(),
        key_hint: secret_hint(&key),
        is_active_global: false,
        created_at: meta.created_at,
    })
}

#[tauri::command]
pub async fn kaggle_add_token_account(
    app: AppHandle,
    label: String,
    token: String,
) -> Result<KaggleAccount, String> {
    info!("Adding Kaggle account (API token): {}", label);
    let label = label.trim().to_string();
    let token = token.trim().to_string();
    if label.is_empty() || token.is_empty() {
        return Err("Label and token are both required.".to_string());
    }

    let id = unique_id(&app, &label)?;
    let dir = account_dir(&app, &id)?;
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create account dir: {}", e))?;

    secure_write(&dir.join("token"), &token)?;

    // Verify with a real authenticated CLI call
    let verify_err = verify_credentials(|| {
        let mut cmd = crate::utils::create_command("kaggle");
        cmd.env("PYTHONIOENCODING", "utf-8");
        cmd.env("KAGGLE_API_TOKEN", &token);
        cmd.env_remove("KAGGLE_USERNAME");
        cmd.env_remove("KAGGLE_KEY");
        cmd
    });
    if let Err(verify_err) = verify_err {
        let _ = fs::remove_dir_all(&dir);
        return Err(verify_err);
    }

    // Token mode: username is resolved server-side by token introspection,
    // so pull it out of `kaggle config view`.
    let mut view_cmd = crate::utils::create_command("kaggle");
    view_cmd.env("PYTHONIOENCODING", "utf-8");
    view_cmd.env("KAGGLE_API_TOKEN", &token);
    view_cmd.env_remove("KAGGLE_USERNAME");
    view_cmd.env_remove("KAGGLE_KEY");
    let username = match run_command(view_cmd, &["config", "view"]) {
        Ok(out) if out.status.success() => {
            let stdout = String::from_utf8_lossy(&out.stdout).to_string();
            parse_config_username(&stdout).unwrap_or_default()
        }
        _ => String::new(),
    };

    let meta = AccountMeta {
        id: id.clone(),
        label: label.clone(),
        username: username.clone(),
        auth_method: "api_token".to_string(),
        created_at: now_unix(),
    };
    write_account_meta(&dir, &meta)?;

    Ok(KaggleAccount {
        id,
        label: meta.label,
        username: meta.username,
        auth_method: meta.auth_method,
        source: "managed".to_string(),
        key_hint: secret_hint(&token),
        is_active_global: false,
        created_at: meta.created_at,
    })
}

// ---------------------------------------------------------------------------
// Commands: update / remove account
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kaggle_update_account(
    app: AppHandle,
    account_id: String,
    label: String,
) -> Result<(), String> {
    info!("Updating Kaggle account label: {} -> {}", account_id, label);
    let dir = account_dir(&app, &account_id)?;
    let mut meta = read_account_meta(&dir)?;
    meta.label = label.trim().to_string();
    if meta.label.is_empty() {
        return Err("Label cannot be empty.".to_string());
    }
    write_account_meta(&dir, &meta)
}

#[tauri::command]
pub async fn kaggle_remove_account(app: AppHandle, account_id: String) -> Result<(), String> {
    info!("Removing Kaggle account: {}", account_id);
    if account_id.starts_with("global") {
        return Err(
            "This is a global (~/.kaggle) account — not managed by the app. \
             Remove it yourself via `kaggle auth revoke` or delete ~/.kaggle/kaggle.json."
                .to_string(),
        );
    }
    let dir = account_dir(&app, &account_id)?;
    fs::remove_dir_all(&dir)
        .map_err(|e| format!("Failed to remove account dir: {}", e))?;

    // Clear the active pointer if it pointed at this account
    if let Some(p) = read_active_pointer(&app) {
        if p.id == account_id {
            let _ = fs::remove_file(
                accounts_root(&app)?
                    .parent()
                    .unwrap()
                    .join("active.json"),
            );
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Commands: set active account (global ~/.kaggle switch)
// ---------------------------------------------------------------------------

#[tauri::command]
pub async fn kaggle_set_active_account(app: AppHandle, account_id: String) -> Result<String, String> {
    info!("Setting active global Kaggle account: {}", account_id);
    let dir = account_dir(&app, &account_id)?;
    let meta = read_account_meta(&dir)?;
    let home = kaggle_home()?;
    fs::create_dir_all(&home)
        .map_err(|e| format!("Failed to create ~/.kaggle: {}", e))?;

    match meta.auth_method.as_str() {
        "legacy_key" => {
            let json = dir.join("kaggle.json");
            let content = fs::read_to_string(&json)
                .map_err(|e| format!("Failed to read account kaggle.json: {}", e))?;
            backup_and_write(&home.join("kaggle.json"), &content)?;
            // access_token outranks the legacy key, so park it aside
            for name in ["access_token", "access_token.txt"] {
                let p = home.join(name);
                if p.exists() {
                    let ts = now_unix();
                    let backup = home.join(format!("{}.bak-{}", name, ts));
                    let _ = fs::rename(&p, &backup);
                    info!("Parked aside {} -> {}", p.display(), backup.display());
                }
            }
        }
        "api_token" => {
            let token_path = dir.join("token");
            let token = fs::read_to_string(&token_path)
                .map_err(|e| format!("Failed to read account token: {}", e))?;
            backup_and_write(&home.join("access_token"), token.trim())?;
        }
        other => return Err(format!("Account type '{}' cannot be set active.", other)),
    }

    write_active_pointer(
        &app,
        &ActivePointer {
            id: meta.id.clone(),
            username: meta.username.clone(),
            set_at: now_unix(),
        },
    )?;

    Ok(meta.username)
}

// ---------------------------------------------------------------------------
// Commands: quota
// ---------------------------------------------------------------------------

fn parse_hours(value: &serde_json::Value) -> Option<f64> {
    match value {
        serde_json::Value::Number(n) => n.as_f64(),
        serde_json::Value::String(s) => {
            let t = s.trim().trim_end_matches('h').trim();
            t.parse::<f64>().ok()
        }
        _ => None,
    }
}

fn parse_quota_json(stdout: &str) -> Result<Option<Vec<KaggleQuota>>, ()> {
    // Some CLI versions may print warnings before the JSON array — locate the first '['
    let start = match stdout.find('[') {
        Some(i) => i,
        None => return Err(()),
    };
    let end = match stdout.rfind(']') {
        Some(i) => i,
        None => return Err(()),
    };
    let slice = &stdout[start..=end];
    let parsed: serde_json::Value = match serde_json::from_str(slice) {
        Ok(v) => v,
        Err(_) => return Err(()),
    };
    let arr = match parsed.as_array() {
        Some(a) => a,
        None => return Err(()),
    };

    let mut quotas = Vec::new();
    for item in arr {
        let resource = item
            .get("resource")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        if resource.is_empty() {
            continue;
        }
        let used = item.get("used").and_then(parse_hours).unwrap_or(0.0);
        let remaining = item.get("remaining").and_then(parse_hours).unwrap_or(0.0);
        let total = item.get("total").and_then(parse_hours).unwrap_or(0.0);
        let refresh_at = item
            .get("refreshAt")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        quotas.push(KaggleQuota {
            resource,
            used_hours: used,
            remaining_hours: remaining,
            total_hours: total,
            refresh_at,
        });
    }
    Ok(Some(quotas))
}

fn parse_quota_csv(stdout: &str) -> Vec<KaggleQuota> {
    let mut quotas = Vec::new();
    for line in stdout.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("resource") {
            continue; // header or blank
        }
        let cols: Vec<&str> = line.split(',').collect();
        if cols.len() < 5 {
            continue;
        }
        let clean = |v: &str| v.trim().trim_matches('"').to_string();
        let resource = clean(cols[0]);
        if resource.is_empty() {
            continue;
        }
        let parse_h = |v: &str| v.trim().trim_matches('"').trim_end_matches('h').trim().parse::<f64>().unwrap_or(0.0);
        quotas.push(KaggleQuota {
            resource,
            used_hours: parse_h(cols[1]),
            remaining_hours: parse_h(cols[2]),
            total_hours: parse_h(cols[3]),
            refresh_at: clean(cols[4]),
        });
    }
    quotas
}

#[tauri::command]
pub async fn kaggle_quota(app: AppHandle, account_id: String) -> Result<Vec<KaggleQuota>, String> {
    info!("Fetching Kaggle quota for account: {}", account_id);

    let out = run_command(
        kaggle_command_for_account(&app, &account_id)?,
        &["quota", "--format", "json"],
    )?;
    if out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        if stdout.contains("No quota information available") {
            return Ok(Vec::new());
        }
        if let Ok(Some(quotas)) = parse_quota_json(&stdout) {
            return Ok(quotas);
        }
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        let unknown_format = stderr.contains("unrecognized") || stderr.contains("invalid choice");
        if !unknown_format && !stderr.contains("User cancelled") {
            return Err(format!("kaggle quota failed: {}", stderr.trim()));
        }
        // else: fall through to the -v fallback below
    }

    // Fallback: CSV output (`-v` is kept in CLI 2.x AND supported by legacy 1.x)
    let out2 = run_command(
        kaggle_command_for_account(&app, &account_id)?,
        &["quota", "-v"],
    )?;
    if !out2.status.success() {
        let stderr = String::from_utf8_lossy(&out2.stderr).to_string();
        return Err(format!("kaggle quota failed: {}", stderr.trim()));
    }
    let stdout2 = String::from_utf8_lossy(&out2.stdout).to_string();
    if stdout2.contains("No quota information available") {
        return Ok(Vec::new());
    }
    Ok(parse_quota_csv(&stdout2))
}

// ---------------------------------------------------------------------------
// Part 2 — Kernels (run models on Kaggle GPU)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaggleKernel {
    #[serde(rename = "ref")]
    pub ref_: String, // "owner/slug"
    pub title: String,
    pub author: String,
    pub last_run_time: String,
    pub total_votes: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaggleKernelStatus {
    pub kernel: String,
    pub status: String,
    pub failure_message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaggleKernelOutputFile {
    pub name: String,
    pub size: String,
    pub creation_date: String,
}

/// What the app writes into `kernel-metadata.json` before `kernels push`.
/// Keys follow the kaggle CLI 2.x metadata format (snake_case).
#[derive(Debug, Clone, Deserialize)]
pub struct KaggleKernelPushConfig {
    pub title: String,
    pub slug: String,
    pub language: String,   // "python" | "r"
    pub kernel_type: String, // "notebook" | "script"
    #[serde(default)]
    pub accelerator: String, // machine_shape, e.g. "NvidiaTeslaT4" (empty = default)
    #[serde(default = "der_true")]
    pub is_private: bool,
    #[serde(default = "der_true")]
    pub enable_internet: bool,
    pub code_file: String, // relative path inside the folder
    #[serde(default)]
    pub dataset_sources: Vec<String>,
    #[serde(default)]
    pub kernel_sources: Vec<String>,
}

fn der_true() -> bool {
    true
}

/// Quote-aware CSV line splitter (titles may contain commas).
fn split_csv_line(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    let mut in_quotes = false;
    let mut chars = line.chars().peekable();
    while let Some(c) = chars.next() {
        if in_quotes {
            if c == '"' {
                if chars.peek() == Some(&'"') {
                    cur.push('"');
                    chars.next();
                } else {
                    in_quotes = false;
                }
            } else {
                cur.push(c);
            }
        } else {
            match c {
                '"' => in_quotes = true,
                ',' => {
                    out.push(cur.clone());
                    cur.clear();
                }
                _ => cur.push(c),
            }
        }
    }
    out.push(cur);
    out
}

/// Get a string field trying several key spellings (camelCase / snake_case).
fn json_str(v: &serde_json::Value, keys: &[&str]) -> String {
    for k in keys {
        if let Some(s) = v.get(*k).and_then(|x| x.as_str()) {
            return s.to_string();
        }
        if let Some(n) = v.get(*k).and_then(|x| x.as_f64()) {
            return format!("{}", n);
        }
    }
    String::new()
}

fn json_f64(v: &serde_json::Value, keys: &[&str]) -> f64 {
    for k in keys {
        if let Some(n) = v.get(*k).and_then(|x| x.as_f64()) {
            return n;
        }
        if let Some(s) = v.get(*k).and_then(|x| x.as_str()) {
            if let Ok(n) = s.trim().parse::<f64>() {
                return n;
            }
        }
    }
    0.0
}

/// Parse a `kernels list` row (JSON object or CSV columns).
fn kernel_from_input(obj_or_cols: &serde_json::Value) -> Option<KaggleKernel> {
    if obj_or_cols.is_object() {
        return Some(KaggleKernel {
            ref_: json_str(obj_or_cols, &["ref"]),
            title: json_str(obj_or_cols, &["title"]),
            author: json_str(obj_or_cols, &["author"]),
            last_run_time: json_str(obj_or_cols, &["lastRunTime", "last_run_time"]),
            total_votes: json_f64(obj_or_cols, &["totalVotes", "total_votes"]),
        });
    }
    // CSV fallback: array of plain strings (built by the caller)
    if let Some(cols) = obj_or_cols.as_array() {
        if cols.len() >= 5 {
            return Some(KaggleKernel {
                ref_: cols[0].as_str().unwrap_or("").to_string(),
                title: cols[1].as_str().unwrap_or("").to_string(),
                author: cols[2].as_str().unwrap_or("").to_string(),
                last_run_time: cols[3].as_str().unwrap_or("").to_string(),
                total_votes: cols[4]
                    .as_str()
                    .unwrap_or("0")
                    .trim()
                    .parse()
                    .unwrap_or(0.0),
            });
        }
    }
    None
}

/// Resolve the account username needed to form "<username>/<slug>" kernel ids.
fn resolve_username_for(app: &AppHandle, account_id: &str) -> Result<String, String> {
    let dir = account_dir(app, account_id)?;
    let meta = read_account_meta(&dir)?;
    if !meta.username.is_empty() {
        return Ok(meta.username);
    }
    if meta.auth_method == "api_token" {
        // Token accounts may lack a stored username — try config view.
        let token = fs::read_to_string(dir.join("token"))
            .map_err(|e| format!("Failed to read token file: {}", e))?
            .trim()
            .to_string();
        let mut view_cmd = crate::utils::create_command("kaggle");
        view_cmd.env("PYTHONIOENCODING", "utf-8");
        view_cmd.env("KAGGLE_API_TOKEN", &token);
        view_cmd.env_remove("KAGGLE_USERNAME");
        view_cmd.env_remove("KAGGLE_KEY");
        if let Ok(out) = run_command(view_cmd, &["config", "view"]) {
            if out.status.success() {
                if let Some(u) = parse_config_username(&String::from_utf8_lossy(&out.stdout)) {
                    return Ok(u);
                }
            }
        }
    }
    Err("Cannot determine the account username (needed for kernel id)".to_string())
}

#[tauri::command]
pub async fn kaggle_kernels(app: AppHandle, account_id: String) -> Result<Vec<KaggleKernel>, String> {
    info!("Listing Kaggle kernels for account: {}", account_id);

    // Primary: JSON (kaggle >= 2.x)
    let out = run_command(
        kaggle_command_for_account(&app, &account_id)?,
        &["kernels", "list", "-m", "--format", "json"],
    )?;
    if out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        if stdout.contains("Not found") {
            return Ok(Vec::new());
        }
        let start = stdout.find('[');
        let end = stdout.rfind(']');
        if let (Some(s), Some(e)) = (start, end) {
            if e > s {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&stdout[s..=e]) {
                    if let Some(arr) = parsed.as_array() {
                        return Ok(arr
                            .iter()
                            .filter_map(kernel_from_input)
                            .filter(|k| !k.ref_.is_empty())
                            .collect());
                    }
                }
            }
        }
    }
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    let unknown_format = stderr.contains("unrecognized") || stderr.contains("invalid choice");
    if !unknown_format && !stderr.trim().is_empty() {
        return Err(format!("kaggle kernels list failed: {}", stderr.trim()));
    }

    // Fallback: CSV (quote-aware)
    let out2 = run_command(
        kaggle_command_for_account(&app, &account_id)?,
        &["kernels", "list", "-m", "-v"],
    )?;
    if !out2.status.success() {
        let stderr2 = String::from_utf8_lossy(&out2.stderr).to_string();
        return Err(format!("kaggle kernels list failed: {}", stderr2.trim()));
    }
    let stdout2 = String::from_utf8_lossy(&out2.stdout).to_string();
    if stdout2.contains("Not found") {
        return Ok(Vec::new());
    }
    let mut kernels = Vec::new();
    for line in stdout2.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("ref,") {
            continue;
        }
        let cols: Vec<String> = split_csv_line(line);
        let value = serde_json::Value::Array(
            cols.into_iter().map(serde_json::Value::String).collect(),
        );
        if let Some(k) = kernel_from_input(&value) {
            kernels.push(k);
        }
    }
    Ok(kernels)
}

/// Parse `"<kernel> has status "<status>"` + optional Failure message line.
fn parse_kernel_status(kernel: &str, stdout: &str) -> KaggleKernelStatus {
    let marker = " has status \"";
    let mut status = String::new();
    if let Some(start) = stdout.find(marker) {
        let rest = &stdout[start + marker.len()..];
        if let Some(end) = rest.find('"') {
            status = rest[..end].to_string();
        }
    }
    let mut failure_message = String::new();
    for line in stdout.lines() {
        let line = line.trim();
        if let Some(rest) = line.strip_prefix("Failure message: \"") {
            failure_message = rest
                .trim_end()
                .trim_end_matches('"')
                .to_string();
        }
    }
    KaggleKernelStatus {
        kernel: kernel.to_string(),
        status: if status.is_empty() {
            "unknown".to_string()
        } else {
            status
        },
        failure_message,
    }
}

#[tauri::command]
pub async fn kaggle_kernel_status(
    app: AppHandle,
    account_id: String,
    kernel: String,
) -> Result<KaggleKernelStatus, String> {
    info!("Kaggle kernel status: {} ({})", kernel, account_id);
    let out = run_command(
        kaggle_command_for_account(&app, &account_id)?,
        &["kernels", "status", &kernel],
    )?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    if out.status.success() {
        Ok(parse_kernel_status(&kernel, &stdout))
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        // CLI also prints the informative part to stderr — surface it
        Err(format!("kaggle kernels status failed: {}", stderr.trim()))
    }
}

#[tauri::command]
pub async fn kaggle_kernel_logs(
    app: AppHandle,
    account_id: String,
    kernel: String,
) -> Result<String, String> {
    info!("Kaggle kernel logs: {} ({})", kernel, account_id);
    let out = run_command(
        kaggle_command_for_account(&app, &account_id)?,
        &["kernels", "logs", &kernel],
    )?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        Err(format!("kaggle kernels logs failed: {}", stderr.trim()))
    }
}

#[tauri::command]
pub async fn kaggle_kernel_output_files(
    app: AppHandle,
    account_id: String,
    kernel: String,
) -> Result<Vec<KaggleKernelOutputFile>, String> {
    info!("Kaggle kernel output files: {} ({})", kernel, account_id);

    let out = run_command(
        kaggle_command_for_account(&app, &account_id)?,
        &["kernels", "files", &kernel, "--format", "json"],
    )?;
    if out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        if stdout.contains("No files found") {
            return Ok(Vec::new());
        }
        if let (Some(s), Some(e)) = (stdout.find('['), stdout.rfind(']')) {
            if e > s {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&stdout[s..=e]) {
                    if let Some(arr) = parsed.as_array() {
                        return Ok(arr
                            .iter()
                            .map(|item| KaggleKernelOutputFile {
                                name: json_str(item, &["name"]),
                                size: json_str(item, &["size"]),
                                creation_date: json_str(item, &["creationDate", "creation_date"]),
                            })
                            .filter(|f| !f.name.is_empty())
                            .collect());
                    }
                }
            }
        }
    }
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    let unknown_format = stderr.contains("unrecognized") || stderr.contains("invalid choice");
    if !unknown_format && !stderr.trim().is_empty() {
        return Err(format!("kaggle kernels files failed: {}", stderr.trim()));
    }

    // Fallback: CSV (name,size,creationDate)
    let out2 = run_command(
        kaggle_command_for_account(&app, &account_id)?,
        &["kernels", "files", &kernel, "-v"],
    )?;
    if !out2.status.success() {
        let stderr2 = String::from_utf8_lossy(&out2.stderr).to_string();
        return Err(format!("kaggle kernels files failed: {}", stderr2.trim()));
    }
    let stdout2 = String::from_utf8_lossy(&out2.stdout).to_string();
    if stdout2.contains("No files found") {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for line in stdout2.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("name,") {
            continue;
        }
        if line.starts_with("Next Page Token") {
            continue;
        }
        let cols: Vec<String> = split_csv_line(line);
        if cols.len() >= 2 {
            files.push(KaggleKernelOutputFile {
                name: cols[0].clone(),
                size: cols[1].clone(),
                creation_date: cols.get(2).cloned().unwrap_or_default(),
            });
        }
    }
    Ok(files)
}

#[tauri::command]
pub async fn kaggle_kernel_push(
    app: AppHandle,
    account_id: String,
    folder: String,
    config: KaggleKernelPushConfig,
    no_run: bool,
) -> Result<String, String> {
    info!(
        "Kaggle kernel push: account={}, folder={}, no_run={}",
        account_id, folder, no_run
    );
    if folder.trim().is_empty() {
        return Err("Folder is required".to_string());
    }
    if config.title.trim().chars().count() < 5 {
        return Err("Title must be at least 5 characters".to_string());
    }
    if config.code_file.trim().is_empty() {
        return Err("A source code file must be selected".to_string());
    }
    let username = resolve_username_for(&app, &account_id)?;

    // Generate kernel-metadata.json (backup previous if present)
    let mut metadata = serde_json::json!({
        "id": format!("{}/{}", username, config.slug.trim()),
        "title": config.title.trim(),
        "code_file": config.code_file.trim(),
        "language": config.language,
        "kernel_type": config.kernel_type,
        "is_private": config.is_private,
        "enable_internet": config.enable_internet,
        "dataset_sources": config.dataset_sources,
        "kernel_sources": config.kernel_sources,
    });
    if !config.accelerator.is_empty() {
        metadata["machine_shape"] = serde_json::Value::String(config.accelerator.clone());
    }
    let metadata_raw = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize kernel-metadata.json: {}", e))?;
    let meta_path = Path::new(&folder).join("kernel-metadata.json");
    backup_and_write(&meta_path, &metadata_raw)?;
    info!(
        "Wrote kernel-metadata.json: id={}/{}, machine_shape={}",
        username,
        config.slug.trim(),
        config.accelerator
    );

    let mut args: Vec<&str> = vec!["kernels", "push", "-p", folder.as_str()];
    if no_run {
        args.push("--no-run");
    }
    let out = run_command(kaggle_command_for_account(&app, &account_id)?, &args)?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if out.status.success() && !stdout.contains("Kernel push error") {
        Ok(stdout.trim().to_string())
    } else {
        let combined = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            format!("{}{}", stdout.trim(), stderr.trim())
        };
        Err(combined)
    }
}

#[tauri::command]
pub async fn kaggle_kernel_output_download(
    app: AppHandle,
    account_id: String,
    kernel: String,
    file: Option<String>,
    path: String,
) -> Result<String, String> {
    info!(
        "Kaggle kernel output download: {} ({}), file={:?}, path={}",
        kernel, account_id, file, path
    );
    if path.trim().is_empty() {
        return Err("Destination path is required".to_string());
    }
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create target dir: {}", e))?;

    let mut args: Vec<&str> = vec!["kernels", "output", &kernel, "-p", path.as_str(), "-o"];
    let file_pattern;
    if let Some(f) = &file {
        if !f.trim().is_empty() {
            file_pattern = regex_escape(&f.trim());
            args.push("--file-pattern");
            args.push(&file_pattern);
        }
    }
    let out = run_command(kaggle_command_for_account(&app, &account_id)?, &args)?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    if out.status.success() {
        Ok(stdout.trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        Err(format!("kaggle kernels output failed: {}", stderr.trim()))
    }
}

/// Minimal regex escaping so file names can be used as `--file-pattern`.
fn regex_escape(input: &str) -> String {
    let mut out = String::with_capacity(input.len() + 8);
    for c in input.chars() {
        if !c.is_ascii_alphanumeric() && c != '_' && c != '-' && c != '/' && c != '.' {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// List top-level files of a local folder (used to pick the code file for push).
#[tauri::command]
pub async fn kaggle_list_folder_files(path: String) -> Result<Vec<String>, String> {
    info!("Listing local folder files: {}", path);
    if path.trim().is_empty() {
        return Ok(Vec::new());
    }
    let mut names = Vec::new();
    let entries = fs::read_dir(&path).map_err(|e| format!("Failed to read folder: {}", e))?;
    for e in entries.filter_map(|e| e.ok()) {
        if e.path().is_file() {
            if let Some(name) = e.file_name().to_str() {
                names.push(name.to_string());
            }
        }
    }
    names.sort();
    Ok(names)
}

// ---------------------------------------------------------------------------
// Part 3 — Datasets (feed data to kernels)
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaggleDataset {
    #[serde(rename = "ref")]
    pub ref_: String, // "owner/slug"
    pub title: String,
    pub last_updated: String,
    pub total_bytes: f64,
    pub download_count: f64,
    pub vote_count: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaggleDatasetFile {
    pub name: String,
    pub size: String, // bytes as string when CLI gives "123", human "1.2GB" otherwise
    pub creation_date: String,
}

/// Parse a `datasets list` item (JSON object or CSV column array).
fn dataset_from_input(v: &serde_json::Value) -> Option<KaggleDataset> {
    if v.is_object() {
        return Some(KaggleDataset {
            ref_: json_str(v, &["ref"]),
            title: json_str(v, &["title"]),
            last_updated: json_str(v, &["lastUpdated", "last_updated"]),
            total_bytes: json_f64(v, &["totalBytes", "total_bytes"]),
            download_count: json_f64(v, &["downloadCount", "download_count"]),
            vote_count: json_f64(v, &["voteCount", "vote_count"]),
        });
    }
    if let Some(cols) = v.as_array() {
        if cols.len() >= 4 {
            return Some(KaggleDataset {
                ref_: cols[0].as_str().unwrap_or("").to_string(),
                title: cols[1].as_str().unwrap_or("").to_string(),
                last_updated: cols[3].as_str().unwrap_or("").to_string(),
                total_bytes: cols[2]
                    .as_str()
                    .unwrap_or("0")
                    .trim()
                    .trim_end_matches('B')
                    .trim()
                    .parse()
                    .unwrap_or(0.0),
                download_count: 0.0,
                vote_count: 0.0,
            });
        }
    }
    None
}

#[tauri::command]
pub async fn kaggle_datasets(
    app: AppHandle,
    account_id: String,
) -> Result<Vec<KaggleDataset>, String> {
    info!("Listing Kaggle datasets for account: {}", account_id);

    let out = run_command(
        kaggle_command_for_account(&app, &account_id)?,
        &["datasets", "list", "-m", "--format", "json"],
    )?;
    if out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        if stdout.contains("Not found") {
            return Ok(Vec::new());
        }
        if let (Some(s), Some(e)) = (stdout.find('['), stdout.rfind(']')) {
            if e > s {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&stdout[s..=e]) {
                    if let Some(arr) = parsed.as_array() {
                        return Ok(arr
                            .iter()
                            .filter_map(dataset_from_input)
                            .filter(|d| !d.ref_.is_empty())
                            .collect());
                    }
                }
            }
        }
    }
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    let unknown_format = stderr.contains("unrecognized") || stderr.contains("invalid choice");
    if !unknown_format && !stderr.trim().is_empty() {
        return Err(format!("kaggle datasets list failed: {}", stderr.trim()));
    }

    // Fallback: CSV — header "ref,title,size,lastUpdated,..." (size in bytes)
    let out2 = run_command(
        kaggle_command_for_account(&app, &account_id)?,
        &["datasets", "list", "-m", "-v"],
    )?;
    if !out2.status.success() {
        let stderr2 = String::from_utf8_lossy(&out2.stderr).to_string();
        return Err(format!("kaggle datasets list failed: {}", stderr2.trim()));
    }
    let stdout2 = String::from_utf8_lossy(&out2.stdout).to_string();
    if stdout2.contains("Not found") {
        return Ok(Vec::new());
    }
    let mut datasets = Vec::new();
    for line in stdout2.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with("ref,") {
            continue;
        }
        if line.starts_with("Next Page Token") {
            continue;
        }
        let cols: Vec<String> = split_csv_line(line);
        let value = serde_json::Value::Array(
            cols.into_iter().map(serde_json::Value::String).collect(),
        );
        if let Some(d) = dataset_from_input(&value) {
            datasets.push(d);
        }
    }
    Ok(datasets)
}

#[tauri::command]
pub async fn kaggle_dataset_files(
    app: AppHandle,
    account_id: String,
    dataset: String,
) -> Result<Vec<KaggleDatasetFile>, String> {
    info!("Kaggle dataset files: {} ({})", dataset, account_id);

    let out = run_command(
        kaggle_command_for_account(&app, &account_id)?,
        &["datasets", "files", &dataset, "--format", "json"],
    )?;
    if out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        if stdout.contains("No files found") {
            return Ok(Vec::new());
        }
        if let (Some(s), Some(e)) = (stdout.find('['), stdout.rfind(']')) {
            if e > s {
                if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&stdout[s..=e]) {
                    if let Some(arr) = parsed.as_array() {
                        return Ok(arr
                            .iter()
                            .map(|item| KaggleDatasetFile {
                                name: json_str(item, &["name"]),
                                size: json_str(item, &["size", "totalBytes", "total_bytes"]),
                                creation_date: json_str(item, &["creationDate", "creation_date"]),
                            })
                            .filter(|f| !f.name.is_empty())
                            .collect());
                    }
                }
            }
        }
    }
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    let unknown_format = stderr.contains("unrecognized") || stderr.contains("invalid choice");
    if !unknown_format && !stderr.trim().is_empty() {
        return Err(format!("kaggle datasets files failed: {}", stderr.trim()));
    }

    // Fallback: CSV — header "name,total_bytes,creationDate" (may be "name,size,...")
    let out2 = run_command(
        kaggle_command_for_account(&app, &account_id)?,
        &["datasets", "files", &dataset, "-v"],
    )?;
    if !out2.status.success() {
        let stderr2 = String::from_utf8_lossy(&out2.stderr).to_string();
        return Err(format!("kaggle datasets files failed: {}", stderr2.trim()));
    }
    let stdout2 = String::from_utf8_lossy(&out2.stdout).to_string();
    if stdout2.contains("No files found") {
        return Ok(Vec::new());
    }
    let mut files = Vec::new();
    for line in stdout2.lines() {
        let line = line.trim();
        if line.is_empty()
            || line.starts_with("name,")
            || line.starts_with("Next Page Token")
        {
            continue;
        }
        let cols: Vec<String> = split_csv_line(line);
        if cols.len() >= 2 {
            files.push(KaggleDatasetFile {
                name: cols[0].clone(),
                size: cols[1].clone(),
                creation_date: cols.get(2).cloned().unwrap_or_default(),
            });
        }
    }
    Ok(files)
}

#[tauri::command]
pub async fn kaggle_dataset_download(
    app: AppHandle,
    account_id: String,
    dataset: String,
    file: Option<String>,
    path: String,
    unzip: bool,
) -> Result<String, String> {
    info!(
        "Kaggle dataset download: {} ({}), file={:?}, path={}, unzip={}",
        dataset, account_id, file, path, unzip
    );
    if path.trim().is_empty() {
        return Err("Destination path is required".to_string());
    }
    fs::create_dir_all(&path).map_err(|e| format!("Failed to create target dir: {}", e))?;

    let mut args: Vec<&str> = vec!["datasets", "download", &dataset, "-p", path.as_str(), "-o"];
    if unzip {
        args.push("--unzip");
    }
    let file_name_owned;
    if let Some(f) = &file {
        if !f.trim().is_empty() {
            file_name_owned = f.trim().to_string();
            args.push("-f");
            args.push(&file_name_owned);
        }
    }
    let out = run_command(kaggle_command_for_account(&app, &account_id)?, &args)?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    if out.status.success() {
        Ok(stdout.trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        Err(format!("kaggle datasets download failed: {}", stderr.trim()))
    }
}

/// Generate `dataset-metadata.json` (id/title/licenses) then run `datasets create`.
#[tauri::command]
pub async fn kaggle_dataset_create(
    app: AppHandle,
    account_id: String,
    folder: String,
    title: String,
    slug: String,
    license: String,
    is_public: bool,
) -> Result<String, String> {
    info!(
        "Kaggle dataset create: account={}, title={}, slug={}",
        account_id, title, slug
    );
    if folder.trim().is_empty() {
        return Err("Folder is required".to_string());
    }
    if title.trim().chars().count() < 6 || title.trim().chars().count() > 50 {
        return Err("Dataset title must be 6-50 characters".to_string());
    }
    if slug.trim().chars().count() < 6 || slug.trim().chars().count() > 50 {
        return Err("Dataset slug must be 6-50 characters".to_string());
    }
    if license.trim().is_empty() {
        return Err("License is required".to_string());
    }
    let username = resolve_username_for(&app, &account_id)?;

    let metadata = serde_json::json!({
        "id": format!("{}/{}", username, slug.trim()),
        "title": title.trim(),
        "licenses": [{ "name": license.trim() }],
    });
    let metadata_raw = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize dataset-metadata.json: {}", e))?;
    let meta_path = Path::new(&folder).join("dataset-metadata.json");
    backup_and_write(&meta_path, &metadata_raw)?;
    info!("Wrote dataset-metadata.json (id={}/{})", username, slug.trim());

    let mut args: Vec<&str> = vec!["datasets", "create", "-p", folder.as_str()];
    if is_public {
        args.push("-u");
    }
    let out = run_command(kaggle_command_for_account(&app, &account_id)?, &args)?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if out.status.success() && !stdout.contains("Dataset creation error") && !stdout.contains("error") {
        Ok(stdout.trim().to_string())
    } else {
        let combined = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            format!("{}\n{}", stdout.trim(), stderr.trim())
        };
        Err(combined)
    }
}

/// Run `datasets version` on an existing dataset id, (re)writing metadata {id} first.
#[tauri::command]
pub async fn kaggle_dataset_version(
    app: AppHandle,
    account_id: String,
    folder: String,
    dataset: String,
    notes: String,
) -> Result<String, String> {
    info!(
        "Kaggle dataset version: {} ({}), folder={}, notes={}",
        dataset, account_id, folder, notes
    );
    if folder.trim().is_empty() {
        return Err("Folder is required".to_string());
    }
    if dataset.trim().is_empty() || !dataset.contains('/') {
        return Err("Select an existing dataset (owner/slug)".to_string());
    }
    if notes.trim().is_empty() {
        return Err("Version notes are required".to_string());
    }

    // Ensure the folder points at the right dataset
    let metadata = serde_json::json!({ "id": dataset.trim() });
    let metadata_raw = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize dataset-metadata.json: {}", e))?;
    let meta_path = Path::new(&folder).join("dataset-metadata.json");
    backup_and_write(&meta_path, &metadata_raw)?;

    let args = ["datasets", "version", "-p", folder.as_str(), "-m", notes.as_str()];
    let out = run_command(kaggle_command_for_account(&app, &account_id)?, &args)?;
    let stdout = String::from_utf8_lossy(&out.stdout).to_string();
    let stderr = String::from_utf8_lossy(&out.stderr).to_string();
    if out.status.success() && !stdout.contains("error") {
        Ok(stdout.trim().to_string())
    } else {
        let combined = if stderr.trim().is_empty() {
            stdout.trim().to_string()
        } else {
            format!("{}\n{}", stdout.trim(), stderr.trim())
        };
        Err(combined)
    }
}
