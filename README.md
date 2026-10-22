# AloGPU

Ứng dụng desktop quản lý các dịch vụ ML cloud của bạn — hiện tại là **Modal** (workspaces, apps, volumes, secrets, TensorBoard, billing), và đang trong kế hoạch bổ sung **Kaggle** (datasets, notebooks).

Phía backend Rust không gọi API trực tiếp mà bọc **Modal CLI** (`modal`), tự động đổi workspace qua biến môi trường `MODAL_PROFILE` → mọi hành động đều dùng đúng profile/modal account đã đăng nhập trên máy bạn.

Được xây dựng trên **Tauri 2 + React + shadcn/ui** (dựa trên template [shadcn-admin](https://github.com/satnaing/shadcn-admin)).

## ✨ Tính năng

- **Workspaces** — xem tất cả Modal profiles, credits còn lại của từng workspace, ghi chú tự lưu, đổi profile bằng 1 click, sort theo tên/credits
- **Apps** — danh sách apps, xem logs live (tự động refetch + tích lũy, tìm overlap tránh mất log), xóa app, ước lượng thời lượng train từ GPU đang dùng & credits
- **Volumes** — duyệt/tải/xóa file trong volume, upload file & thư mục, tạo/xóa volume
- **Secrets** — tạo secret với key/value, xóa secret
- **TensorBoard** — chọn thư mục log cục bộ, app tự khởi động TensorBoard local và nhúng iframe
- **GPU Pricing / Billing** — tra giá GPU theo giờ, cập nhật costs hàng loạt cho mọi workspace

## 📋 Yêu cầu hệ thống

| Thành phần                                        | Yêu cầu                      | Ghi chú                                                                        |
| ------------------------------------------------- | ---------------------------- | ------------------------------------------------------------------------------ |
| Hệ điều hành                                      | Windows 10/11                | Bundle hiện là MSI/NSIS, TensorBoard dùng `taskkill` (Windows-only)            |
| Node.js                                           | ≥ 20.19 (khuyến nghị LTS 22) | kèm npm 10+                                                                    |
| Rust                                              | stable ≥ 1.77.2              | cài qua [rustup](https://rustup.rs/)                                           |
| VS C++ Build Tools                                | bắt buộc trên Windows        | để compile Tauri (xem [prerequisites](https://tauri.app/start/prerequisites/)) |
| [Modal CLI](https://modal.com/docs/reference/cli) | mới nhất                     | `pip install modal` rồi `modal setup` để đăng nhập                             |
| Python + TensorBoard                              | tùy chọn                     | chỉ cần khi dùng tab TensorBoard: `pip install tensorboard`                    |

Kiểm tra đã đủ điều kiện:

```bash
node -v          # >= 20.19
cargo --version  # >= 1.77
modal profile list  # phải trả về ít nhất 1 profile đã login
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
