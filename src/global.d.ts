// Bridge exposed by electron/preload.ts via contextBridge. Absent in the browser build.
interface ReaChatReq { provider: import("./data/types").AiProviderId; model: string; baseUrl: string; system: string; messages: { role: "user" | "assistant"; content: string }[] }
interface ReaChatRes { text: string; inputTokens: number; outputTokens: number; stopReason: string; servedBy: string }
interface ReaBridge {
  platform: string;
  version: string;
  notify(title: string, body: string): Promise<void>;
  newWindow(): Promise<void>;
  secrets: {
    available(): Promise<boolean>;
    set(name: string, value: string): Promise<void>;
    has(name: string): Promise<boolean>;
    delete(name: string): Promise<void>;
  };
  ai: {
    chat(id: string, req: ReaChatReq): Promise<ReaChatRes | { error: string; kind: string }>;
    onChunk(id: string, cb: (chunk: string) => void): () => void;
    abort(id: string): void;
    embed(req: { provider: import("./data/types").AiProviderId; model: string; baseUrl: string; texts: string[] }): Promise<number[][] | { error: string }>;
    listModels(req: { provider: import("./data/types").AiProviderId; baseUrl: string }): Promise<string[] | { error: string }>;
  };
  dataPath(): Promise<string>;
  log(level: "info" | "warn" | "error", message: string): Promise<void>;
  openLogs(): Promise<string>;
  backup: {
    save(name: string, json: string): Promise<{ path: string }>;
    list(): Promise<{ name: string; size: number; at: number }[]>;
    open(): Promise<string>;
  };
  sync: {
    http(method: "GET" | "PUT", url: string, headers: Record<string, string>, body: Uint8Array | null): Promise<{ status: number; body: Uint8Array }>;
    chooseFolder(): Promise<string | null>;
    folder(): Promise<string | null>;
    folderRead(rel: string): Promise<Uint8Array | null>;
    folderWrite(rel: string, bytes: Uint8Array): Promise<void>;
    folderList(): Promise<string[]>;
  };
  updates: {
    configure(enabled: boolean): Promise<void>;
    check(): Promise<ReaUpdateState>;
    state(): Promise<ReaUpdateState>;
    install(): Promise<void>;
    onState(cb: (s: ReaUpdateState) => void): () => void;
  };
}
interface ReaUpdateState { status: "idle" | "checking" | "none" | "downloading" | "ready" | "error" | "disabled"; version?: string; message?: string }
interface Window { rea?: ReaBridge }
/** App version from package.json, injected at build time. */
declare const __APP_VERSION__: string;
