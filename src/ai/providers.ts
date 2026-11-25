/**
 * Provider-independent AI layer. Environment-agnostic: runs in Electron's main process
 * (desktop, keys from the OS credential store) or in the renderer (browser build, session-only keys).
 * Claude goes through the official Anthropic SDK; other providers use their documented HTTP APIs.
 */
import Anthropic from "@anthropic-ai/sdk";
import type { AiProviderId } from "@/data/types";

export const PROVIDER_LABELS: Record<AiProviderId, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  gemini: "Gemini",
  ollama: "Ollama (local)",
  openaiCompatible: "OpenAI-compatible (local)",
};
export const LOCAL_PROVIDERS: AiProviderId[] = ["ollama", "openaiCompatible"];
export const NEEDS_KEY: Record<AiProviderId, boolean> = { anthropic: true, openai: true, gemini: true, ollama: false, openaiCompatible: false };

export interface ChatMsg { role: "user" | "assistant"; content: string }
export interface ChatRequest {
  provider: AiProviderId;
  model: string;
  baseUrl: string;
  system: string;
  messages: ChatMsg[];
  maxTokens?: number;
}
export interface ChatResult { text: string; inputTokens: number; outputTokens: number; stopReason: string; servedBy: string }

export class AiError extends Error {
  constructor(message: string, readonly kind: "auth" | "rate" | "network" | "refusal" | "config" | "server") { super(message); }
}

function trimSlash(u: string) { return u.replace(/\/+$/, ""); }

async function readSSE(res: Response, onData: (data: string) => void, signal?: AbortSignal) {
  if (!res.body) throw new AiError("Empty response body", "server");
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    if (signal?.aborted) { await reader.cancel(); break; }
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).replace(/\r$/, "");
      buf = buf.slice(i + 1);
      if (line.startsWith("data:")) onData(line.slice(5).trim());
      else if (line.trim().startsWith("{")) onData(line.trim()); // NDJSON (Ollama)
    }
  }
  if (buf.trim()) onData(buf.trim().replace(/^data:/, "").trim());
}

async function httpError(res: Response): Promise<AiError> {
  let detail = "";
  try { detail = (await res.text()).slice(0, 300); } catch { /* ignore */ }
  const kind = res.status === 401 || res.status === 403 ? "auth" : res.status === 429 ? "rate" : "server";
  return new AiError(`${res.status} ${res.statusText}${detail ? `: ${detail}` : ""}`, kind);
}

async function claudeChat(req: ChatRequest, apiKey: string, onText: (t: string) => void, signal?: AbortSignal): Promise<ChatResult> {
  const client = new Anthropic({
    apiKey,
    baseURL: trimSlash(req.baseUrl) || undefined,
    // Only relevant in the browser build, where the user typed the key themselves for this session.
    dangerouslyAllowBrowser: typeof window !== "undefined",
    maxRetries: 2,
  });
  try {
    const stream = client.beta.messages.stream(
      {
        model: req.model,
        max_tokens: req.maxTokens ?? 16000,
        system: req.system,
        messages: req.messages,
        // Server-side refusal fallback: on a policy decline the API re-runs on a fallback model.
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
      },
      { signal },
    );
    stream.on("text", (t) => onText(t));
    const msg = await stream.finalMessage();
    if (msg.stop_reason === "refusal") throw new AiError("The model declined this request.", "refusal");
    const text = msg.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    return { text, inputTokens: msg.usage.input_tokens, outputTokens: msg.usage.output_tokens, stopReason: msg.stop_reason ?? "", servedBy: msg.model };
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AiError("Claude rejected the API key.", "auth");
    if (e instanceof Anthropic.RateLimitError) throw new AiError("Claude rate limit reached. Try again shortly.", "rate");
    if (e instanceof Anthropic.APIConnectionError) throw new AiError("Could not reach the Claude API. Check your connection.", "network");
    if (e instanceof Anthropic.APIError) throw new AiError(`Claude API error ${e.status ?? ""}: ${e.message}`, "server");
    throw e;
  }
}

async function openaiChat(req: ChatRequest, apiKey: string, onText: (t: string) => void, signal?: AbortSignal): Promise<ChatResult> {
  const res = await fetch(`${trimSlash(req.baseUrl)}/chat/completions`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
    body: JSON.stringify({
      model: req.model,
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "system", content: req.system }, ...req.messages],
    }),
  });
  if (!res.ok) throw await httpError(res);
  let text = "", inT = 0, outT = 0, stop = "";
  await readSSE(res, (d) => {
    if (d === "[DONE]") return;
    try {
      const j = JSON.parse(d);
      const delta = j.choices?.[0]?.delta?.content;
      if (delta) { text += delta; onText(delta); }
      if (j.choices?.[0]?.finish_reason) stop = j.choices[0].finish_reason;
      if (j.usage) { inT = j.usage.prompt_tokens ?? 0; outT = j.usage.completion_tokens ?? 0; }
    } catch { /* partial line */ }
  }, signal);
  return { text, inputTokens: inT, outputTokens: outT, stopReason: stop, servedBy: req.model };
}

async function geminiChat(req: ChatRequest, apiKey: string, onText: (t: string) => void, signal?: AbortSignal): Promise<ChatResult> {
  const url = `${trimSlash(req.baseUrl)}/models/${encodeURIComponent(req.model)}:streamGenerateContent?alt=sse`;
  const res = await fetch(url, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: req.system }] },
      contents: req.messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    }),
  });
  if (!res.ok) throw await httpError(res);
  let text = "", inT = 0, outT = 0, stop = "";
  await readSSE(res, (d) => {
    try {
      const j = JSON.parse(d);
      const t = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? "").join("");
      if (t) { text += t; onText(t); }
      if (j.candidates?.[0]?.finishReason) stop = j.candidates[0].finishReason;
      if (j.usageMetadata) { inT = j.usageMetadata.promptTokenCount ?? 0; outT = j.usageMetadata.candidatesTokenCount ?? 0; }
    } catch { /* ignore */ }
  }, signal);
  return { text, inputTokens: inT, outputTokens: outT, stopReason: stop, servedBy: req.model };
}

async function ollamaChat(req: ChatRequest, onText: (t: string) => void, signal?: AbortSignal): Promise<ChatResult> {
  const res = await fetch(`${trimSlash(req.baseUrl)}/api/chat`, {
    method: "POST",
    signal,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: req.model, stream: true, messages: [{ role: "system", content: req.system }, ...req.messages] }),
  });
  if (!res.ok) throw await httpError(res);
  let text = "", inT = 0, outT = 0;
  await readSSE(res, (d) => {
    try {
      const j = JSON.parse(d);
      const t = j.message?.content;
      if (t) { text += t; onText(t); }
      if (j.done) { inT = j.prompt_eval_count ?? 0; outT = j.eval_count ?? 0; }
    } catch { /* ignore */ }
  }, signal);
  return { text, inputTokens: inT, outputTokens: outT, stopReason: "stop", servedBy: req.model };
}

export async function streamChat(req: ChatRequest, apiKey: string, onText: (t: string) => void, signal?: AbortSignal): Promise<ChatResult> {
  if (!req.model) throw new AiError("No model configured for this provider.", "config");
  if (NEEDS_KEY[req.provider] && !apiKey) throw new AiError(`No API key stored for ${PROVIDER_LABELS[req.provider]}.`, "config");
  try {
    switch (req.provider) {
      case "anthropic": return await claudeChat(req, apiKey, onText, signal);
      case "openai":
      case "openaiCompatible": return await openaiChat(req, apiKey, onText, signal);
      case "gemini": return await geminiChat(req, apiKey, onText, signal);
      case "ollama": return await ollamaChat(req, onText, signal);
    }
  } catch (e) {
    if (e instanceof AiError) throw e;
    if (e instanceof Error && e.name === "AbortError") throw new AiError("Cancelled", "network");
    throw new AiError(`Could not reach ${PROVIDER_LABELS[req.provider]}: ${e instanceof Error ? e.message : String(e)}`, "network");
  }
}

export interface EmbedRequest { provider: AiProviderId; model: string; baseUrl: string; texts: string[] }

/** Embeddings. Claude has no embeddings endpoint; use a local (Ollama) or OpenAI/Gemini model. */
export async function embed(req: EmbedRequest, apiKey: string): Promise<number[][]> {
  if (!req.model) throw new AiError("No embedding model configured.", "config");
  const base = trimSlash(req.baseUrl);
  if (req.provider === "ollama") {
    const res = await fetch(`${base}/api/embed`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: req.model, input: req.texts }) });
    if (!res.ok) throw await httpError(res);
    return (await res.json()).embeddings;
  }
  if (req.provider === "openai" || req.provider === "openaiCompatible") {
    const res = await fetch(`${base}/embeddings`, { method: "POST", headers: { "content-type": "application/json", ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) }, body: JSON.stringify({ model: req.model, input: req.texts }) });
    if (!res.ok) throw await httpError(res);
    return (await res.json()).data.map((d: { embedding: number[] }) => d.embedding);
  }
  if (req.provider === "gemini") {
    const res = await fetch(`${base}/models/${encodeURIComponent(req.model)}:batchEmbedContents`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ requests: req.texts.map((t) => ({ model: `models/${req.model}`, content: { parts: [{ text: t }] } })) }),
    });
    if (!res.ok) throw await httpError(res);
    return (await res.json()).embeddings.map((e: { values: number[] }) => e.values);
  }
  throw new AiError("Claude does not offer an embeddings API. Choose Ollama, OpenAI or Gemini for semantic search.", "config");
}

export async function listModels(provider: AiProviderId, baseUrl: string, apiKey: string): Promise<string[]> {
  const base = trimSlash(baseUrl);
  if (provider === "ollama") {
    const res = await fetch(`${base}/api/tags`);
    if (!res.ok) throw await httpError(res);
    return (await res.json()).models.map((m: { name: string }) => m.name);
  }
  if (provider === "anthropic") {
    const client = new Anthropic({ apiKey, baseURL: base || undefined, dangerouslyAllowBrowser: typeof window !== "undefined" });
    const out: string[] = [];
    for await (const m of client.models.list()) out.push(m.id);
    return out;
  }
  if (provider === "gemini") {
    const res = await fetch(`${base}/models`, { headers: { "x-goog-api-key": apiKey } });
    if (!res.ok) throw await httpError(res);
    return (await res.json()).models.map((m: { name: string }) => m.name.replace(/^models\//, ""));
  }
  const res = await fetch(`${base}/models`, { headers: apiKey ? { authorization: `Bearer ${apiKey}` } : {} });
  if (!res.ok) throw await httpError(res);
  return (await res.json()).data.map((m: { id: string }) => m.id);
}
