// Runs in the sandboxed preload. Exposes a narrow, typed bridge; no Node APIs reach the page.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("rea", {
  platform: process.platform,
  version: process.versions.electron,
  notify: (title: string, body: string) => ipcRenderer.invoke("rea:notify", title, body),
  newWindow: () => ipcRenderer.invoke("rea:newWindow"),
  dataPath: () => ipcRenderer.invoke("rea:dataPath"),
  log: (level: string, message: string) => ipcRenderer.invoke("rea:log", level, message),
  openLogs: () => ipcRenderer.invoke("rea:logs:open"),
  backup: {
    save: (name: string, json: string) => ipcRenderer.invoke("rea:backup:save", name, json),
    list: () => ipcRenderer.invoke("rea:backup:list"),
    open: () => ipcRenderer.invoke("rea:backup:open"),
  },
  updates: {
    configure: (enabled: boolean) => ipcRenderer.invoke("rea:update:configure", enabled),
    check: () => ipcRenderer.invoke("rea:update:check"),
    state: () => ipcRenderer.invoke("rea:update:state"),
    install: () => ipcRenderer.invoke("rea:update:install"),
    onState: (cb: (s: unknown) => void) => {
      const fn = (_e: unknown, s: unknown) => cb(s);
      ipcRenderer.on("rea:update:state", fn);
      return () => ipcRenderer.removeListener("rea:update:state", fn);
    },
  },
  fetchCalendar: (url: string) => ipcRenderer.invoke("rea:feed:fetch", url),
  clipper: {
    state: () => ipcRenderer.invoke("rea:clipper:state"),
    set: (on: boolean) => ipcRenderer.invoke("rea:clipper:set", on),
    newCode: () => ipcRenderer.invoke("rea:clipper:newCode"),
    openFolder: () => ipcRenderer.invoke("rea:clipper:folder"),
    onClip: (cb: (clip: unknown) => void) => {
      const fn = (_e: unknown, clip: unknown) => cb(clip);
      ipcRenderer.on("rea:clip", fn);
      return () => ipcRenderer.removeListener("rea:clip", fn);
    },
  },
  sync: {
    http: (method: string, url: string, headers: Record<string, string>, body: Uint8Array | null) => ipcRenderer.invoke("rea:sync:http", method, url, headers, body),
    chooseFolder: () => ipcRenderer.invoke("rea:sync:folder:choose"),
    folder: () => ipcRenderer.invoke("rea:sync:folder:get"),
    folderRead: (rel: string) => ipcRenderer.invoke("rea:sync:folder:read", rel),
    folderWrite: (rel: string, bytes: Uint8Array) => ipcRenderer.invoke("rea:sync:folder:write", rel, bytes),
    folderList: () => ipcRenderer.invoke("rea:sync:folder:list"),
  },
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
