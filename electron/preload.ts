import { contextBridge, ipcRenderer } from 'electron';

export interface CobitxDesktopApi {
  isDesktop: boolean;
  getEnv: () => Promise<{
    isDesktop: boolean;
    platform: string;
    version: string;
    engineUrl: string;
    userDataDir: string;
  }>;
  openDualViewport: () => Promise<{ opened: boolean; reused: boolean }>;
  openPlanDialog: () => Promise<string[]>;
  saveFileDialog: (opts: {
    defaultPath: string;
    filters?: { name: string; extensions: string[] }[];
  }) => Promise<string | null>;
  openExternal: (url: string) => Promise<void>;
}

const api: CobitxDesktopApi = {
  isDesktop: true,
  getEnv: () => ipcRenderer.invoke('cobitx:get-env'),
  openDualViewport: () => ipcRenderer.invoke('cobitx:open-dual-viewport'),
  openPlanDialog: () => ipcRenderer.invoke('cobitx:open-plan-dialog'),
  saveFileDialog: (opts) => ipcRenderer.invoke('cobitx:save-file-dialog', opts),
  openExternal: (url) => ipcRenderer.invoke('cobitx:open-external', url),
};

contextBridge.exposeInMainWorld('cobitxDesktop', api);
