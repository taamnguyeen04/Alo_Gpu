# AloGPU

Ứng dụng desktop quản lý các dịch vụ ML cloud của bạn: **Modal** (workspaces, apps, volumes, secrets, TensorBoard, billing) và **Kaggle** (GPU miễn phí để chạy model — accounts, quota, kernels, datasets). Mỗi nền tảng có khối riêng trên sidebar với logo riêng.

Phía backend Rust không gọi API trực tiếp mà bọc CLI:

- **Modal CLI** (`modal`) — tự động đổi workspace qua biến môi trường `MODAL_PROFILE` → mọi hành động đều dùng đúng profile/modal account đã đăng nhập trên máy bạn.
- **Kaggle CLI** (`kaggle` ≥ 2.2) — mỗi account chạy trong env cách ly riêng (`KAGGLE_CONFIG_DIR` cho legacy key, `KAGGLE_API_TOKEN` cho personal token), không ảnh hưởng nhau.

Được xây dựng trên **Tauri 2 + React + shadcn/ui** (dựa trên template [shadcn-admin](https://github.com/satnaing/shadcn-admin)).

## ✨ Tính năng

- **Workspaces** — xem tất cả Modal profiles, credits còn lại của từng workspace, ghi chú tự lưu, đổi profile bằng 1 click, sort theo tên/credits
- **Apps** — danh sách apps, xem logs live (tự động refetch + tích lũy, tìm overlap tránh mất log), xóa app, ước lượng thời lượng train từ GPU đang dùng & credits
- **Volumes** — duyệt/tải/xóa file trong volume, upload file & thư mục, tạo/xóa volume
- **Secrets** — tạo secret với key/value, xóa secret
- **TensorBoard** — chọn thư mục log cục bộ, app tự khởi động TensorBoard local và nhúng iframe
- **GPU Pricing / Billing** — tra giá GPU theo giờ, cập nhật costs hàng loạt cho mọi workspace

### Kaggle — GPU miễn phí để chạy model

- **Accounts** — dán username + legacy API key _hoặc_ personal API token (verify thật ngay khi thêm); key chỉ lưu trong app data, UI chỉ nhận `••••` + 4 ký tự cuối; **Set Active** để mọi lệnh Kaggle ngoài app (terminal/script) dùng account đó; tự nhận diện account `~/.kaggle` toàn cục (read-only)
- **Quota** — GPU/TPU hours còn lại trong tuần (`quota --format json`, fallback CSV cho CLI 1.x), bấm **Update All Quotas** tải quota cho tất cả account
- **Kernels** — chạy model trên GPU Kaggle: **New Run** chọn folder chứa `.py`/`.ipynb` + accelerator (T4 x2 / L4 / A100 / H100 / TPU), xem status + log (poll 5s khi running), tải output về máy; rerun = version mới cùng slug
- **Run Project (alo-run)** — chạy **project Python local kiểu `modal run`**: chọn project root + entrypoint (hoặc `-m module`), app tự đóng gói toàn bộ source (tôn trọng `.gitignore`/`.aloignore`, bo <20MB) thành `runner.py` sinh ra tự động — **tự `pip install` requirements.txt / pyproject.toml / `--package` ngay trên Kaggle**, hỗ trợ dataset attach, Kaggle secrets, script args, output folder; project lớn thì tự tải package lên **private dataset** riêng rồi attach (kỹ thuật giống [KRun](https://github.com/nhminh107/KRun-PyProjectOnKaggle)). Sau khi submit tự mở kernel viewer theo log + tải output
- **Datasets** — upload folder thành dataset (mới hoặc version mới với notes bắt buộc), duyệt/tải files (unzip tuỳ chọn) làm nguồn data cho kernel

## 📋 Yêu cầu hệ thống

| Thành phần                                               | Yêu cầu                      | Ghi chú                                                                        |
| -------------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| Hệ điều hành                                             | Windows 10/11                | Bundle hiện là MSI/NSIS, TensorBoard dùng `taskkill` (Windows-only)            |
| Node.js                                                  | ≥ 20.19 (khuyến nghị LTS 22) | kèm npm 10+                                                                    |
| Rust                                                     | stable ≥ 1.77.2              | cài qua [rustup](https://rustup.rs/)                                           |
| VS C++ Build Tools                                       | bắt buộc trên Windows        | để compile Tauri (xem [prerequisites](https://tauri.app/start/prerequisites/)) |
| [Modal CLI](https://modal.com/docs/reference/cli)        | mới nhất                     | `pip install modal` rồi `modal setup` để đăng nhập                             |
| [Kaggle CLI](https://github.com/Kaggle/kaggle-api) ≥ 2.2 | tuỳ chọn                     | chỉ cần khi dùng tab Kaggle: `pip install kaggle`                              |
| Python + TensorBoard                                     | tùy chọn                     | chỉ cần khi dùng tab TensorBoard: `pip install tensorboard`                    |

Kiểm tra đã đủ điều kiện:

```bash
node -v          # >= 20.19
cargo --version  # >= 1.77
modal profile list  # phải trả về ít nhất 1 profile đã login
kaggle --version    # >= 2.2 (nếu dùng tab Kaggle)
```

## 🚀 Cài đặt

```bash
# 1. Clone repo
git clone https://github.com/taamnguyeen04/Alo_Gpu.git
cd Alo_Gpu

# 2. Cài dependencies frontend
npm install
```

### Chế độ phát triển (desktop app)

```bash
npm run tauri:dev
```

Lệnh này sẽ khởi động Vite dev server ở `localhost:5173` và mở cửa sổ app Tauri phía trên. Với app desktop, luôn chạy qua `npm run tauri:dev` (không dùng `npm run dev` một mình vì thiếu backend Rust).

### Chạy riêng phần UI (frontend only)

```bash
npm run dev
```

Xem UI trên browser tại `http://localhost:5173` — các nút cần Tauri invoke sẽ báo lỗi (bình thường, vì không có backend desktop).

## 🧠 Dùng tab Kaggle (quickstart)

> **Lưu ý**: Kaggle bắt buộc **verify số điện thoại** trên tài khoản trước khi cho phép dùng GPU/Internet trong notebook.

1. **Accounts** → **Add Account** → dán username + legacy API key, hoặc chỉ cần personal API token (Kaggle → Settings → API → Create New Token). App verify thật bằng lệnh `quota` ngay — sai key sẽ tự rollback.
2. **Update All Quotas** → xem GPU/TPU hours còn lại của tuần (30h GPU / 20h TPU là mức mặc định Kaggle).
3. **Kernels → Run Project** (khuyến khích — kiểu `modal run`) → chọn project root Python của bạn:
   - Entrypoint chọn file `.py` (mặc định ưu tiên `main.py`/`train.py`/`app.py`/`run.py`), hoặc bật **Run as module (-m)** cho `python -m my_pkg`
   - App tự đóng gói project (tôn trọng `.gitignore`/`.aloignore`, giới hạn 20MB) → tự cài `requirements.txt` / `pyproject.toml` / extra pip packages **trên Kaggle**
   - Chọn accelerator + internet, thêm dataset attach (`user/my-data`), secrets, script args (`--epochs 10`...), output folder (mặc định `outputs`)
   - **Chạy trên Kaggle** → viewer tự mở theo status + log → **Output** tải `alo_outputs/...` về máy
4. **Kernels → New Run** → đẩy 1 file code đơn lẻ `.py`/`.ipynb` (Type tự nhận Script/Notebook, vẫn chỉnh tay được), kèm `kernel-metadata.json` sinh sẵn trong folder — hợp khi chỉ muốn push đúng 1 file mà không cần đóng gói cả project
5. Quy tắc Kaggle: mọi file save vào thư mục làm việc (`/kaggle/working`) thành **kernel output** — ở app chỉ cần bấm tải về là có `model.pt`, metrics...

### `alo-run` — 1 lệnh kiểu `modal run` (CLI bổ trợ, ngoài app)

CLI `alo-run.py` nằm ngoài repo (ví dụ `%USERPROFILE%\Documents\alo-tools\alo-run.py`) — push + **stream log live** + tự tải output về, dùng đúng account **Active** của app (không nhập lại key). Cách cài shim vào PATH:

```powershell
# tạo alo-run.cmd trong 1 thư mục đã có trên PATH, ví dụ Python\Scripts
Set-Content "$env:LOCALAPPDATA\Programs\Python\Python311\Scripts\alo-run.cmd" `
  '@python -u "%~dp0..\..\Documents\alo-tools\alo-run.py" %*'
```

Hoặc chạy trực tiếp: `python tools\alo-run.py <file.py|.ipynb|folder>`. Một số cách dùng:

```bash
alo-run train_script.py                     # GPU T4 x2 mặc định
alo-run train_script.py --acc NvidiaH100    # GPU mạnh hơn
alo-run train_script.py --cpu               # phiên bản CPU
alo-run train_script.py --dataset user/my-data   # mount /kaggle/input/my-data
alo-run train_script.py --no-push           # reattach — xem lại log run đang chạy
alo-run train_script.py --no-watch          # chỉ push rồi thoát
```

Rerun cùng slug = **version mới**; `Ctrl+C` = detach (run vẫn chạy trên Kaggle) — reattach bằng `--no-push`. Output mặc định về `<code folder>/alo-output/`.

## 📦 Build bản release

```bash
npm run tauri:build
```

Kết quả:

- Binary: `src-tauri/target/release/alogpu.exe`
- Installer: `src-tauri/target/release/bundle/` (MSI + NSIS `.exe`)

Build tự động chạy **typecheck** (`tsc -b`) trước khi đóng gói theo cấu hình `build` hiện tại.

## 🧪 Kiểm thử / Lint

```bash
npm run test:browser:install   # cài Chromium cho Playwright (lần đầu)
npm test                       # chạy vitest (browser mode)
npm run lint                   # eslint
npm run format:check           # prettier --check
```

## 🛠️ Scripts

| Script                                                  | Mô tả                                |
| ------------------------------------------------------- | ------------------------------------ |
| `npm run dev`                                           | Vite dev server (frontend only)      |
| `npm run tauri:dev`                                     | Chạy desktop app ở chế độ dev        |
| `npm run tauri:build`                                   | Build app + installer (MSI/NSIS)     |
| `npm run build`                                         | Typecheck + build frontend (`dist/`) |
| `npm run lint`                                          | ESLint                               |
| `npm run format` / `format:check`                       | Prettier                             |
| `npm test` (+ `test:watch`, `test:ui`, `test:coverage`) | Vitest browser mode                  |

## 📁 Cấu trúc chính

```
src-tauri/                  # Backend Tauri (Rust)
  src/commands/             # Từng nhóm lệnh: app, volume, secret, billing, tensorboard, profile, system
  tauri.conf.json           # Cấu hình cửa sổ, bundle, plugins
src/features/               # Các màn hình (workspaces, apps-modal, volumes, secrets, tensorboard, settings, dashboard, errors)
src/hooks/use-modal.ts      # React Query hooks gọi Tauri invoke
src/lib/modal-api.ts        # Wrapper invoke + types (modal-types.ts)
src/routes/                 # TanStack Router (file-based)
src/components/             # UI dùng chung (shadcn/ui + layout)
```

## 🔧 Xử lý lỗi thường gặp

| Hiện tượng                                            | Nguyên nhân / Cách xử lý                                                                                              |
| ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `Failed to execute modal` / lệnh không nhận diện được | Modal CLI chưa cài hoặc không có trong PATH: `pip install modal`                                                      |
| Danh sách profile trống                               | Chưa đăng nhập: chạy `modal setup`, kiểm tra `modal profile list`                                                     |
| Build Rust lỗi trên Windows                           | Thiếu VS C++ Build Tools hoặc Rust toolchain — làm theo [Tauri prerequisites](https://tauri.app/start/prerequisites/) |
| TensorBoard không khởi động                           | Chưa cài TensorBoard cục bộ: `pip install tensorboard`                                                                |
| Logs không tự cập nhật                                | App refetch mỗi 5s — kiểm tra app thật vẫn đang chạy, hoặc bấm **Refresh** trong dialog                               |

## 📄 Ghi chú

- UI base từ template MIT [shadcn-admin](https://github.com/satnaing/shadcn-admin); phần giao diện demo (auth/pages/tasks/users/chats) đã được lược bỏ, thay bằng các màn hình Modal thật.
- Token/credentials Modal không bị lưu trong app — chỉ đọc thông qua Modal CLI đã đăng nhập trên máy.
