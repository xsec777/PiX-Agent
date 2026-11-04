#![windows_subsystem = "windows"]

// ==============================================================================
// PiX 独立桌面客户端启动器 (Native Windows GUI Launcher)
// 编译目标: PiX.exe / 启动器.exe
// 特性: 零黑框启动，内嵌超清金属质感红色图案 "X" 图标，直接唤起桌面工作台
// ==============================================================================

use std::env;
use std::path::PathBuf;
use std::process::{Command, Stdio};

fn get_project_dir() -> PathBuf {
    if let Ok(exe_path) = env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            return parent.to_path_buf();
        }
    }
    env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn find_electron(project_dir: &std::path::Path) -> Option<PathBuf> {
    // 1. 优先检查本地项目下 runtime
    let in_project = project_dir.join("runtime").join("electron.exe");
    if in_project.exists() {
        return Some(in_project);
    }

    // 2. 检查环境变量 ELECTRON_PATH
    if let Ok(env_path) = env::var("ELECTRON_PATH") {
        let p = PathBuf::from(env_path);
        if p.exists() {
            return Some(p);
        }
    }

    // 3. 检查系统 PATH
    if let Ok(path_var) = env::var("PATH") {
        for dir in env::split_paths(&path_var) {
            let p = dir.join("electron.exe");
            if p.exists() {
                return Some(p);
            }
        }
    }

    None
}

fn main() {
    let project_dir = get_project_dir();
    let app_dir = project_dir.join("app");

    if let Some(electron) = find_electron(&project_dir) {
        let _ = Command::new(electron)
            .arg(&app_dir)
            .current_dir(&project_dir)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }
}
