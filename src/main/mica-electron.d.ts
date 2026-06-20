declare module "mica-electron" {
  import type { BrowserWindow } from "electron";

  export class MicaBrowserWindow extends BrowserWindow {
    setLightTheme(): void;
    setMicaEffect(): void;
  }

  export const IS_WINDOWS_11: boolean;
}
