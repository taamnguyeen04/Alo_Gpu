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

// ---------------------------------------------------------------------------
// Part 4 — AloRun (modal-run style: package a local Python project & run it)
//
// Inspired by KRun (nhminh107/KRun-PyProjectOnKaggle, MIT). The project tree is
// archived (tar.gz), embedded into a generated Python runner (or, when the
// runner exceeds Kaggle's ~1MB source limit, uploaded as a private per-job
// dataset the kernel attaches) and pushed with `kernels push`.
// ---------------------------------------------------------------------------

const MAX_PACKAGE_BYTES: u64 = 20 * 1024 * 1024; // 20 MB, same ceiling as KRun
const MAX_RUNNER_BYTES: usize = 900_000; // headroom below Kaggle's ~1 MB source limit
const HARD_RUNNER_BYTES: usize = 1_000_000;

const DEFAULT_IGNORES: &[&str] = &[
    ".git",
    ".krun",
    ".aloignore",
    ".venv",
    "venv",
    "env",
    "__pycache__",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    ".ipynb_checkpoints",
    ".kaggle",
    ".idea",
    ".vscode",
    "credentials.json",
    "access_token",
    "kaggle.json",
    ".DS_Store",
    ".env",
    ".env.*",
    "*.pem",
    "*.key",
    "*.p12",
    "*.pfx",
    "id_rsa",
    "id_ed25519",
    "*.pyc",
];

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KaggleProjectScan {
    pub root: String,
    pub file_count: u64,
    pub total_bytes: u64,
    pub entrypoints: Vec<String>,
    pub requirements: String, // relative posix path or empty
    pub pyproject: String,    // relative posix path or empty
    pub over_limit: bool,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct KaggleRunProjectConfig {
    pub title: String,
    pub slug: String,
    #[serde(default)]
    pub entrypoint: String, // relative posix path; required in script mode
    #[serde(default)]
    pub module: String, // "-m" mode: package/module name (overrides entrypoint)
    #[serde(default)]
    pub requirements: String, // relative path to requirements.txt / pyproject.toml; empty = none
    #[serde(default)]
    pub extra_packages: Vec<String>,
    #[serde(default)]
    pub dataset_sources: Vec<String>,
    #[serde(default)]
    pub secrets: Vec<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub output_paths: Vec<String>,
    #[serde(default)]
    pub accelerator: String, // machine_shape, e.g. "NvidiaTeslaT4"
    #[serde(default = "der_true")]
    pub enable_internet: bool,
    #[serde(default)]
    pub no_run: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct KaggleRunProjectResult {
    pub kernel: String, // owner/slug
    pub title: String,
    pub transport: String, // "embedded" | "private_dataset:<owner/slug>"
    pub file_count: u64,
    pub source_bytes: u64,
    pub runner_bytes: usize,
    pub message: String,
}

/// Minimal glob matcher for ignore rules: supports `*` (any, without `/`),
/// `**` (any, crossing `/`) and `?` (single, without `/`).
fn glob_match_impl(pat: &[u8], val: &[u8]) -> bool {
    if pat.is_empty() {
        return val.is_empty();
    }
    match pat[0] {
        b'*' => {
            if pat.len() > 1 && pat[1] == b'*' {
                let rest = &pat[2..];
                for i in 0..=val.len() {
                    if glob_match_impl(rest, &val[i..]) {
                        return true;
                    }
                }
                false
            } else {
                let rest = &pat[1..];
                for i in 0..=val.len() {
                    if i > 0 && val[i - 1] == b'/' {
                        break;
                    }
                    if glob_match_impl(rest, &val[i..]) {
                        return true;
                    }
                }
                false
            }
        }
        b'?' => !val.is_empty() && val[0] != b'/' && glob_match_impl(&pat[1..], &val[1..]),
        c => !val.is_empty() && val[0] == c && glob_match_impl(&pat[1..], &val[1..]),
    }
}

fn glob_match(pattern: &str, value: &str) -> bool {
    glob_match_impl(pattern.as_bytes(), value.as_bytes())
}

/// Apply one raw ignore rule to a project-relative posix path
/// (loosely mirrors the .gitignore subset KRun documents).
fn rule_matches(raw: &str, rel_posix: &str) -> bool {
    let anchored = raw.starts_with('/');
    let pat = raw.trim_start_matches('/').trim_end_matches('/');
    if pat.is_empty() {
        return false;
    }
    if anchored {
        if glob_match(pat, rel_posix) {
            return true;
        }
        // anchored directory: also match everything beneath it
        return !(pat.contains('*') || pat.contains('?'))
            && rel_posix.starts_with(&format!("{}/", pat));
    }
    if !pat.contains('/') {
        // unanchored, single segment: matches any path component
        return rel_posix.split('/').any(|part| glob_match(pat, part));
    }
    // mid-path prefix: match the path itself or anything beneath the dir
    if glob_match(pat, rel_posix) {
        return true;
    }
    !(pat.contains('*') || pat.contains('?')) && rel_posix.starts_with(&format!("{}/", pat))
}

/// Mandatory excludes first (never overridable), then user rules
/// from the root `.gitignore` / `.aloignore` with last-match-wins negation.
fn path_ignored(rel_posix: &str, user_rules: &[String]) -> bool {
    for d in DEFAULT_IGNORES {
        if rule_matches(d, rel_posix) {
            return true;
        }
    }
    let mut ignored = false;
    for raw in user_rules {
        let (negate, pat) = match raw.strip_prefix('!') {
            Some(rest) => (true, rest),
            None => (false, raw.as_str()),
        };
        if rule_matches(pat, rel_posix) {
            ignored = !negate;
        }
    }
    ignored
}

fn read_ignore_rules(root: &Path) -> Vec<String> {
    let mut rules = Vec::new();
    for name in [".gitignore", ".aloignore"] {
        if let Ok(content) = fs::read_to_string(root.join(name)) {
            for line in content.lines() {
                let line = line.trim();
                if line.is_empty() || line.starts_with('#') {
                    continue;
                }
                rules.push(line.to_string());
            }
        }
    }
    rules
}

/// Walk the project root, pruning ignored/symlinked dirs. Returns
/// (sorted relative posix files, file_count, total_bytes, user_rules).
fn collect_project_files(
    root: &Path,
) -> Result<(Vec<(String, PathBuf)>, u64, u64, Vec<String>), String> {
    let rules = read_ignore_rules(root);
    let mut files: Vec<(String, PathBuf)> = Vec::new();

    fn walk(
        rel_prefix: &str,
        dir: &Path,
        rules: &[String],
        files: &mut Vec<(String, PathBuf)>,
    ) -> Result<(), String> {
        let entries = fs::read_dir(dir)
            .map_err(|e| format!("Failed to read {}: {}", dir.display(), e))?;
        for entry in entries {
            let entry = entry.map_err(|e| format!("Bad entry in {}: {}", dir.display(), e))?;
            let path = entry.path();
            if path.is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let rel = if rel_prefix.is_empty() {
                name.clone()
            } else {
                format!("{}/{}", rel_prefix, name)
            };
            if path.is_dir() {
                if !path_ignored(&rel, rules) {
                    walk(&rel, &path, rules, files)?;
                }
            } else if path.is_file() && !path_ignored(&rel, rules) {
                files.push((rel, path));
            }
        }
        Ok(())
    }

    walk("", root, &rules, &mut files)?;
    files.sort_by(|a, b| a.0.cmp(&b.0));
    let file_count = files.len() as u64;
    let total_bytes: u64 = files
        .iter()
        .map(|(_, abs)| fs::metadata(abs).map(|m| m.len()).unwrap_or(0))
        .sum();
    Ok((files, file_count, total_bytes, rules))
}

fn top_largest(files: &[(String, PathBuf)], n: usize) -> String {
    let mut sized: Vec<(u64, &str)> = files
        .iter()
        .map(|(rel, abs)| (fs::metadata(abs).map(|m| m.len()).unwrap_or(0), rel.as_str()))
        .collect();
    sized.sort_by(|a, b| b.0.cmp(&a.0));
    sized
        .into_iter()
        .take(n)
        .map(|(size, rel)| format!("{} ({} bytes)", rel, size))
        .collect::<Vec<_>>()
        .join(", ")
}

#[tauri::command]
pub async fn kaggle_scan_project(project_root: String) -> Result<KaggleProjectScan, String> {
    info!("Scanning local project for alo-run: {}", project_root);
    let root = PathBuf::from(project_root.trim());
    if project_root.trim().is_empty() || !root.is_dir() {
        return Err(format!("Not a folder: {}", project_root.trim()));
    }
    let (files, file_count, total_bytes, _) = collect_project_files(&root)?;
    let rels: Vec<String> = files.iter().map(|(rel, _)| rel.clone()).collect();

    let mut warnings = Vec::new();
    if total_bytes > MAX_PACKAGE_BYTES {
        warnings.push(format!(
            "Project is over the 20 MB limit — trim large files or attach data via datasets. Largest: {}",
            top_largest(&files, 3)
        ));
    }
    if file_count == 0 {
        warnings.push(
            "No files left after ignore rules — check .gitignore/.aloignore in the project".to_string(),
        );
    }

    Ok(KaggleProjectScan {
        root: root.display().to_string(),
        file_count,
        total_bytes,
        entrypoints: rels
            .iter()
            .filter(|r| r.to_ascii_lowercase().ends_with(".py"))
            .take(300)
            .cloned()
            .collect(),
        requirements: rels
            .iter()
            .find(|r| r.eq_ignore_ascii_case("requirements.txt"))
            .cloned()
            .unwrap_or_default(),
        pyproject: rels
            .iter()
            .find(|r| r.eq_ignore_ascii_case("pyproject.toml"))
            .cloned()
            .unwrap_or_default(),
        over_limit: total_bytes > MAX_PACKAGE_BYTES,
        warnings,
    })
}

fn valid_module_name(m: &str) -> bool {
    !m.is_empty()
        && m.split('.')
            .all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '_'))
}

/// Sanitize + validate the run config (paths normalized to posix separators).
fn normalize_run_config(config: KaggleRunProjectConfig) -> Result<KaggleRunProjectConfig, String> {
    let mut c = config;
    c.title = c.title.trim().to_string();
    c.slug = c.slug.trim().to_lowercase().replace('_', "-");
    c.entrypoint = c.entrypoint.trim().replace('\\', "/");
    c.requirements = c.requirements.trim().replace('\\', "/");

    if c.title.chars().count() < 5 {
        return Err("Title must be at least 5 characters".to_string());
    }
    if !c.slug.is_empty()
        && !c
            .slug
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '-')
    {
        return Err("Slug may only contain lowercase letters, numbers and dashes".to_string());
    }
    if c.slug.starts_with('-') || c.slug.ends_with('-') {
        return Err("Slug may not start or end with a dash".to_string());
    }

    let script_mode = !c.entrypoint.is_empty();
    let module_mode = !c.module.trim().is_empty();
    if script_mode == module_mode {
        return Err("Provide either an entrypoint file (script) or a module name (-m)".to_string());
    }
    if script_mode && !c.entrypoint.ends_with(".py") {
        return Err("Entrypoint must be a .py file".to_string());
    }
    if module_mode {
        let m = c.module.trim().to_string();
        if !valid_module_name(&m) {
            return Err("Module name must look like 'my_pkg' or 'my_pkg.main'".to_string());
        }
        c.module = m;
    }

    // datasets: each must be owner/slug
    for ds in &c.dataset_sources {
        let parts: Vec<&str> = ds.split('/').collect();
        if parts.len() != 2 || parts[0].is_empty() || parts[1].is_empty() {
            return Err(format!("Dataset source must be owner/slug, got '{}'", ds));
        }
    }
    // packages: none may look like a pip option
    for pkg in &c.extra_packages {
        if pkg.trim().is_empty() {
            return Err("Extra packages contain an empty item".to_string());
        }
        if pkg.starts_with('-') {
            return Err(format!("Extra package '{}' looks like a pip option", pkg));
        }
    }
    // secrets: identifiers only
    for s in &c.secrets {
        if !s.is_empty()
            && (s.starts_with(|c: char| c.is_ascii_digit())
                || !s
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || ch == '_'))
        {
            return Err(format!("Secret name '{}' is not a valid identifier", s));
        }
    }
    // outputs: project-relative, not root
    let mut outputs = Vec::new();
    for raw in &c.output_paths {
        let o = raw.trim().trim_matches('/').to_string();
        if o.is_empty() || o == "." {
            return Err(format!(
                "Output path '{}' must name a folder inside the project",
                raw
            ));
        }
        if Path::new(&o).is_absolute() || o.split('/').any(|p| p == "..") {
            return Err(format!("Output path must stay inside the project: {}", o));
        }
        if !outputs.contains(&o) {
            outputs.push(o);
        }
    }
    if outputs.is_empty() {
        outputs.push("outputs".to_string()); // KRun-style default collection folder
    }
    c.output_paths = outputs;
    Ok(c)
}

fn sha256_hex(bytes: &[u8]) -> String {
    use sha2::Digest;
    let mut hasher = sha2::Sha256::new();
    hasher.update(bytes);
    hasher.finalize().iter().map(|b| format!("{:02x}", b)).collect()
}

struct RunnerDeps {
    entrypoint: String,
    module: String,
    module_path: String,
    args: Vec<String>,
    requirements: Option<String>,
    dep_project: Option<String>,
    extra_packages: Vec<String>,
    secrets: Vec<String>,
    outputs: Vec<String>,
}

fn json_or_null(v: Option<&str>) -> String {
    match v {
        Some(s) => serde_json::to_string(s).unwrap_or_else(|_| "null".to_string()),
        None => "null".to_string(),
    }
}

fn render_run_runner(payload: &str, archive: Option<(&str, &str)>, deps: &RunnerDeps) -> String {
    let template = include_str!("kaggle_runner_template.py");
    let json_str = |s: &str| serde_json::to_string(s).unwrap_or_else(|_| "\"\"".to_string());
    let json_arr = |v: &[String]| serde_json::to_string(v).unwrap_or_else(|_| "[]".to_string());

    let entrypoint_json = json_str(&deps.entrypoint);
    let module_json = if deps.module.is_empty() {
        "null".to_string()
    } else {
        json_str(&deps.module)
    };
    let module_path_json = json_str(&deps.module_path);
    let args_json = json_arr(&deps.args);
    let requirements_json = json_or_null(deps.requirements.as_deref());
    let dep_project_json = json_or_null(deps.dep_project.as_deref());
    let extras_json = json_arr(&deps.extra_packages);
    let secrets_json = json_arr(&deps.secrets);
    let outputs_json = json_arr(&deps.outputs);

    let base = template
        .replace("@@PAYLOAD@@", payload)
        .replace("@@ENTRYPOINT@@", &entrypoint_json)
        .replace("@@MODULE@@", &module_json)
        .replace("@@MODULE_PATH@@", &module_path_json)
        .replace("@@ARGS@@", &args_json)
        .replace("@@REQUIREMENTS@@", &requirements_json)
        .replace("@@DEP_PROJECT@@", &dep_project_json)
        .replace("@@EXTRA_PACKAGES@@", &extras_json)
        .replace("@@SECRET_NAMES@@", &secrets_json)
        .replace("@@OUTPUTS@@", &outputs_json);

    match archive {
        Some((name, digest)) => {
            let name_json = json_str(name);
            let digest_json = json_str(digest);
            base.replace("@@ARCHIVE_NAME@@", &name_json)
                .replace("@@ARCHIVE_DIGEST@@", &digest_json)
        }
        None => base
            .replace("@@ARCHIVE_NAME@@", "null")
            .replace("@@ARCHIVE_DIGEST@@", "null"),
    }
}

fn build_archive(_root: &Path, files: &[(String, PathBuf)]) -> Result<Vec<u8>, String> {
    use flate2::write::GzEncoder;
    let gz = GzEncoder::new(Vec::new(), flate2::Compression::default());
    let mut builder = tar::Builder::new(gz);
    for (rel, abs) in files {
        let mut file = fs::File::open(abs)
            .map_err(|e| format!("Failed to open {}: {}", rel, e))?;
        builder
            .append_file(Path::new(rel), &mut file)
            .map_err(|e| format!("Failed to archive {}: {}", rel, e))?;
    }
    builder
        .into_inner()
        .map_err(|e| format!("Failed to finalize archive: {}", e))?
        .finish()
        .map_err(|e| format!("Failed to compress archive: {}", e))
}

fn prepare_runs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data dir: {}", e))?;
    let runs_root = base.join("kaggle").join("runs");
    fs::create_dir_all(&runs_root)
        .map_err(|e| format!("Failed to create {}: {}", runs_root.display(), e))?;

    // Opportunistic cleanup: drop run dirs older than 24h
    if let Ok(entries) = fs::read_dir(&runs_root) {
        if let Some(cutoff) = SystemTime::now().checked_sub(std::time::Duration::from_secs(86_400))
        {
            for e in entries.filter_map(|e| e.ok()) {
                let p = e.path();
                if p.is_dir() {
                    if let Ok(md) = e.metadata() {
                        if let Ok(modified) = md.modified() {
                            if modified < cutoff {
                                let _ = fs::remove_dir_all(&p);
                            }
                        }
                    }
                }
            }
        }
    }

    let dir = runs_root.join(format!("{}-{}", now_unix(), uuid::Uuid::new_v4().simple()));
    fs::create_dir_all(&dir)
        .map_err(|e| format!("Failed to create run dir: {}", e))?;
    Ok(dir)
}

/// `kaggle datasets status <id>` until "ready" (CLI >= 2.2, same contract as KRun).
fn wait_package_dataset(
    app: &AppHandle,
    account_id: &str,
    dataset_id: &str,
) -> Result<(), String> {
    let deadline_and_attempt = 120usize; // 120 * 5s = 10 min
    for attempt in 0..deadline_and_attempt {
        let out = run_command(
            kaggle_command_for_account(app, account_id)?,
            &["datasets", "status", dataset_id],
        )?;
        let raw = String::from_utf8_lossy(&out.stdout)
            .trim()
            .to_lowercase()
            .to_string();
        if raw == "ready" {
            return Ok(());
        }
        let in_progress = ["queued", "processing", "not_yet_persisted", "blobs_received",
            "blobs_decompressed", "blobs_copied_to_sds", "individual_blobs_compressed",
            "reprocessing"];
        if !out.status.success() || !in_progress.iter().any(|w| raw.contains(w)) {
            if attempt + 1 < 3 && (raw.contains("timeout") || raw.contains("connection")) {
                std::thread::sleep(std::time::Duration::from_secs(3));
                continue;
            }
            let stderr = String::from_utf8_lossy(&out.stderr).trim().to_string();
            return Err(format!(
                "Package dataset {} is not ready (status: {})",
                dataset_id,
                if stderr.is_empty() { raw } else { stderr }
            ));
        }
        std::thread::sleep(std::time::Duration::from_secs(5));
    }
    Err(format!(
        "Timed out waiting for package dataset {}. Check it on Kaggle before retrying.",
        dataset_id
    ))
}

/// Upload the archive as a private per-job dataset (only for large projects).
fn upload_package_dataset(
    app: &AppHandle,
    account_id: &str,
    username: &str,
    dataset_dir: &Path,
) -> Result<String, String> {
    let dataset_slug = format!("alogpu-run-{}", now_unix());
    let dataset_id = format!("{}/{}", username, dataset_slug);
    let metadata = serde_json::json!({
        "id": dataset_id,
        "title": dataset_slug.replace('-', " "),
        "licenses": [{ "name": "other" }],
        "description": "Private AloGPU run package. Do not edit or delete while the run exists.",
    });
    let raw = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize dataset-metadata.json: {}", e))?;
    secure_write(&dataset_dir.join("dataset-metadata.json"), &raw)?;

    let out = run_command(
        kaggle_command_for_account(app, account_id)?,
        &["datasets", "create", "-p", dataset_dir.display().to_string().as_str()],
    )?;
    if !out.status.success() {
        let stdout = String::from_utf8_lossy(&out.stdout);
        let stderr = String::from_utf8_lossy(&out.stderr);
        return Err(format!(
            "AloGPU package dataset upload failed: {}{}",
            stdout.trim(),
            stderr.trim()
        ));
    }
    wait_package_dataset(app, account_id, &dataset_id)?;
    Ok(dataset_id)
}

fn run_project_blocking(
    app: AppHandle,
    account_id: String,
    project_root: String,
    config: KaggleRunProjectConfig,
) -> Result<KaggleRunProjectResult, String> {
    let started = std::time::Instant::now();
    info!(
        "AloRun: account={}, root={}, title={}",
        account_id, project_root, config.title
    );

    let config = normalize_run_config(config)?;
    let root = PathBuf::from(project_root.trim());
    if project_root.trim().is_empty() || !root.is_dir() {
        return Err(format!("Project root folder not found: {}", root.display()));
    }

    let (files, file_count, total_bytes, _) = collect_project_files(&root)?;
    if files.is_empty() {
        return Err(
            "No files were collected from the project — check ignore rules".to_string(),
        );
    }
    if total_bytes > MAX_PACKAGE_BYTES {
        return Err(format!(
            "Project exceeds the 20 MB package limit. Largest files: {}. \
             Trim large inputs or attach them via Kaggle datasets instead.",
            top_largest(&files, 5)
        ));
    }

    // Validate entrypoint/module against the collected file list
    let rels: std::collections::HashSet<String> =
        files.iter().map(|(r, _)| r.clone()).collect();
    let mut module_path = ".".to_string();
    let (run_entrypoint, run_module) = if !config.entrypoint.is_empty() {
        if !rels.contains(&config.entrypoint) {
            return Err(format!(
                "Entrypoint '{}' was excluded by ignore rules or does not exist",
                config.entrypoint
            ));
        }
        (config.entrypoint.clone(), String::new())
    } else {
        let m = config.module.trim();
        let mod_dir = m.replace('.', "/");
        let candidates: [(&str, String); 4] = [
            ("", format!("{}/__main__.py", mod_dir)),
            ("", format!("{}.py", mod_dir)),
            ("src", format!("{}/__main__.py", mod_dir)),
            ("src", format!("{}.py", mod_dir)),
        ];
        let mut found = None;
        for (base, rel) in candidates.iter() {
            let base = if base.is_empty() {
                String::new()
            } else {
                format!("{}/", base)
            };
            let full = format!("{}{}", base, rel);
            if rels.contains(&full) {
                found = Some((base, full));
                break;
            }
        }
        match found {
            Some((base, _full)) => {
                module_path = if base.is_empty() { "." } else { "src" }.to_string();
                (m.to_string(), m.to_string())
            }
            None => {
                return Err(format!(
                    "Module '{}' not found: expected {}.py/{}__main__.py in project root or src/",
                    m, mod_dir, mod_dir
                ));
            }
        }
    };
    // (run_entrypoint doubles as argv[0]; run_module is empty in script mode)

    // Validate dependency file
    let mut requirements: Option<String> = None;
    let mut dep_project: Option<String> = None;
    if !config.requirements.is_empty() && !rels.contains(&config.requirements) {
        return Err(format!(
            "Dependency file '{}' was excluded by ignore rules or does not exist",
            config.requirements
        ));
    }
    if config.requirements.ends_with(".toml") {
        dep_project = if config.requirements.contains('/') {
            Some(
                Path::new(&config.requirements)
                    .parent()
                    .map(|p| p.display().to_string().replace('\\', "/"))
                    .unwrap_or_else(|| ".".to_string()),
            )
        } else {
            Some(".".to_string())
        };
    } else if !config.requirements.is_empty() {
        requirements = Some(config.requirements.clone());
    }

    let deps_needing_net = requirements.is_some()
        || dep_project.is_some()
        || !config.extra_packages.is_empty();
    if deps_needing_net && !config.enable_internet {
        return Err(
            "Internet is OFF but dependencies were declared — pip cannot install them \
             without internet. Enable internet or drop the dependency config."
                .to_string(),
        );
    }

    let deps = RunnerDeps {
        entrypoint: run_entrypoint,
        module: run_module,
        module_path,
        args: config.args.iter().map(|a| a.trim().to_string()).filter(|a| !a.is_empty()).collect(),
        requirements,
        dep_project,
        extra_packages: config
            .extra_packages
            .iter()
            .map(|p| p.trim().to_string())
            .filter(|p| !p.is_empty())
            .collect(),
        secrets: config.secrets.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect(),
        outputs: config.output_paths.clone(),
    };

    let username = resolve_username_for(&app, &account_id)?;
    let runs_dir = prepare_runs_dir(&app)?;
    let workspace = runs_dir.join("workspace");
    let result: Result<KaggleRunProjectResult, String> = (|| {
        let archive = build_archive(&root, &files)?;
        use base64::Engine as _;
        let payload_initial = base64::engine::general_purpose::STANDARD.encode(&archive);

        let mut runner = render_run_runner(&payload_initial, None, &deps);
        let mut transport = "embedded".to_string();
        let mut attached: Vec<String> = config.dataset_sources.clone();

        if runner.len() >= MAX_RUNNER_BYTES {
            // Large project: ship the archive as a private per-job dataset.
            let digest = sha256_hex(&archive);
            let dataset_dir = runs_dir.join("dataset");
            fs::create_dir_all(&dataset_dir)
                .map_err(|e| format!("Failed to create dataset dir: {}", e))?;
            let archive_name = format!("alogpu-{}.bin", &digest[..16]);
            fs::write(dataset_dir.join(&archive_name), &archive)
                .map_err(|e| format!("Failed to write package archive: {}", e))?;
            let dataset_id = upload_package_dataset(&app, &account_id, &username, &dataset_dir)?;
            attached.insert(0, dataset_id.clone());
            transport = format!("private_dataset:{}", dataset_id);
            runner = render_run_runner("", Some((archive_name.as_str(), digest.as_str())), &deps);
            if runner.len() >= HARD_RUNNER_BYTES {
                return Err(
                    "Runner exceeds Kaggle's ~1 MB source limit — reduce arguments/configuration"
                        .to_string(),
                );
            }
        }

        fs::create_dir_all(&workspace)
            .map_err(|e| format!("Failed to create workspace dir: {}", e))?;
        fs::write(workspace.join("runner.py"), &runner)
            .map_err(|e| format!("Failed to write runner.py: {}", e))?;

        // kernel-metadata.json — mirrors kaggle_kernel_push (machine_shape)
        let mut metadata = serde_json::json!({
            "id": format!("{}/{}", username, config.slug),
            "title": config.title,
            "code_file": "runner.py",
            "language": "python",
            "kernel_type": "script",
            "is_private": true,
            "enable_internet": config.enable_internet,
            "dataset_sources": attached,
            "kernel_sources": [],
        });
        if !config.accelerator.is_empty() {
            metadata["machine_shape"] = serde_json::Value::String(config.accelerator.clone());
        }
        let metadata_raw = serde_json::to_string_pretty(&metadata)
            .map_err(|e| format!("Failed to serialize kernel-metadata.json: {}", e))?;
        secure_write(&workspace.join("kernel-metadata.json"), &metadata_raw)?;

        let mut args: Vec<String> = vec![
            "kernels".to_string(),
            "push".to_string(),
            "-p".to_string(),
            workspace.display().to_string(),
        ];
        if config.no_run {
            args.push("--no-run".to_string());
        }
        let args_ref: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
        let out = run_command(kaggle_command_for_account(&app, &account_id)?, &args_ref)?;
        let stdout = String::from_utf8_lossy(&out.stdout).to_string();
        let stderr = String::from_utf8_lossy(&out.stderr).to_string();
        let success = out.status.success() && !stdout.contains("Kernel push error");
        if !success {
            let combined = if stderr.trim().is_empty() {
                stdout.trim().to_string()
            } else {
                format!("{}{}", stdout.trim(), stderr.trim())
            };
            return Err(format!("kernels push failed: {}", combined));
        }

        info!(
            "AloRun submitted {} in {}s ({} files, {} bytes, {})",
            format!("{}/{}", username, config.slug),
            started.elapsed().as_secs(),
            file_count,
            total_bytes,
            transport
        );
        Ok(KaggleRunProjectResult {
            kernel: format!("{}/{}", username, config.slug),
            title: config.title.clone(),
            transport,
            file_count,
            source_bytes: total_bytes,
            runner_bytes: runner.len(),
            message: stdout.trim().to_string(),
        })
    })();

    match result {
        Ok(res) => {
            // Cleanup temp artifacts on success
            let _ = fs::remove_dir_all(&runs_dir);
            Ok(res)
        }
        Err(e) => {
            error!("AloRun failed, keeping {} for inspection: {}", runs_dir.display(), e);
            Err(e)
        }
    }
}

#[tauri::command]
pub async fn kaggle_run_project(
    app: AppHandle,
    account_id: String,
    project_root: String,
    config: KaggleRunProjectConfig,
) -> Result<KaggleRunProjectResult, String> {
    info!("kaggle_run_project: account={}, root={}", account_id, project_root);
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        run_project_blocking(handle, account_id, project_root, config)
    })
    .await
    .map_err(|e| format!("AloRun task failed: {}", e))?
}
