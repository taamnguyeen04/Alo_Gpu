mod commands;
pub mod utils;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                .level(log::LevelFilter::Info)
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            // Profile commands
            commands::profile::list_profiles,
            commands::profile::get_current_profile,
            commands::profile::activate_profile,
            // App commands
            commands::app::list_apps,
            commands::app::get_app_logs,
            commands::app::stop_app,
            // Volume commands
            commands::volume::list_volumes,
            commands::volume::volume_ls,
            commands::volume::volume_create,
            commands::volume::volume_delete,
            commands::volume::volume_put,
            commands::volume::volume_get,
            commands::volume::volume_rm,
            commands::volume::volume_cp,
            commands::volume::volume_read_file,
            // Secret commands
            commands::secret::list_secrets,
            commands::secret::create_secret,
            commands::secret::delete_secret,
            // System commands
            commands::system::get_system_info,
            // Billing commands
            commands::billing::get_billing_summary,
            commands::billing::get_billing_rates,
            // Tensorboard commands
            commands::tensorboard::start_tensorboard,
            commands::tensorboard::stop_tensorboard,
            commands::tensorboard::create_tensorboard_dir,
            // Kaggle commands
            commands::kaggle::kaggle_cli_available,
            commands::kaggle::kaggle_list_accounts,
            commands::kaggle::kaggle_get_active_global,
            commands::kaggle::kaggle_add_account,
            commands::kaggle::kaggle_add_token_account,
            commands::kaggle::kaggle_update_account,
            commands::kaggle::kaggle_remove_account,
            commands::kaggle::kaggle_set_active_account,
            commands::kaggle::kaggle_quota,
            // Kaggle kernels
            commands::kaggle::kaggle_kernels,
            commands::kaggle::kaggle_kernel_status,
            commands::kaggle::kaggle_kernel_logs,
            commands::kaggle::kaggle_kernel_output_files,
            commands::kaggle::kaggle_kernel_push,
            commands::kaggle::kaggle_kernel_output_download,
            commands::kaggle::kaggle_list_folder_files,
            // Kaggle datasets
            commands::kaggle::kaggle_datasets,
            commands::kaggle::kaggle_dataset_files,
            commands::kaggle::kaggle_dataset_download,
            commands::kaggle::kaggle_dataset_create,
            commands::kaggle::kaggle_dataset_version,
        ])
        .manage(commands::tensorboard::TensorboardState::default())
        .setup(|app| {
            #[cfg(debug_assertions)]
            {
                let window = app.get_webview_window("main").unwrap();
                window.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
