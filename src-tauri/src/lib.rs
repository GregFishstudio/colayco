#[tauri::command]
fn ouvrir_fichier(chemin: String) -> Result<(), String> {
    std::process::Command::new("cmd")
        .args(["/C", "start", "", &chemin])
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![ouvrir_fichier])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}