// Runs in the sandboxed preload. Exposes a narrow, typed bridge; no Node APIs reach the page.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("rea", {
  platform: process.platform,
  version: process.versions.electron,
  notify: (title: string, body: string) => ipcRenderer.invoke("rea:notify", title, body),
  newWindow: () => ipcRenderer.invoke("rea:newWindow"),
  dataPath: () => ipcRenderer.invoke("rea:dataPath"),
  secrets: {
    available: () => ipcRenderer.invoke("rea:secrets:available"),
    set: (name: string, value: string) => ipcRenderer.invoke("rea:secrets:set", name, value),
    has: (name: string) => ipcRenderer.invoke("rea:secrets:has", name),
    delete: (name: string) => ipcRenderer.invoke("rea:secrets:delete", name),
  },
  ai: {
    chat: (id: string, req: unknown) => ipcRenderer.invoke("rea:ai:chat", id, req),
    onChunk: (id: string, cb: (chunk: string) => void) => {
      const ch = `rea:ai:chunk:${id}`;
      const fn = (_e: unknown, chunk: string) => cb(chunk);
      ipcRenderer.on(ch, fn);
      return () => ipcRenderer.removeListener(ch, fn);
    },
    abort: (id: string) => ipcRenderer.send("rea:ai:abort", id),
    embed: (req: unknown) => ipcRenderer.invoke("rea:ai:embed", req),
    listModels: (req: unknown) => ipcRenderer.invoke("rea:ai:listModels", req),
  },
});
