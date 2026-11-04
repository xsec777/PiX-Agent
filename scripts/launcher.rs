// ==============================================================================
// PiX 全自主红队与渗透测试智能体 · 原生 Rust 启动与控制台 (Native Launcher)
// 编译目标: pix-launcher.exe / 启动器.exe
// ==============================================================================

use std::env;
use std::io::{self, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::Duration;

const PORT: u16 = 30141;

fn get_project_dir() -> PathBuf {
    if let Ok(exe_path) = env::current_exe() {
        if let Some(parent) = exe_path.parent() {
            return parent.to_path_buf();
        }
    }
    env::current_dir().unwrap_or_else(|_| PathBuf::from("."))
}

fn is_port_open(port: u16) -> bool {
    let addr: Result<SocketAddr, _> = format!("127.0.0.1:{}", port).parse();
    if let Ok(sa) = addr {
        TcpStream::connect_timeout(&sa, Duration::from_millis(300)).is_ok()
    } else {
        false
    }
}

fn get_port_pids(port: u16) -> Vec<String> {
    let ps_cmd = format!(
        "Get-NetTCPConnection -LocalPort {} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique",
        port
    );
    let output = Command::new("powershell")
        .args(["-NoProfile", "-Command", &ps_cmd])
        .output();

    let mut pids = Vec::new();
    if let Ok(out) = output {
        let stdout = String::from_utf8_lossy(&out.stdout);
        for line in stdout.split_whitespace() {
            let trimmed = line.trim();
            if !trimmed.is_empty() && trimmed.chars().all(|c| c.is_ascii_digit()) && trimmed != "0" && trimmed != "4" {
                if !pids.contains(&trimmed.to_string()) {
                    pids.push(trimmed.to_string());
                }
            }
        }
    }
    pids
}

fn find_pi_web_entry(project_dir: &Path) -> Option<PathBuf> {
    // 1. 全局 npm 路径
    if let Ok(appdata) = env::var("APPDATA") {
        let p = PathBuf::from(appdata)
            .join("npm")
            .join("node_modules")
            .join("@agegr")
            .join("pi-web")
            .join("bin")
            .join("pi-web.js");
        if p.exists() {
            return Some(p);
        }
    }
    // 2. 本地定制源码路径
    let local = project_dir.join("pi-web-source").join("bin").join("pi-web.js");
    if local.exists() {
        return Some(local);
    }
    None
}

fn open_browser(url: &str) {
    let _ = Command::new("cmd")
        .args(["/c", "start", url])
        .spawn();
}

fn start_web(project_dir: &Path) {
    println!("\x1b[1;36m[*] 正在检查并启动 PiX Web 服务...\x1b[0m");

    // 1. 如果端口已经在监听，直接打开浏览器并提示
    if is_port_open(PORT) {
        let pids = get_port_pids(PORT);
        let pid_str = if pids.is_empty() { "未知".to_string() } else { pids.join(", ") };
        println!("\x1b[1;33m[!] 检测到 PiX 服务已在运行中 (PID: {})\x1b[0m", pid_str);
        println!("\x1b[1;32m[+] 正在为你打开浏览器: http://127.0.0.1:{}\x1b[0m", PORT);
        open_browser(&format!("http://127.0.0.1:{}", PORT));
        println!("\n提示：若需彻底重启或关闭服务，请在主菜单选择 [4] 停止服务。");
        return;
    }

    // 2. 检查并同步扩展
    let install_script = project_dir.join("scripts").join("install.mjs");
    if install_script.exists() {
        print!("  -> 同步扩展与武器库配置... ");
        io::stdout().flush().unwrap();
        let _ = Command::new("node")
            .arg(&install_script)
            .arg("--no-patch")
            .current_dir(project_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
        println!("\x1b[32m完成\x1b[0m");
    }

    // 3. 启动模型缓存同步器
    let sync_script = project_dir.join("scripts").join("models-sync.mjs");
    if sync_script.exists() {
        let _ = Command::new("node")
            .arg(&sync_script)
            .arg("--watch")
            .current_dir(project_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }

    // 4. 启动 pi-web 服务
    println!("  -> 拉起 pi-web 原生后端服务...");
    if let Some(pi_web_js) = find_pi_web_entry(project_dir) {
        let _ = Command::new("node")
            .arg(&pi_web_js)
            .arg("--no-open")
            .current_dir(project_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    } else {
        let _ = Command::new("cmd")
            .args(["/c", "pi-web", "--no-open"])
            .current_dir(project_dir)
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn();
    }

    // 5. 轮询等待端口就绪 (最多等待 6 秒)
    print!("  -> 等待 Web 端口监听就绪 ");
    io::stdout().flush().unwrap();
    let mut ready = false;
    for _ in 0..12 {
        std::thread::sleep(Duration::from_millis(500));
        print!(".");
        io::stdout().flush().unwrap();
        if is_port_open(PORT) {
            ready = true;
            break;
        }
    }
    println!();

    if ready {
        println!("\x1b[1;32m[✓] PiX Web 服务已成功启动！\x1b[0m");
        println!("\x1b[1;36m[+] 正在打开浏览器: http://127.0.0.1:{}\x1b[0m", PORT);
        open_browser(&format!("http://127.0.0.1:{}", PORT));
    } else {
        println!("\x1b[1;33m[!] 服务已拉起，正在等待初始化。请稍候访问: http://127.0.0.1:{}\x1b[0m", PORT);
        open_browser(&format!("http://127.0.0.1:{}", PORT));
    }
}

fn stop_all(project_dir: &Path) {
    println!("\x1b[1;33m[*] 正在排查并终止所有 PiX 服务进程与关联守护监听...\x1b[0m");

    let stop_script = project_dir.join("scripts").join("stop-pix.mjs");
    if stop_script.exists() {
        let _ = Command::new("node")
            .arg(&stop_script)
            .current_dir(project_dir)
            .status();
        return;
    }

    // 原生托底清理
    let pids = get_port_pids(PORT);
    if pids.is_empty() && !is_port_open(PORT) {
        println!("\x1b[1;32m[✓] 未检测到运行中的服务，端口 {} 已处于空闲状态。\x1b[0m", PORT);
        return;
    }

    for pid in &pids {
        println!("  -> 终止进程 PID: {}...", pid);
        let _ = Command::new("taskkill")
            .args(["/F", "/T", "/PID", pid])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }

    std::thread::sleep(Duration::from_millis(500));
    if !is_port_open(PORT) {
        println!("\x1b[1;32m[✓] 所有 PiX 服务已安全关闭，端口 {} 释放完毕！\x1b[0m", PORT);
    } else {
        println!("\x1b[1;31m[!] 端口 {} 仍被占用，可能需要管理员权限执行 taskkill。\x1b[0m", PORT);
    }
}

fn run_cli(project_dir: &Path) {
    println!("\x1b[1;36m[*] 进入 PiX 终端直接交互模式...\x1b[0m\n");
    let _ = Command::new("cmd")
        .args(["/c", "pi"])
        .current_dir(project_dir)
        .status();
}

fn check_status_details(_project_dir: &Path) {
    println!("\x1b[1;36m========================================================================\x1b[0m");
    println!("  PiX 服务状态与网络连接巡检详情");
    println!("\x1b[1;36m========================================================================\x1b[0m\n");

    let open = is_port_open(PORT);
    println!("  端口 30141 监听: {}", if open { "\x1b[1;32m[OPEN 🟢]\x1b[0m" } else { "\x1b[1;30m[CLOSED ⚪]\x1b[0m" });

    let pids = get_port_pids(PORT);
    if !pids.is_empty() {
        println!("  监听进程 PID: \x1b[1;33m{}\x1b[0m", pids.join(", "));
    }

    println!("\n  [TCP 网络连接详情 (PowerShell)]:");
    let _ = Command::new("powershell")
        .args(["-NoProfile", "-Command", "Get-NetTCPConnection -LocalPort 30141 -State Listen -ErrorAction SilentlyContinue | Format-Table -AutoSize"])
        .status();

    println!("  [关联进程列表]:");
    let _ = Command::new("powershell")
        .args(["-NoProfile", "-Command", "Get-CimInstance Win32_Process | Where-Object { $_.Name -ne 'powershell.exe' -and ($_.CommandLine -match 'pi-web' -or $_.CommandLine -match 'models-sync') } | Select-Object ProcessId, Name, CommandLine | Format-Table -AutoSize"])
        .status();
}

fn health_check(project_dir: &Path) {
    println!("\x1b[1;36m========================================================================\x1b[0m");
    println!("  PiX 扩展与 38 款武器库健康自检");
    println!("\x1b[1;36m========================================================================\x1b[0m\n");

    let install_script = project_dir.join("scripts").join("install.mjs");
    if install_script.exists() {
        let _ = Command::new("node")
            .arg(&install_script)
            .arg("--status")
            .current_dir(project_dir)
            .status();
    } else {
        println!("未找到 install.mjs 脚本: {:?}", install_script);
    }
}

fn print_menu(_project_dir: &Path) {
    let running = is_port_open(PORT);
    let pids = if running { get_port_pids(PORT) } else { Vec::new() };
    let pid_desc = if pids.is_empty() { "".to_string() } else { format!(" (PID: {})", pids.join(", ")) };

    println!("\x1b[1;36m========================================================================\x1b[0m");
    println!("  \x1b[1;37m🛡️  PiX 全自主红队与渗透测试智能体 · 控制台 (Rust Native)\x1b[0m");
    println!("\x1b[1;36m========================================================================\x1b[0m");
    println!();
    if running {
        println!("  [服务状态]: \x1b[1;32m🟢 运行中\x1b[0m{} · 访问: \x1b[4;36mhttp://127.0.0.1:{}\x1b[0m", pid_desc, PORT);
    } else {
        println!("  [服务状态]: \x1b[1;30m⚪ 未运行\x1b[0m (端口 {} 处于就绪空闲状态)", PORT);
    }
    println!();
    println!("  【操作功能菜单】：");
    println!("  ----------------------------------------------------------------------");
    println!("    \x1b[1;37m[1]\x1b[0m 🚀 启动 / 打开 Web 对话工作台 (自动打开默认浏览器)");
    println!("    \x1b[1;37m[2]\x1b[0m 💻 启动 Terminal 终端直接交互模式 (pi CLI)");
    println!("    \x1b[1;37m[3]\x1b[0m 🔍 检查服务状态与网络端口占用详情");
    println!("    \x1b[1;37m[4]\x1b[0m 🛑 停止并关闭所有 PiX 服务进程 (一键杀进程释放端口)");
    println!("    \x1b[1;37m[5]\x1b[0m 🏥 一键同步扩展与 38 款武器库健康自检");
    println!("    \x1b[1;37m[6]\x1b[0m 📂 打开本地工程目录");
    println!("    \x1b[1;37m[0]\x1b[0m 🚪 退出控制台");
    println!("  ----------------------------------------------------------------------");
    println!();
    print!("请输入选项编号 [0-6]: ");
    io::stdout().flush().unwrap();
}

fn pause_for_user() {
    print!("\n按回车键继续...");
    io::stdout().flush().unwrap();
    let mut buf = String::new();
    let _ = io::stdin().read_line(&mut buf);
}

fn clear_screen() {
    print!("\x1b[2J\x1b[1;1H");
    io::stdout().flush().unwrap();
}

fn main() {
    // 启用 Windows 控制台 UTF-8 支持
    let _ = Command::new("cmd").args(["/c", "chcp", "65001"]).stdout(Stdio::null()).status();

    let project_dir = get_project_dir();
    let args: Vec<String> = env::args().collect();

    // 命令行非交互子命令支持
    if args.len() > 1 {
        match args[1].as_str() {
            "web" | "start" => {
                start_web(&project_dir);
                return;
            }
            "stop" | "kill" => {
                stop_all(&project_dir);
                return;
            }
            "status" => {
                check_status_details(&project_dir);
                return;
            }
            "cli" => {
                run_cli(&project_dir);
                return;
            }
            "-h" | "--help" | "help" => {
                println!("PiX 启动器 (Rust 原生构建)");
                println!("用法: pix-launcher.exe [web|stop|status|cli]");
                return;
            }
            _ => {}
        }
    }

    // 交互式控制台循环
    loop {
        clear_screen();
        print_menu(&project_dir);

        let mut input = String::new();
        if io::stdin().read_line(&mut input).is_err() {
            break;
        }

        let choice = input.trim();
        println!();

        match choice {
            "1" => {
                start_web(&project_dir);
                pause_for_user();
            }
            "2" => {
                run_cli(&project_dir);
                pause_for_user();
            }
            "3" => {
                check_status_details(&project_dir);
                pause_for_user();
            }
            "4" => {
                stop_all(&project_dir);
                pause_for_user();
            }
            "5" => {
                health_check(&project_dir);
                pause_for_user();
            }
            "6" => {
                let _ = Command::new("explorer").arg(&project_dir).spawn();
            }
            "0" | "exit" | "quit" | "q" => {
                println!("退出 PiX 控制台。祝渗透顺利！");
                break;
            }
            _ => {
                println!("\x1b[1;31m无效输入，请输入 0-6 之间的数字。\x1b[0m");
                std::thread::sleep(Duration::from_millis(800));
            }
        }
    }
}
