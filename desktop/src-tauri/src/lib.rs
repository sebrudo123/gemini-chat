//! Herramientas locales de Core IA Studio.
//!
//! El agente solo puede operar dentro del espacio de trabajo elegido por el
//! usuario. Las rutas se normalizan y se comprueba su resolución real para
//! impedir escapes con `..` o enlaces simbólicos.

use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::Mutex;
use std::time::Duration;

use serde::Deserialize;
use serde_json::Value;
use wait_timeout::ChildExt;

const MAX_OUTPUT: usize = 60_000;
const MAX_READ: usize = 200_000;
const COMMAND_TIMEOUT_SECS: u64 = 120;

static WORKSPACE: Mutex<Option<PathBuf>> = Mutex::new(None);

#[derive(Debug, Deserialize)]
struct ToolRequest {
    tool: String,
    #[serde(default)]
    args: Value,
}

fn default_workspace() -> PathBuf {
    if let Some(value) = std::env::var_os("COREIA_WORKSPACE") {
        let path = PathBuf::from(value);
        if path.is_dir() {
            return path;
        }
    }
    let home_var = if cfg!(target_os = "windows") {
        "USERPROFILE"
    } else {
        "HOME"
    };
    if let Some(value) = std::env::var_os(home_var) {
        let path = PathBuf::from(value);
        if path.is_dir() {
            return path;
        }
    }
    std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn workspace() -> PathBuf {
    let mut guard = WORKSPACE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if guard.is_none() {
        *guard = Some(default_workspace());
    }
    guard
        .as_ref()
        .cloned()
        .unwrap_or_else(default_workspace)
}

fn normalize(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::ParentDir => {
                out.pop();
            }
            Component::CurDir => {}
            other => out.push(other.as_os_str()),
        }
    }
    out
}

fn resolve(workspace: &Path, raw: &str) -> Result<PathBuf, String> {
    let value = raw.trim();
    if value.is_empty() {
        return Err("Falta la ruta.".to_string());
    }
    let candidate = Path::new(value);
    let joined = if candidate.is_absolute() {
        candidate.to_path_buf()
    } else {
        workspace.join(candidate)
    };
    let normalized = normalize(&joined);
    if !normalized.starts_with(workspace) {
        return Err(format!(
            "La ruta queda fuera del espacio de trabajo: {}",
            normalized.display()
        ));
    }
    Ok(normalized)
}

fn ensure_real_inside(workspace: &Path, path: &Path) -> Result<(), String> {
    if let Ok(meta) = fs::symlink_metadata(path) {
        if meta.file_type().is_symlink() {
            let real = path
                .canonicalize()
                .map_err(|_| "No se permiten enlaces simbólicos rotos.".to_string())?;
            if real != workspace && !real.starts_with(workspace) {
                return Err("El enlace apunta fuera del espacio de trabajo.".to_string());
            }
        }
    }

    let base = if path.exists() {
        Some(path.to_path_buf())
    } else {
        path.parent().map(|parent| parent.to_path_buf())
    };

    if let Some(base) = base {
        if base.exists() {
            let real = base
                .canonicalize()
                .map_err(|error| format!("No se pudo resolver la ruta: {error}"))?;
            if real != workspace && !real.starts_with(workspace) {
                return Err("La ruta real queda fuera del espacio de trabajo.".to_string());
            }
        }
    }
    Ok(())
}

fn truncate(text: String) -> String {
    if text.chars().count() <= MAX_OUTPUT {
        return text;
    }
    let mut out: String = text.chars().take(MAX_OUTPUT).collect();
    out.push_str("\n… (recortado)");
    out
}

fn read_file(workspace: &Path, path: &str) -> Result<String, String> {
    let target = resolve(workspace, path)?;
    ensure_real_inside(workspace, &target)?;
    let meta = fs::metadata(&target).map_err(|error| format!("No existe el archivo: {error}"))?;
    if !meta.is_file() {
        return Err("La ruta no es un archivo.".to_string());
    }
    let data = fs::read(&target).map_err(|error| format!("No se pudo leer: {error}"))?;
    let limited = if data.len() > MAX_READ {
        &data[..MAX_READ]
    } else {
        &data[..]
    };
    Ok(truncate(String::from_utf8_lossy(limited).to_string()))
}

fn list_dir(workspace: &Path, path: &str) -> Result<String, String> {
    let target = resolve(workspace, path)?;
    ensure_real_inside(workspace, &target)?;
    if !target.is_dir() {
        return Err("La ruta no es una carpeta.".to_string());
    }
    let mut rows = Vec::new();
    for entry in fs::read_dir(&target).map_err(|error| format!("No se pudo listar: {error}"))? {
        let Ok(entry) = entry else { continue };
        let name = entry.file_name().to_string_lossy().to_string();
        let meta = entry.metadata().ok();
        if meta.as_ref().map(|item| item.is_dir()).unwrap_or(false) {
            rows.push(format!("[dir]  {name}/"));
        } else {
            let size = meta.map(|item| item.len()).unwrap_or(0);
            rows.push(format!("[file] {name}  ({size} bytes)"));
        }
    }
    rows.sort();
    if rows.is_empty() {
        Ok("(carpeta vacía)".to_string())
    } else {
        Ok(rows.join("\n"))
    }
}

fn write_file(workspace: &Path, path: &str, content: &str) -> Result<String, String> {
    let target = resolve(workspace, path)?;
    ensure_real_inside(workspace, &target)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("No se pudo crear la carpeta: {error}"))?;
    }
    ensure_real_inside(workspace, &target)?;
    fs::write(&target, content).map_err(|error| format!("No se pudo escribir: {error}"))?;
    Ok(format!(
        "Escrito: {} ({} caracteres)",
        target.display(),
        content.chars().count()
    ))
}

fn create_dir(workspace: &Path, path: &str) -> Result<String, String> {
    let target = resolve(workspace, path)?;
    ensure_real_inside(workspace, &target)?;
    fs::create_dir_all(&target)
        .map_err(|error| format!("No se pudo crear la carpeta: {error}"))?;
    Ok(format!("Carpeta creada: {}", target.display()))
}

fn delete_path(workspace: &Path, path: &str) -> Result<String, String> {
    let target = resolve(workspace, path)?;
    if target == workspace {
        return Err("No se puede borrar la raíz del espacio de trabajo.".to_string());
    }
    ensure_real_inside(workspace, &target)?;
    if target.is_dir() {
        fs::remove_dir_all(&target)
            .map_err(|error| format!("No se pudo borrar la carpeta: {error}"))?;
        Ok(format!("Carpeta eliminada: {}", target.display()))
    } else if target.is_file() {
        fs::remove_file(&target)
            .map_err(|error| format!("No se pudo borrar el archivo: {error}"))?;
        Ok(format!("Archivo eliminado: {}", target.display()))
    } else {
        Err(format!("No existe: {}", target.display()))
    }
}

fn run_command(workspace: &Path, command: &str) -> Result<String, String> {
    let value = command.trim();
    if value.is_empty() {
        return Err("El comando está vacío.".to_string());
    }

    let mut process = if cfg!(target_os = "windows") {
        let mut cmd = Command::new("cmd");
        cmd.arg("/C").arg(value);
        cmd
    } else {
        let mut cmd = Command::new("bash");
        cmd.arg("-lc").arg(value);
        cmd
    };

    process
        .current_dir(workspace)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = process
        .spawn()
        .map_err(|error| format!("No se pudo ejecutar el comando: {error}"))?;

    let timeout = Duration::from_secs(COMMAND_TIMEOUT_SECS);
    match child
        .wait_timeout(timeout)
        .map_err(|error| format!("No se pudo esperar al comando: {error}"))?
    {
        None => {
            let _ = child.kill();
            let _ = child.wait();
            Err(format!(
                "El comando superó {COMMAND_TIMEOUT_SECS} segundos y se canceló."
            ))
        }
        Some(status) => {
            let mut stdout = String::new();
            let mut stderr = String::new();
            if let Some(mut pipe) = child.stdout.take() {
                let _ = pipe.read_to_string(&mut stdout);
            }
            if let Some(mut pipe) = child.stderr.take() {
                let _ = pipe.read_to_string(&mut stderr);
            }
            let output = truncate(format!("{stdout}{stderr}"));
            Ok(format!(
                "Código de salida: {}\n{}",
                status.code().unwrap_or(-1),
                output
            ))
        }
    }
}

#[tauri::command]
fn execute_tool(request: ToolRequest) -> Result<String, String> {
    let ws = workspace();
    let empty = Value::Object(Default::default());
    let args = if request.args.is_object() {
        &request.args
    } else {
        &empty
    };
    let text = |key: &str| args.get(key).and_then(Value::as_str).unwrap_or("");

    match request.tool.as_str() {
        "read_file" => read_file(&ws, text("path")),
        "write_file" => write_file(&ws, text("path"), text("content")),
        "list_dir" => list_dir(&ws, text("path")),
        "create_dir" => create_dir(&ws, text("path")),
        "delete_path" => delete_path(&ws, text("path")),
        "run_command" => run_command(&ws, text("command")),
        other => Err(format!("Herramienta desconocida: {other}")),
    }
}

#[tauri::command]
fn get_workspace() -> String {
    workspace().to_string_lossy().to_string()
}

#[tauri::command]
fn set_workspace(path: String) -> Result<String, String> {
    let raw = path.trim();
    if raw.is_empty() {
        return Err("La ruta está vacía.".to_string());
    }
    let candidate = PathBuf::from(raw);
    let candidate = if candidate.is_absolute() {
        candidate
    } else {
        default_workspace().join(candidate)
    };
    let canonical = candidate
        .canonicalize()
        .map_err(|error| format!("No se pudo abrir la carpeta: {error}"))?;
    if !canonical.is_dir() {
        return Err("La ruta no es una carpeta.".to_string());
    }
    let mut guard = WORKSPACE
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    *guard = Some(canonical.clone());
    Ok(canonical.to_string_lossy().to_string())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            execute_tool,
            get_workspace,
            set_workspace
        ])
        .run(tauri::generate_context!())
        .expect("error al iniciar Core IA Studio");
}
