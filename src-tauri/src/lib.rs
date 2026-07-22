use image::ImageFormat;
use serde::Serialize;
use std::{
    collections::HashMap,
    ffi::OsStr,
    fs,
    io::Cursor,
    path::{Path, PathBuf},
    process::Command,
    sync::{Arc, RwLock},
    time::Duration,
};
use tauri::{Emitter, Manager};
use tauri_plugin_updater::UpdaterExt;
use uuid::Uuid;

const SUPPORTED_EXTENSIONS: &[&str] = &["png", "jpg", "jpeg", "webp", "bmp", "gif"];

#[derive(Clone)]
struct RegisteredImage {
    path: PathBuf,
    mime_type: &'static str,
}

struct AppState {
    images: Arc<RwLock<HashMap<String, RegisteredImage>>>,
    startup_path: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ImageEntry {
    id: String,
    name: String,
    path: String,
    size: u64,
    modified: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct FolderSnapshot {
    directory: String,
    current_index: usize,
    items: Vec<ImageEntry>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    current_version: String,
    version: String,
    body: Option<String>,
    date: Option<String>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateProgress {
    downloaded: u64,
    total: Option<u64>,
}

fn extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(OsStr::to_str)
        .map(str::to_ascii_lowercase)
}

fn is_supported(path: &Path) -> bool {
    extension(path).is_some_and(|ext| SUPPORTED_EXTENSIONS.contains(&ext.as_str()))
}

fn mime_type(path: &Path) -> &'static str {
    match extension(path).as_deref() {
        Some("png") => "image/png",
        Some("jpg" | "jpeg") => "image/jpeg",
        Some("webp") => "image/webp",
        Some("bmp") => "image/bmp",
        Some("gif") => "image/gif",
        _ => "application/octet-stream",
    }
}

fn file_name(path: &Path) -> String {
    path.file_name()
        .and_then(OsStr::to_str)
        .unwrap_or_default()
        .to_owned()
}

fn scan_folder(path: &Path, state: &AppState) -> Result<FolderSnapshot, String> {
    let selected = path
        .canonicalize()
        .map_err(|error| format!("无法打开文件：{error}"))?;
    if !selected.is_file() || !is_supported(&selected) {
        return Err("请选择受支持的图片文件".to_owned());
    }

    let directory = selected
        .parent()
        .ok_or_else(|| "无法确定图片所在文件夹".to_owned())?
        .to_path_buf();
    let mut paths = fs::read_dir(&directory)
        .map_err(|error| format!("无法读取文件夹：{error}"))?
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|item| item.is_file() && is_supported(item))
        .collect::<Vec<_>>();

    paths.sort_by(|left, right| natord::compare_ignore_case(&file_name(left), &file_name(right)));

    let mut registry = HashMap::with_capacity(paths.len());
    let mut current_index = 0;
    let items = paths
        .into_iter()
        .enumerate()
        .map(|(index, item)| {
            let canonical = item.canonicalize().unwrap_or(item);
            if canonical == selected {
                current_index = index;
            }
            let metadata = fs::metadata(&canonical).ok();
            let id = Uuid::new_v4().simple().to_string();
            registry.insert(
                id.clone(),
                RegisteredImage {
                    path: canonical.clone(),
                    mime_type: mime_type(&canonical),
                },
            );
            ImageEntry {
                id,
                name: file_name(&canonical),
                path: canonical.to_string_lossy().into_owned(),
                size: metadata.as_ref().map_or(0, fs::Metadata::len),
                modified: metadata
                    .and_then(|value| value.modified().ok())
                    .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
                    .map_or(0, |value| value.as_secs()),
            }
        })
        .collect();

    *state
        .images
        .write()
        .map_err(|_| "图片索引暂时不可用".to_owned())? = registry;

    Ok(FolderSnapshot {
        directory: directory.to_string_lossy().into_owned(),
        current_index,
        items,
    })
}

#[tauri::command]
fn open_image(path: String, state: tauri::State<'_, AppState>) -> Result<FolderSnapshot, String> {
    scan_folder(Path::new(&path), &state)
}

#[tauri::command]
fn startup_path(state: tauri::State<'_, AppState>) -> Option<String> {
    state.startup_path.clone()
}

#[tauri::command]
fn exit_app(app: tauri::AppHandle) {
    app.exit(0);
}

fn update_endpoint(endpoint: &str) -> Result<url::Url, String> {
    let parsed = url::Url::parse(endpoint).map_err(|_| "更新源地址无效".to_owned())?;
    if parsed.scheme() != "https" {
        return Err("更新源必须使用 HTTPS".to_owned());
    }
    Ok(parsed)
}

#[tauri::command]
async fn check_for_update(
    app: tauri::AppHandle,
    endpoint: String,
) -> Result<Option<UpdateInfo>, String> {
    let updater = app
        .updater_builder()
        .endpoints(vec![update_endpoint(&endpoint)?])
        .map_err(|error| error.to_string())?
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|error| error.to_string())?;
    let update = updater.check().await.map_err(|error| error.to_string())?;
    Ok(update.map(|value| UpdateInfo {
        current_version: value.current_version,
        version: value.version,
        body: value.body,
        date: value.date.map(|date| date.to_string()),
    }))
}

#[tauri::command]
async fn install_online_update(app: tauri::AppHandle, endpoint: String) -> Result<(), String> {
    let updater = app
        .updater_builder()
        .endpoints(vec![update_endpoint(&endpoint)?])
        .map_err(|error| error.to_string())?
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "当前已经是最新版本".to_owned())?;

    let mut downloaded = 0_u64;
    let progress_app = app.clone();
    let finished_app = app.clone();
    update
        .download_and_install(
            move |chunk, total| {
                downloaded += chunk as u64;
                let _ = progress_app.emit("update-progress", UpdateProgress { downloaded, total });
            },
            move || {
                let _ = finished_app.emit("update-downloaded", ());
            },
        )
        .await
        .map_err(|error| error.to_string())?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn install_local_update(app: tauri::AppHandle, path: String) -> Result<(), String> {
    let installer = PathBuf::from(path)
        .canonicalize()
        .map_err(|error| format!("无法打开安装包：{error}"))?;
    let is_setup = installer
        .file_name()
        .and_then(OsStr::to_str)
        .is_some_and(|name| name.to_ascii_lowercase().ends_with("-setup.exe"));
    if !installer.is_file() || !is_setup {
        return Err("请选择名称以 -setup.exe 结尾的 PixelView 安装包".to_owned());
    }
    Command::new(installer)
        .args(["/P", "/R"])
        .spawn()
        .map_err(|error| format!("无法启动安装程序：{error}"))?;
    app.exit(0);
    Ok(())
}

#[tauri::command]
fn uninstall_app(app: tauri::AppHandle) -> Result<(), String> {
    let uninstall = std::env::current_exe()
        .map_err(|error| error.to_string())?
        .parent()
        .map(|directory| directory.join("uninstall.exe"))
        .ok_or_else(|| "无法确定安装目录".to_owned())?;
    if !uninstall.is_file() {
        return Err("当前是便携或开发版本，没有找到卸载程序".to_owned());
    }
    Command::new(uninstall)
        .spawn()
        .map_err(|error| format!("无法启动卸载程序：{error}"))?;
    app.exit(0);
    Ok(())
}

fn protocol_response(
    registry: &Arc<RwLock<HashMap<String, RegisteredImage>>>,
    uri_path: &str,
) -> tauri::http::Response<Vec<u8>> {
    let mut parts = uri_path.trim_start_matches('/').split('/');
    let route = parts.next().unwrap_or_default();
    let token = parts.next().unwrap_or_default();
    let image = registry
        .read()
        .ok()
        .and_then(|images| images.get(token).cloned());

    let Some(image) = image else {
        return tauri::http::Response::builder()
            .status(404)
            .body(Vec::new())
            .expect("valid response");
    };

    let result: Result<(Vec<u8>, &'static str), String> = match route {
        "image" => fs::read(&image.path)
            .map(|bytes| (bytes, image.mime_type))
            .map_err(|error| error.to_string()),
        "thumbnail" => image::open(&image.path)
            .map(|source| source.thumbnail(112, 112))
            .and_then(|thumbnail| {
                let mut output = Cursor::new(Vec::new());
                thumbnail.write_to(&mut output, ImageFormat::Png)?;
                Ok(output.into_inner())
            })
            .map(|bytes| (bytes, "image/png"))
            .map_err(|error| error.to_string()),
        _ => {
            return tauri::http::Response::builder()
                .status(404)
                .body(Vec::new())
                .expect("valid response")
        }
    };

    match result {
        Ok((body, content_type)) => tauri::http::Response::builder()
            .header("Content-Type", content_type)
            .header("Cache-Control", "private, max-age=3600")
            .header("Access-Control-Allow-Origin", "*")
            .body(body)
            .expect("valid response"),
        Err(_) => tauri::http::Response::builder()
            .status(422)
            .body(Vec::new())
            .expect("valid response"),
    }
}

fn first_supported_argument(args: impl IntoIterator<Item = String>) -> Option<String> {
    args.into_iter()
        .skip(1)
        .find(|argument| is_supported(Path::new(argument)))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let registry = Arc::new(RwLock::new(HashMap::new()));
    let protocol_registry = Arc::clone(&registry);
    let initial_path = first_supported_argument(std::env::args().collect::<Vec<_>>());

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            if let Some(path) = first_supported_argument(args) {
                let _ = app.emit("open-file", path);
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(AppState {
            images: registry,
            startup_path: initial_path,
        })
        .register_asynchronous_uri_scheme_protocol(
            "pixelview",
            move |_context, request, responder| {
                let registry = Arc::clone(&protocol_registry);
                let path = request.uri().path().to_owned();
                std::thread::spawn(move || responder.respond(protocol_response(&registry, &path)));
            },
        )
        .invoke_handler(tauri::generate_handler![
            open_image,
            startup_path,
            exit_app,
            check_for_update,
            install_online_update,
            install_local_update,
            uninstall_app
        ])
        .run(tauri::generate_context!())
        .expect("error while running PixelView");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recognizes_supported_extensions_case_insensitively() {
        assert!(is_supported(Path::new("sprite.PNG")));
        assert!(is_supported(Path::new("animation.GiF")));
        assert!(!is_supported(Path::new("notes.txt")));
    }

    #[test]
    fn reports_expected_mime_types() {
        assert_eq!(mime_type(Path::new("image.jpeg")), "image/jpeg");
        assert_eq!(mime_type(Path::new("image.webp")), "image/webp");
    }

    #[test]
    fn accepts_only_secure_update_endpoints() {
        assert!(update_endpoint("https://example.com/latest.json").is_ok());
        assert!(update_endpoint("http://example.com/latest.json").is_err());
        assert!(update_endpoint("not a url").is_err());
    }
}
