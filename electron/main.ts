import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { ChildProcess, spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

let mainWindow: BrowserWindow | null = null;
let dualViewportWindow: BrowserWindow | null = null;
let engineProcess: ChildProcess | null = null;

const ENGINE_PORT = Number(process.env.COBITX_ENGINE_PORT || 47820);
let engineReady: Promise<string> | null = null;

if (process.env.COBITX_USER_DATA_DIR) {
  app.setPath('userData', process.env.COBITX_USER_DATA_DIR);
}
const isDev = !app.isPackaged;

function resolvePythonSidecar(): { cmd: string; args: string[]; cwd: string } {
  if (app.isPackaged) {
    const exeName = process.platform === 'win32' ? 'cobitx-engine.exe' : 'cobitx-engine';
    const bundledExe = path.join(process.resourcesPath, 'engine', exeName);
    if (fs.existsSync(bundledExe)) {
      return {
        cmd: bundledExe,
        args: ['--desktop-engine', '--port', String(ENGINE_PORT)],
        cwd: path.dirname(bundledExe),
      };
    }
    throw new Error('The bundled CobitX engine is missing.');
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
    args: [path.join(rootDir, 'engine', 'main.py'), '--desktop-engine', '--port', String(ENGINE_PORT)],
    cwd: rootDir,
  };
}

function startPythonEngine(): Promise<string> {
  if (engineReady) return engineReady;
  engineReady = new Promise<string>((resolve, reject) => {
    const spec = resolvePythonSidecar();
    const dataDir = path.join(app.getPath('userData'), 'cobitx-data');
    const ifcRuntime = app.isPackaged ? {
      COBITX_IFC_NODE: process.execPath,
      COBITX_IFC_SCRIPT: path.join(process.resourcesPath, 'ifc', 'ifc_geometry.cjs'),
    } : {};
    fs.mkdirSync(dataDir, { recursive: true });

    const child = spawn(spec.cmd, spec.args, {
      cwd: spec.cwd,
      env: { ...process.env, ...ifcRuntime, COBITX_DATA_DIR: dataDir },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    engineProcess = child;
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error('The local CobitX engine took too long to start.'));
    }, 55_000);
    let output = '';
    let connecting = false;
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', async (data: string) => {
      output = (output + data).slice(-8192);
      const port = output.match(/COBITX_ENGINE_PORT=(\d+)\r?\n/)?.[1];
      if (!port || connecting) return;
      connecting = true;
      const url = `http://127.0.0.1:${port}`;
      for (let attempt = 0; attempt < 75 && engineProcess === child; attempt++) {
        try {
          const response = await fetch(`${url}/health`, { signal: AbortSignal.timeout(900) });
          const health = await response.json() as { drawingImportApi?: number };
          if (response.ok && health.drawingImportApi === 2) {
            clearTimeout(timeout);
            resolve(url);
            return;
          }
        } catch {
          // The child has bound the port but its HTTP startup can still be in progress.
        }
        await new Promise((ready) => setTimeout(ready, 200));
      }
      clearTimeout(timeout);
      child.kill();
      reject(new Error('The local engine did not finish starting.'));
    });
    child.stderr?.on('data', (d) => console.error(`[CobitX Engine] ${d.toString().trim()}`));
    child.once('error', (error) => { clearTimeout(timeout); reject(error); });
    child.once('exit', (code) => {
      clearTimeout(timeout);
      if (engineProcess === child) {
        engineProcess = null;
        engineReady = null;
      }
      reject(new Error(`The local CobitX engine stopped (exit ${code}).`));
    });
  });
  engineReady.catch((error) => console.error('[CobitX Engine]', error.message));
  return engineReady;
}

function stopPythonEngine(): void {
  if (!engineProcess) return;
  try {
    engineProcess.kill();
  } catch {
    // Ignore cleanup errors
  }
  engineProcess = null;
  engineReady = null;
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
  ipcMain.handle('cobitx:get-env', async () => ({
    isDesktop: true,
    platform: process.platform,
    version: app.getVersion(),
    engineUrl: await startPythonEngine(),
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
