const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.platform);

/** Match "mod+shift+k" style shortcut strings. `mod` is Ctrl on Windows/Linux and Cmd on macOS. */
export function matchShortcut(e: KeyboardEvent, spec: string): boolean {
  if (!spec) return false;
  const parts = spec.toLowerCase().split("+");
  const key = parts.pop()!;
  const want = { mod: parts.includes("mod"), shift: parts.includes("shift"), alt: parts.includes("alt") };
  const mod = isMac ? e.metaKey : e.ctrlKey;
  if (mod !== want.mod || e.shiftKey !== want.shift || e.altKey !== want.alt) return false;
  const k = e.key.toLowerCase();
  return k === key || (key === "," && e.code === "Comma") || (key === "\\" && e.code === "Backslash") || (key.length === 1 && e.code === `Key${key.toUpperCase()}`);
}

export function shortcutLabel(spec: string): string {
  return spec.split("+").map((p) => (p === "mod" ? (isMac ? "⌘" : "Ctrl") : p === "shift" ? "Shift" : p === "alt" ? "Alt" : p.length === 1 ? p.toUpperCase() : p[0]!.toUpperCase() + p.slice(1))).join(" + ");
}

/** Shortcuts that conflict with OS / editor bindings (checked when the user customises). */
export const RESERVED = ["mod+b", "mod+i", "mod+u", "mod+z", "mod+shift+z", "mod+y", "mod+c", "mod+v", "mod+x", "mod+a", "mod+f", "alt+f4", "mod+e"];
