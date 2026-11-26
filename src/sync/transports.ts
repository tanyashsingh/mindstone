/** Where change files live: a sync server (any device) or a folder (desktop app). */
import type { SpaceInfo, Transport } from "./engine";

interface HttpRes { status: number; body: Uint8Array }
/** The desktop app sends sync requests from the main process (not limited by the page's network policy). */
async function http(method: "GET" | "PUT", url: string, headers: Record<string, string>, body?: Uint8Array): Promise<HttpRes> {
  if (window.rea?.sync) return window.rea.sync.http(method, url, headers, body ?? null);
  const res = await fetch(url, { method, headers, body: body as BodyInit | undefined, cache: "no-store" });
  return { status: res.status, body: new Uint8Array(await res.arrayBuffer()) };
}

export function normalizeServerUrl(u: string): string {
  const url = new URL(u.trim());
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Use an http:// or https:// address.");
  return url.origin + url.pathname.replace(/\/+$/, "");
}

export function serverTransport(base: string, space: string, token: string): Transport {
  const root = `${normalizeServerUrl(base)}/v1/spaces/${encodeURIComponent(space)}`;
  const auth = { authorization: `Bearer ${token}` };
  const fail = (what: string, r: HttpRes) => new Error(r.status === 401 ? "The sync server didn't accept this device. Check the sync passphrase." : `Sync server ${what} failed (${r.status})`);
  return {
    async readSpace() {
      const r = await http("GET", root, {});
      if (r.status === 404) return null;
      if (r.status !== 200) throw fail("lookup", r);
      return JSON.parse(new TextDecoder().decode(r.body)) as SpaceInfo;
    },
    async createSpace(info) {
      const r = await http("PUT", root, { ...auth, "content-type": "application/json" }, new TextEncoder().encode(JSON.stringify(info)));
      if (r.status !== 201) throw fail("setup", r);
    },
    async list() {
      const r = await http("GET", `${root}/files`, auth);
      if (r.status !== 200) throw fail("listing", r);
      return JSON.parse(new TextDecoder().decode(r.body)) as { device: string; seq: number }[];
    },
    async read(device, seq) {
      const r = await http("GET", `${root}/files/${device}/${seq}`, auth);
      if (r.status !== 200) throw fail("download", r);
      return r.body;
    },
    async write(device, seq, bytes) {
      const r = await http("PUT", `${root}/files/${device}/${seq}`, { ...auth, "content-type": "application/octet-stream" }, bytes);
      if (r.status !== 201 && r.status !== 409) throw fail("upload", r);
    },
  };
}

/** Files under "<chosen folder>/Mindstone Sync/": space.json and <device>/<seq>.bin. */
export function folderTransport(): Transport {
  const f = window.rea?.sync;
  if (!f) throw new Error("Folder sync is available in the desktop app.");
  return {
    async readSpace() {
      const b = await f.folderRead("space.json");
      return b ? (JSON.parse(new TextDecoder().decode(b)) as SpaceInfo) : null;
    },
    async createSpace(info) { await f.folderWrite("space.json", new TextEncoder().encode(JSON.stringify(info))); },
    async list() {
      return (await f.folderList()).map((p) => /^([A-Za-z0-9_-]{8,64})\/(\d+)\.bin$/.exec(p)).filter(Boolean).map((m) => ({ device: m![1]!, seq: Number(m![2]) }));
    },
    async read(device, seq) {
      const b = await f.folderRead(`${device}/${seq}.bin`);
      if (!b) throw new Error(`Change file ${device}/${seq} is missing`);
      return b;
    },
    async write(device, seq, bytes) { await f.folderWrite(`${device}/${seq}.bin`, bytes); },
  };
}
