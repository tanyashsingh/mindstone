import type { AiProviderId } from "@/data/types";
import { useSettings } from "@/store/settings";
import { uid } from "@/lib/util";
import { AiError, LOCAL_PROVIDERS, embed as embedDirect, listModels as listDirect, streamChat, type ChatMsg, type ChatResult } from "./providers";

/**
 * Renderer-side AI entry point. Desktop: calls go through the Electron main process, which reads keys
 * from the OS credential store (DPAPI on Windows). Browser: keys live only in this tab's memory.
 */
const sessionKeys = new Map<AiProviderId, string>();

export async function setApiKey(p: AiProviderId, key: string) {
  if (window.rea) await window.rea.secrets.set(`ai:${p}`, key);
  else sessionKeys.set(p, key);
}
export async function hasApiKey(p: AiProviderId): Promise<boolean> {
  return window.rea ? window.rea.secrets.has(`ai:${p}`) : sessionKeys.has(p);
}
export async function deleteApiKey(p: AiProviderId) {
  if (window.rea) await window.rea.secrets.delete(`ai:${p}`);
  else sessionKeys.delete(p);
}

export function activeProvider() {
  const ai = useSettings.getState().s.ai;
  if (ai.active === "none") return null;
  return { id: ai.active, cfg: ai.providers[ai.active], isLocal: LOCAL_PROVIDERS.includes(ai.active) };
}

/** True when sending content requires the cloud opt-in. */
export function requiresCloudConsent(): boolean {
  const p = activeProvider();
  return !!p && !p.isLocal && !useSettings.getState().s.ai.allowCloud;
}

export async function chat(system: string, messages: ChatMsg[], onText: (t: string) => void, signal?: AbortSignal): Promise<ChatResult & { provider: AiProviderId; model: string }> {
  const p = activeProvider();
  if (!p) throw new AiError("No AI provider is enabled. Choose one in Settings → AI providers.", "config");
  if (requiresCloudConsent()) throw new AiError("Cloud AI is off. Allow cloud providers in Settings → AI before sending content off this device.", "config");
  const req = { provider: p.id, model: p.cfg.model, baseUrl: p.cfg.baseUrl, system, messages };
  if (window.rea) {
    const id = uid();
    const off = window.rea.ai.onChunk(id, onText);
    const abort = () => window.rea!.ai.abort(id);
    signal?.addEventListener("abort", abort);
    try {
      const res = await window.rea.ai.chat(id, req);
      if ("error" in res) throw new AiError(res.error, res.kind as AiError["kind"]);
      return { ...res, provider: p.id, model: p.cfg.model };
    } finally {
      off();
      signal?.removeEventListener("abort", abort);
    }
  }
  const res = await streamChat(req, sessionKeys.get(p.id) ?? "", onText, signal);
  return { ...res, provider: p.id, model: p.cfg.model };
}

export async function embedTexts(texts: string[]): Promise<{ vectors: number[][]; model: string } | null> {
  const p = activeProvider();
  if (!p || !p.cfg.embedModel || p.id === "anthropic") return null;
  if (requiresCloudConsent()) return null;
  const req = { provider: p.id, model: p.cfg.embedModel, baseUrl: p.cfg.baseUrl, texts };
  const vectors = window.rea ? await window.rea.ai.embed(req) : await embedDirect(req, sessionKeys.get(p.id) ?? "");
  if (!Array.isArray(vectors)) throw new AiError((vectors as { error: string }).error, "server");
  return { vectors, model: `${p.id}:${p.cfg.embedModel}` };
}

export async function listModels(p: AiProviderId): Promise<string[]> {
  const cfg = useSettings.getState().s.ai.providers[p];
  if (window.rea) {
    const r = await window.rea.ai.listModels({ provider: p, baseUrl: cfg.baseUrl });
    if (!Array.isArray(r)) throw new Error(r.error);
    return r;
  }
  return listDirect(p, cfg.baseUrl, sessionKeys.get(p) ?? "");
}
