const { app, BrowserWindow, shell, dialog, ipcMain } = require("electron");
const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.resolve(__dirname, "..", "..");
const PATHS = JSON.parse(fs.readFileSync(path.join(ROOT, "config", "paths.json"), "utf8"));
const IS_DEV = process.env.GSB_DEV === "1";

function createWindow() {
  const win = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: "#0b0a10",
    title: "Glitch Studio Builder",
    webPreferences: {
      preload: path.join(__dirname, "..", "preload", "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  win.setMenuBarVisibility(false);

  if (IS_DEV) {
    win.loadURL(`http://127.0.0.1:${PATHS.viteDevPort}`);
  } else {
    win.loadFile(path.join(ROOT, "dist", "index.html"));
  }

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

ipcMain.handle("gsb:pickFile", async (_evt, opts) => {
  const result = await dialog.showOpenDialog({
    properties: ["openFile"],
    filters: opts?.filters || [
      { name: "Audio/Video", extensions: ["wav", "mp3", "flac", "m4a", "ogg", "mp4", "mov", "mkv", "avi", "webm"] },
      { name: "All", extensions: ["*"] },
    ],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

ipcMain.handle("gsb:env", () => ({
  sidecarPort: PATHS.sidecarPort,
  ramLogoPath: PATHS.ramLogoPath,
  appVersion: app.getVersion(),
}));

app.whenReady().then(createWindow);
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
