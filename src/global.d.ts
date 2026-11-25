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
}
interface Window { rea?: ReaBridge }
