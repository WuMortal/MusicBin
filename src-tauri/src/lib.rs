mod music;
mod plugin;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![
            music::search_music,
            music::guess_musics,
            music::get_play_url,
            music::download_track,
            music::get_track_meta,
            music::download_track_with_meta,
            music::default_download_dir,
            plugin::fetch_text,
            plugin::plugin_fetch,
            plugin::plugin_download_track,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
