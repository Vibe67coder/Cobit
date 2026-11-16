import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
let dualViewportWindow: BrowserWindow | null = null;
let engineProcess: ChildProcess | null = null;

const ENGINE_PORT = Number(process.env.COBITX_ENGINE_PORT || 47820);
const ENGINE_URL = `http://127.0.0.1:${ENGINE_PORT}`;
const isDev = !app.isPackaged;

function resolvePythonSidecar(): { cmd: string; args: string[]; cwd: string } {
  if (app.isPackaged) {
    const exeName = process.platform === 'win32' ? 'cobitx-engine.exe' : 'cobitx-engine';
    const bundledExe = path.join(process.resourcesPath, 'engine', exeName);
    if (fs.existsSync(bundledExe)) {
      return {
        cmd: bundledExe,
        args: ['--port', String(ENGINE_PORT)],
        cwd: path.dirname(bundledExe),
      };
    }
  }

  const rootDir = path.resolve(__dirname, '..');
  const venvPython =
    process.platform === 'win32'
      ? path.join(rootDir, 'engine', '.venv', 'Scripts', 'python.exe')
      : path.join(rootDir, 'engine', '.venv', 'bin', 'python');
  const pythonBin = fs.existsSync(venvPython)
    ? venvPython
    : process.platform === 'win32'
    ? 'python'
    : 'python3';

  return {
    cmd: pythonBin,
    args: [path.join(rootDir, 'engine', 'main.py'), '--port', String(ENGINE_PORT)],
    cwd: rootDir,
  };
}

function startPythonEngine(): void {
  if (engineProcess) return;
  const spec = resolvePythonSidecar();
  const dataDir = path.join(app.getPath('userData'), 'cobitx-data');
  fs.mkdirSync(dataDir, { recursive: true });

  engineProcess = spawn(spec.cmd, spec.args, {
    cwd: spec.cwd,
    env: {
      ...process.env,
      COBITX_DATA_DIR: dataDir,
      COBITX_ENGINE_PORT: String(ENGINE_PORT),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  engineProcess.stdout?.on('data', (d) => {
    console.log(`[CobitX Engine] ${d.toString().trim()}`);
  });
  engineProcess.stderr?.on('data', (d) => {
    console.error(`[CobitX Engine] ${d.toString().trim()}`);
  });
  engineProcess.on('exit', (code) => {
    console.log(`[CobitX Engine] exited with code ${code}`);
    engineProcess = null;
  });
}

function stopPythonEngine(): void {
  if (!engineProcess) return;
  try {
    engineProcess.kill();
  } catch {
    // Ignore cleanup errors
  }
  engineProcess = null;
}

function createMainWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1520,
    height: 920,
    minWidth: 1120,
    minHeight: 700,
    title: 'CobitX Estimating v15.1',
    backgroundColor: '#f3f5f8',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  if (isDev && process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
    if (dualViewportWindow && !dualViewportWindow.isDestroyed()) {
      dualViewportWindow.close();
    }
  });
}

function registerIpcHandlers(): void {
  ipcMain.handle('cobitx:get-env', () => ({
    isDesktop: true,
    platform: process.platform,
    version: app.getVersion(),
    engineUrl: ENGINE_URL,
    userDataDir: app.getPath('userData'),
  }));

  ipcMain.handle('cobitx:open-dual-viewport', () => {
    if (dualViewportWindow && !dualViewportWindow.isDestroyed()) {
      dualViewportWindow.focus();
      return { opened: true, reused: true };
    }

    dualViewportWindow = new BrowserWindow({
      width: 1200,
      height: 840,
      title: 'CobitX — Dual Screen Viewport',
      backgroundColor: '#ffffff',
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    if (isDev && process.env.VITE_DEV_SERVER_URL) {
      dualViewportWindow.loadURL(`${process.env.VITE_DEV_SERVER_URL}?mode=dualViewport`);
    } else {
      dualViewportWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'), {
        query: { mode: 'dualViewport' },
      });
    }

    dualViewportWindow.on('closed', () => {
      dualViewportWindow = null;
    });
    return { opened: true, reused: false };
  });

  ipcMain.handle('cobitx:open-plan-dialog', async () => {
    const res = await dialog.showOpenDialog({
      title: 'Insert Plan or BIM Model into CobitX',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'CAD, PDF, BIM & Raster Plans',
          extensions: ['pdf', 'dwg', 'dxf', 'ifc', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp'],
        },
        { name: 'All Files', extensions: ['*'] },
      ],
    });
    return res.canceled ? [] : res.filePaths;
  });

  ipcMain.handle('cobitx:save-file-dialog', async (_evt, opts: { defaultPath: string; filters?: Electron.FileFilter[] }) => {
    const res = await dialog.showSaveDialog({
      defaultPath: opts.defaultPath,
      filters: opts.filters ?? [{ name: 'All Files', extensions: ['*'] }],
    });
    return res.canceled ? null : res.filePath ?? null;
  });

  ipcMain.handle('cobitx:open-external', async (_evt, url: string) => {
    await shell.openExternal(url);
  });
}

app.whenReady().then(() => {
  startPythonEngine();
  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  stopPythonEngine();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  stopPythonEngine();
});
