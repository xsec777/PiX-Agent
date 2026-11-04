// ==============================================================================
// PiX 独立桌面客户端 (Native Desktop App)
// 标题: PiX
// 图标: 科技极客风格 "πx"
// 行为: 点击右上角 [X] 默认最小化至右下角系统托盘小图标，双击图标恢复，右键彻底退出
// ==============================================================================

const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain } = require("electron");
const path = require("path");
const http = require("http");
const { spawn, execSync } = require("child_process");

const PORT = 30141;
const TARGET_URL = `http://127.0.0.1:${PORT}`;
const APP_DIR = __dirname;
const PROJECT_DIR = path.resolve(APP_DIR, "..");

let mainWindow = null;
let tray = null;
let isQuitting = false;
let backendProcess = null;

// 单实例锁 (防止重复打开多个窗口)
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
  process.exit(0);
}

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    if (!mainWindow.isVisible()) mainWindow.show();
    mainWindow.focus();
  }
});

function checkPortOpen(port) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/`, (res) => {
      resolve(res.statusCode === 200);
    });
    req.on("error", () => resolve(false));
    req.setTimeout(400, () => {
      req.destroy();
      resolve(false);
    });
  });
}

function findPiWebJs() {
  const npmGlobal = path.join(
    process.env.APPDATA || "",
    "npm",
    "node_modules",
    "@agegr",
    "pi-web",
    "bin",
    "pi-web.js"
  );
  if (require("fs").existsSync(npmGlobal)) return npmGlobal;
  const local = path.join(PROJECT_DIR, "pi-web-source", "bin", "pi-web.js");
  if (require("fs").existsSync(local)) return local;
  return null;
}

function resolveWorkDir() {
  if (process.env.PIX_WORKSPACE && require("fs").existsSync(process.env.PIX_WORKSPACE)) {
    return process.env.PIX_WORKSPACE;
  }
  const fallback = "E:\\AProjs\\Pi\\Demo";
  if (require("fs").existsSync(fallback)) return fallback;
  return PROJECT_DIR;
}

function startBackendServer() {
  const piWebJs = findPiWebJs();
  const workDir = resolveWorkDir();
  if (piWebJs) {
    backendProcess = spawn("node", [piWebJs, "--no-open"], {
      cwd: workDir,
      windowsHide: true,
      stdio: "ignore"
    });
  } else {
    backendProcess = spawn("cmd.exe", ["/c", "pi-web", "--no-open"], {
      cwd: workDir,
      windowsHide: true,
      stdio: "ignore"
    });
  }
}

function cleanupAndQuit() {
  isQuitting = true;
  try {
    const stopScript = path.join(PROJECT_DIR, "scripts", "stop-pix.mjs");
    if (require("fs").existsSync(stopScript)) {
      execSync(`node "${stopScript}"`, { windowsHide: true, stdio: "ignore" });
    }
  } catch {}
  if (backendProcess) {
    try {
      backendProcess.kill();
    } catch {}
  }
  app.quit();
}

function createTray(iconPath) {
  if (tray) return;

  const trayImage = nativeImage.createFromPath(iconPath);
  tray = new Tray(trayImage);
  tray.setToolTip("PiX");

  const updateMenu = (isRunning) => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: "显示 PiX 主界面",
        click: () => {
          if (mainWindow) {
            mainWindow.show();
            mainWindow.focus();
          }
        }
      },
      { type: "separator" },
      {
        label: isRunning ? "服务状态: 🟢 运行中 (30141)" : "服务状态: ⚪ 未就绪",
        enabled: false
      },
      { type: "separator" },
      {
        label: "彻底退出 PiX",
        click: () => {
          cleanupAndQuit();
        }
      }
    ]);
    tray.setContextMenu(contextMenu);
  };

  updateMenu(true);

  // 双击托盘图标切换窗口显示/隐藏
  tray.on("double-click", () => {
    if (mainWindow.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  // 单击托盘图标同样唤醒窗口
  tray.on("click", () => {
    if (!mainWindow.isVisible()) {
      mainWindow.show();
      mainWindow.focus();
    }
  });
}

function createWindow() {
  const iconIco = path.join(APP_DIR, "icon.ico");
  const iconPng = path.join(APP_DIR, "icon.png");

  mainWindow = new BrowserWindow({
    title: "PiX",
    width: 1380,
    height: 880,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: "#090d16",
    autoHideMenuBar: true,
    icon: iconIco,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true
    }
  });

  // 标题栏固定显示 "PiX"
  mainWindow.setTitle("PiX");
  mainWindow.on("page-title-updated", (event) => {
    event.preventDefault();
    mainWindow.setTitle("PiX");
  });

  // 先加载极简 Loading 页面
  mainWindow.loadFile(path.join(APP_DIR, "loading.html"));
  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  // 关键特性：拦截右上角 [X] 关闭按钮，默认缩小到右下角系统托盘
  mainWindow.on("close", (event) => {
    if (!isQuitting) {
      event.preventDefault();
      mainWindow.hide();
      return false;
    }
  });

  // 初始化系统托盘图标 (Windows 托盘优先使用多尺寸 .ico 渲染)
  createTray(iconIco);

  // 检查并连接后端 Web 接口
  async function connectToService() {
    let running = await checkPortOpen(PORT);
    if (!running) {
      startBackendServer();
    }

    // 轮询等待端口就绪 (每 300ms 一次，最多等待 12s)
    let retries = 0;
    const interval = setInterval(async () => {
      retries++;
      const isUp = await checkPortOpen(PORT);
      if (isUp) {
        clearInterval(interval);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.loadURL(TARGET_URL);
        }
      } else if (retries > 40) {
        clearInterval(interval);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.executeJavaScript(`
            const el = document.getElementById("status-text");
            if (el) el.innerText = "服务启动超时，请检查端口 30141 是否被占用";
          `).catch(() => {});
        }
      }
    }, 300);
  }

  connectToService();
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("before-quit", () => {
  isQuitting = true;
});

app.on("window-all-closed", () => {
  // macOS 规范，Windows 下继续由托盘常驻守护
  if (process.platform === "darwin") {
    app.quit();
  }
});
