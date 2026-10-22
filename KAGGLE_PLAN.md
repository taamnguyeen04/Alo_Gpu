# Plan: Kaggle Accounts Manager (Modal Desktop Manager)

> Thêm 1 nền tảng thứ 2 (Kaggle CLI) vào app, theo đúng pattern đã có của Modal.
> **Mục tiêu chính: dùng GPU 30h/tuần của Kaggle để chạy model** — không có volume/billing,
> **KHÔNG có competitions** (đã loại). Tập trung: **accounts, GPU quota, kernels (chạy + log + output), datasets (nạp data cho kernel)**.

---

## Nguyên tắc thiết kế chung

- **Per-account queries**: mọi lệnh Rust spawn `kaggle ...` gắn env của account (`KAGGLE_CONFIG_DIR` cho legacy key, `KAGGLE_API_TOKEN` cho personal token) → xem dữ liệu account nào cũng được mà không switch global. Đối chiếu: Modal đang dùng `MODAL_PROFILE`.
- **Set Active (duy nhất)**: copy `kaggle.json` của account ra `~/.kaggle/kaggle.json` (backup cũ) → lệnh `kaggle` ngoài app (terminal/script) dùng account đó.
- App **không expose key ra FE** (chỉ trả username + 4 ký tự cuối làm hint).
- CLI chưa cài → các trang hiện empty state + hướng dẫn `pipx install kaggle`.
- Fallback format: ưu tiên `--format json` (kaggle ≥2.x), fallback `-v` CSV (legacy 1.x).

---

## PHẦN 1 — BACKEND (Rust, `src-tauri/`)

### 1.1 Modul: `src-tauri/src/commands/kaggle.rs`

#### Structs (Serde Serialize + Deserialize như `Profile`)
```rust
struct KaggleAccount {
  id: String            // slug của label, dùng làm thư mục
  label: String         // tên hiển thị
  username: String      // Kaggle username (auto-detect với token mode)
  auth_method: String   // "legacy_key" | "api_token" | "oauth" (chỉ read-only detect)
  source: String        // "managed" (app quản lý) | "global" (~/.kaggle gốc)
  key_hint: String      // "••••" + 4 ký tự cuối (không bao giờ trả full key)
  is_active_global: bool
  created_at: String
}
struct KaggleQuota  { resource, used_hours, remaining_hours, total_hours, refresh_at }
struct KaggleKernel      { ref_, title, author, last_run_time, total_votes }
struct KaggleDataset     { ref_, title, last_updated, total_bytes }
```

#### Storage do app quản lý
```
<app_data_dir>/kaggle/accounts/<id>/
  account.json    // metadata: {id, label, username, authMethod, createdAt}
  kaggle.json     // {"username": "...", "key": "..."}   (LegacyKey mode — đúng format CLI cần)
  token           // nội dung = personal API token      (ApiToken mode)
```

#### Helper: `kaggle_command_for_account`
- LegacyKey: `env KAGGLE_CONFIG_DIR=<dir>` + `.env_remove("KAGGLE_API_TOKEN")` (token ưu tiên CAO hơn legacy key — phải remove).
- ApiToken: `env KAGGLE_API_TOKEN=<file>` + `.env_remove(KAGGLE_USERNAME/KAGGLE_KEY)`.
- Luôn `PYTHONIOENCODING=utf-8`; dùng lại `crate::utils::create_command()` (CREATE_NO_WINDOW Windows).

#### Danh sách Tauri commands

| Command | Logic | Trạng thái |
|---|---|---|
| `kaggle_cli_available()` | `kaggle --version` exit 0 | ✅ M1 |
| `kaggle_list_accounts()` | scan `accounts/` + read-only `~/.kaggle` (kaggle.json / credentials.json / access_token) → flag `is_active_global` | ✅ M1 |
| `kaggle_add_account(label, username, key)` | tạo dir + account.json + kaggle.json → **verify** bằng `kaggle quota -v` (fail → rollback dir) | ✅ M1 |
| `kaggle_add_token_account(label, token)` | như trên qua `KAGGLE_API_TOKEN`; username tự introspect từ `kaggle config view` | ✅ M1 |
| `kaggle_update_account(id, label)` | đổi label trong account.json | ✅ M1 |
| `kaggle_remove_account(id)` | xoá thư mục account (global → từ chối, user tự xoá) | ✅ M1 |
| `kaggle_set_active_account(id)` | backup `~/.kaggle/kaggle.json` → `.bak` rồi copy; ApiToken thì ghi `~/.kaggle/access_token` (access_token override legacy key nên phải park aside); pointer `active.json` | ✅ M1 |
| `kaggle_get_active_global()` | precedence: env token → access_token file → kaggle.json → credentials.json | ✅ M1 |
| `kaggle_quota(account_id)` | `kaggle quota --format json` (fallback `-v`) → parse `"24.5h"` → f64 | ✅ M1 |
| `kaggle_kernels(account_id)` | `kaggle kernels list -m --format json` (fallback `-v`) | M2 |
| `kaggle_kernel_status(account_id, kernel)` | `kernels status` → parse `"<kernel> has status \"...\""` (+ failure message) | M2 |
| `kaggle_kernel_logs(account_id, kernel)` | `kernels logs <owner/slug>` — plain text stdout | M2 |
| `kaggle_kernel_output_files(account_id, kernel)` | `kernels files <kernel> -v` | M2 |
| `kaggle_kernel_push(account_id, folder, config)` | tạo/tổn chỉnh `kernel-metadata.json` + `kernels push [-p] [--no-run]` | M2 |
| `kaggle_kernel_output_download(account_id, kernel, file?, path)` | `kernels output` vào thư mục user chọn | M2 |
| `kaggle_datasets(account_id)` | `datasets list -m --format json` | M3 |
| `kaggle_dataset_files / download / create / version` | nhu cầu nạp data cho kernel | M3 |
| `kaggle_auth_login` (OAuth browser flow) | interactive — optional | M4 |

### 1.2 Đăng ký
- `commands/mod.rs`: `pub mod kaggle;`
- `lib.rs`: toàn bộ handler trong `generate_handler![]`

---

## PHẦN 2 — FRONTEND (`src/`)

### 2.1 Infra layers
| File | Nội dung |
|---|---|
| `src/lib/kaggle-types.ts` | TS types 1-1 với Rust |
| `src/lib/kaggle-api.ts` | invoke wrappers |
| `src/hooks/use-kaggle.ts` | React Query hooks + keys (`kaggleAccounts`, `kaggleActiveGlobal`, `kaggleQuota`, `kaggleKernels`, `kaggleDatasets`) |
| `src/stores/kaggle-store.ts` | `accounts`, `currentAccountId` (chỉ account đang xem, KHÔNG switch global) |

localStorage caches: `kaggle_quota_<id>`, `kaggle_note_<id>`.

### 2.2 Logos
`src/components/logos/{modal,kaggle}-logo.tsx` — inline SVG `currentColor`.

### 2.3 Sidebar tách 2 khối + logo
- `types.ts`: `NavGroup.logo?`; `nav-group.tsx`: render logo cạnh group label.
- `sidebar-data.ts`:
```
navGroups: [
  { title: 'Modal',  logo: ModalLogo,  items: [Workspaces, Apps, Volumes, Secrets] },
  { title: 'Kaggle', logo: KaggleLogo, items: [Accounts, Kernels, Datasets] },
  { title: 'Tools',   items: [TensorBoard] },
  { title: 'Settings', items: [Preferences] },
]
```

### 2.4 Routes + Pages
```
src/routes/_authenticated/kaggle/
  accounts/index.tsx   → features/kaggle/accounts    ✅ M1
  kernels/index.tsx    → features/kaggle/kernels     M2
  datasets/index.tsx   → features/kaggle/datasets    M3 placeholder hiện có
```

#### Trang Accounts (✅ M1 — hoàn thành)
- Header: [Update All Quotas] [Refresh] [Add Account]; tổng **GPU Hours Left** across accounts
- Banner "CLI Active" (~/.kaggle); card grid:
  - Avatar + username + Badge authMethod + `Active` + `~/.kaggle` (global)
  - Progress GPU (amber <20%, đỏ <10%) + TPU phụ + refresh time + note
  - Menu ⋯: Set Active / Edit label / Remove (confirm)
- Dialog Add: Legacy key (username+key) hoặc Token (chỉ token, username tự detect) — [Verify & Save] verify bằng lệnh thật, sai key rollback + inline error
- Empty states: CLI chưa cài → `pipx install kaggle`; chưa có account → CTA

#### Trang Kernels (M2 — TRÍ TÂM "chạy model trên GPU")
- Header: account selector + Refresh + **[New Run]**
- List kernels `-m`: rows (title, lastRunTime, votes) + badge status snapshot
- Chọn kernel → detail 2 tab:
  - **Run/Log**: status polling 5s khi queued/running → fetch `kernels logs` (tô màu stdout/stderr); nút Restart/Re-run (push lại версии)
  - **Output**: file list `kernels files` + [Download] → dialog chọn folder
- **New Run dialog**: chọn folder local chứa notebook/script (hoặc app tự sinh `kernel-metadata.json` từ form: title, slug, language, kernel type, accelerator GPU, dataset sources) → `kernels push` (mặc định chạy luôn, có tuỳ chọn `--no-run`)

#### Trang Datasets (M3 — nạp data cho kernel)
- Bảng `-m` (ref, title, lastUpdated, size) → files list (page-token) + Download
- Upload: `datasets init` → edit metadata → `create`/`version` (folder picker + metadata form đơn giản)

---

## PHẦN 3 — Phát triển theo Milestone (định hướng GPU-only)

| Milestone | BE | FE | Deliverable |
|---|---|---|---|
| **M1** ✅ | accounts CRUD + set_active + quota | Accounts page + sidebar 2 khối + logos | Quản lý accounts + giám sát quota GPU |
| **M2** (chủ lực) ✅ | kernels list/status/logs/files + push + output download | Kernels page: list, log viewer (polling), New Run dialog, Output download | **Chạy model trên GPU + theo dõi như Apps bên Modal** |
| **M3** ✅ | datasets list/files/download/create/version | Datasets page + files dialog + upload (new/version) | Nạp data cho kernels |
| **M4** (optional) | OAuth `auth login`, `benchmarks quota` | Nút Login browser, dòng spend USD | Bổ sung |
| **CLI bổ trợ (`alo-run`)** ✅ | Tool ngoài app: `C:\Users\tam\Documents\alo-tools\alo-run.py` + shim `alo-run.cmd` (PATH) | — | **GHÉ GIỐNG `modal run`: 1 lệnh push + stream log live + tải output** |

### alo-run — CLI Modal-style (đã test thật end-to-end trên T4 ✅)
- Auth: đọc account **Active trong app** (`%APPDATA%\com.alogpu.app\kaggle\active.json`; chỉ 1 account mà chưa Set Active thì tự dùng; nhiều account → `--account <label>` hoặc bấm Set Active trong app).
- Push: gọi **Python API trực tiếp** (`kaggle.api.kaggle_api_extended.KaggleApi`) chứ không qua CLI con — metadata `id` **bắt buộc `{username}/{slug}`** (bare slug → server báo `Invalid slug`).
- Log live: dùng `api.kernels_logs_stream()` — SSE `/kernels/logs/stream/{owner}/{slug}` khi đang chạy; xong trả về GCS blob.
- Status: `kernels_status()` trả **enum v2** (`KernelWorkerStatus.COMPLETE`) — phải chuẩn hoá sang lowercase; không phải chuỗi như CLI 1.x.
- Output: `kernels_output(..., force=True)` vào `<code folder>/alo-output`; log dạng JSON events `{stream_name,time,data}`.
- Cách dùng: `alo-run file.py|--acc|--cpu|--dataset|--out|--no-push|--no-watch`; rerun = version mới cùng slug; Ctrl+C = detach, reattach bằng `--no-push`.

## File checklist lần này (M1)
- [x] `src-tauri/src/commands/kaggle.rs` (core ~700 dòng)
- [x] `commands/mod.rs` + `lib.rs` (register 9 commands)
- [x] `src/lib/kaggle-types.ts`, `kaggle-api.ts`, `src/hooks/use-kaggle.ts`, `src/stores/kaggle-store.ts`
- [x] `src/components/logos/{modal,kaggle}-logo.tsx`; `types.ts` + `nav-group.tsx` (logo label); `sidebar-data.ts`
- [x] `src/features/kaggle/accounts/` (index + card + 2 dialogs) + route
- [x] Placeholder `features/kaggle/{kernels,datasets}` + routes

## File checklist (M2 ✅ + M3 ✅)
- [x] BE: `kaggle_kernels`, `kaggle_kernel_status/logs/output_files`, `kaggle_kernel_push` (sinh `kernel-metadata.json`, machine_shape), `kaggle_kernel_output_download`, `kaggle_list_folder_files` — đã register
- [x] BE: `kaggle_datasets`, `kaggle_dataset_files`, `kaggle_dataset_download` (unzip), `kaggle_dataset_create` (sinh `dataset-metadata.json`), `kaggle_dataset_version` — đã register
- [x] FE: types/api/hooks cho kernels + datasets; log viewer poll 5s khi running; account picker dùng chung `currentAccountId`
- [x] FE: `features/kaggle/kernels/` (index + kernel-viewer + new-run-dialog); `features/kaggle/datasets/` (index + dataset-files-dialog + upload-dataset-dialog + fmt.ts)
