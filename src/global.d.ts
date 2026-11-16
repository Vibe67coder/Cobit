export {};

export interface CobitxDesktopBridge {
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

declare global {
  interface Window {
    cobitxDesktop?: CobitxDesktopBridge;
  }
}
