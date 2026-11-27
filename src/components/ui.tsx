import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { FileText, Table2, X } from "lucide-react";
import { useApp } from "@/store/app";
import { cx } from "@/lib/util";

/** Click-outside + Escape aware popover anchored to a rect. */
export function Popover({ anchor, onClose, children, className, align = "start" }: {
  anchor: DOMRect | { x: number; y: number } | null; onClose: () => void; children: ReactNode; className?: string; align?: "start" | "end";
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const ax = "left" in anchor ? (align === "end" ? anchor.right - r.width : anchor.left) : anchor.x;
    const ay = "bottom" in anchor ? anchor.bottom + 4 : anchor.y;
    const left = Math.max(8, Math.min(ax, innerWidth - r.width - 8));
    const top = ay + r.height > innerHeight - 8 ? Math.max(8, ("top" in anchor ? anchor.top : ay) - r.height - 4) : ay;
    setPos({ left, top });
  }, [anchor, align]);
  const isOpen = !!anchor;
  useEffect(() => {
    // Only an open popover listens; closed ones must not swallow Escape or clicks meant for dialogs.
    if (!isOpen) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose(); };
    const key = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); onClose(); } };
    const t = setTimeout(() => document.addEventListener("mousedown", down), 0);
    document.addEventListener("keydown", key, true);
    return () => { clearTimeout(t); document.removeEventListener("mousedown", down); document.removeEventListener("keydown", key, true); };
  }, [onClose, isOpen]);
  if (!anchor) return null;
  return createPortal(
    <div ref={ref} className={cx("menu fixed z-50 anim-in", className)} style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}>
      {children}
    </div>,
    document.body,
  );
}

export function useAnchor() {
  const [anchor, setAnchor] = useState<DOMRect | { x: number; y: number } | null>(null);
  return {
    anchor,
    openAt: (e: React.MouseEvent) => setAnchor((e.currentTarget as HTMLElement).getBoundingClientRect()),
    openAtPoint: (e: React.MouseEvent) => { e.preventDefault(); setAnchor({ x: e.clientX, y: e.clientY }); },
    close: () => setAnchor(null),
  };
}

export function MenuItem({ icon, children, onClick, danger, shortcut, disabled }: { icon?: ReactNode; children: ReactNode; onClick?: (e: React.MouseEvent) => void; danger?: boolean; shortcut?: string; disabled?: boolean }) {
  return (
    <button type="button" disabled={disabled} className={cx("menu-item disabled:opacity-40", danger && "text-danger")} onClick={onClick}>
      {icon && <span className="text-muted [&>svg]:size-4">{icon}</span>}
      <span className="flex-1 truncate">{children}</span>
      {shortcut && <span className="text-caption text-faint">{shortcut}</span>}
    </button>
  );
}
export const MenuSep = () => <div className="my-1 h-px bg-line" />;

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]), [contenteditable="true"]';

/** Keeps keyboard focus inside a dialog while it is open and gives it back to where it was when it closes. */
// The last element focused outside any dialog: a dialog's autofocus runs before its effects, so it is remembered here.
let lastOutside: HTMLElement | null = null;
if (typeof document !== "undefined") document.addEventListener("focusin", (e) => { const t = e.target as HTMLElement; if (!t.closest?.("[aria-modal=true]")) lastOutside = t; }, true);

export function useFocusTrap(open: boolean, box: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement as HTMLElement | null;
    const before = active && !active.closest("[aria-modal=true]") ? active : lastOutside;
    // Let autoFocus inside the dialog win; otherwise focus its first control, or the dialog itself.
    const t = setTimeout(() => {
      const el = box.current;
      if (!el || el.contains(document.activeElement)) return;
      (el.querySelector<HTMLElement>(FOCUSABLE) ?? el).focus();
    }, 0);
    const tab = (e: KeyboardEvent) => {
      const el = box.current;
      if (e.key !== "Tab" || !el) return;
      const items = [...el.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
      if (!items.length) { e.preventDefault(); return; }
      const first = items[0]!, last = items[items.length - 1]!;
      if (e.shiftKey && (document.activeElement === first || !el.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || !el.contains(document.activeElement))) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", tab);
    return () => { clearTimeout(t); document.removeEventListener("keydown", tab); // Give focus back only if nothing else (say, a page the dialog opened) has taken it.
      const now = document.activeElement;
      if (before?.isConnected && (!now || now === document.body || box.current?.contains(now))) before.focus({ preventScroll: true });
    };
  }, [open, box]);
}

export function Modal({ open, onClose, title, children, width = 520, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number; footer?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useFocusTrap(open, box);
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={box} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={title ? titleId : undefined} className="panel anim-in flex max-h-[80vh] flex-col shadow-[var(--shadow)] outline-none" style={{ width: `min(${width}px, 94vw)` }}>
        {title && (
          <div className="flex items-center justify-between border-b border-line px-4 h-11">
            <div id={titleId} className="font-medium">{title}</div>
            <button className="icon-btn" aria-label="Close" onClick={onClose}><X size={16} /></button>
          </div>
        )}
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        {footer && <div className="flex justify-end gap-2 border-t border-line px-4 py-2.5">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

// ---- Promise-based confirm / prompt dialogs ---------------------------------
export interface Choice { value: string; label: string; hint?: string }
interface DialogReq { kind: "confirm" | "prompt" | "choose"; title: string; body?: string; danger?: boolean; confirmLabel?: string; initial?: string; choices?: Choice[]; password?: boolean; resolve: (v: string | boolean | null) => void }
const useDialog = create<{ req: DialogReq | null; set: (r: DialogReq | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }));

export function confirmDialog(title: string, body?: string, opts: { danger?: boolean; confirmLabel?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => useDialog.getState().set({ kind: "confirm", title, body, ...opts, resolve: (v) => resolve(Boolean(v)) }));
}
export function promptDialog(title: string, initial = "", body?: string, opts: { password?: boolean } = {}): Promise<string | null> {
  return new Promise((resolve) => useDialog.getState().set({ kind: "prompt", title, body, initial, password: opts.password, resolve: (v) => resolve(typeof v === "string" ? v : null) }));
}

/** Pick one of several options (with a filter box). Resolves to the chosen value, or null if cancelled. */
export function chooseDialog(title: string, choices: Choice[], body?: string): Promise<string | null> {
  return new Promise((resolve) => useDialog.getState().set({ kind: "choose", title, body, choices, resolve: (v) => resolve(typeof v === "string" ? v : null) }));
}

export function DialogHost() {
  const { req, set } = useDialog();
  const [value, setValue] = useState("");
  useEffect(() => { setValue(req?.initial ?? ""); }, [req]);
  if (!req) return null;
  const done = (v: string | boolean | null) => { req.resolve(v); set(null); };
  return (
    <Modal open onClose={() => done(null)} title={req.title} width={420}
      footer={<>
        <button className="btn-outline" onClick={() => done(null)}>Cancel</button>
        <button className={req.danger ? "btn bg-danger text-white hover:bg-danger" : "btn-primary"} autoFocus={req.kind === "confirm"}
          hidden={req.kind === "choose"} onClick={() => done(req.kind === "prompt" ? value : true)}>{req.confirmLabel ?? (req.kind === "prompt" ? "OK" : "Confirm")}</button>
      </>}>
      {req.body && <p className="mb-3 whitespace-pre-wrap text-ui text-muted">{req.body}</p>}
      {req.kind === "choose" && <>
        <input autoFocus className="input mb-2" placeholder="Filter…" aria-label="Filter" value={value} onChange={(e) => setValue(e.target.value)} />
        <div className="max-h-72 overflow-y-auto" role="listbox" aria-label={req.title}>
          {(req.choices ?? []).filter((c) => !value || `${c.label} ${c.hint ?? ""}`.toLowerCase().includes(value.toLowerCase())).map((c) => (
            <button key={c.value} role="option" aria-selected={false} className="block w-full rounded-md px-2 py-1.5 text-left hover:bg-hover" onClick={() => done(c.value)}>
              <div className="truncate text-ui">{c.label}</div>
              {c.hint && <div className="truncate text-meta text-muted">{c.hint}</div>}
            </button>
          ))}
          {!(req.choices ?? []).length && <p className="px-2 py-3 text-ui text-muted">Nothing to choose from yet.</p>}
        </div>
      </>}
      {req.kind === "prompt" && (
        <input autoFocus className="input" type={req.password ? "password" : "text"} aria-label={req.title} value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && done(value)} />
      )}
    </Modal>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-1 text-faint [&>svg]:size-8">{icon}</div>}
      <div className="font-medium">{title}</div>
      {body && <div className="max-w-sm text-ui text-muted">{body}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ lines = 4 }: { lines?: number }) {
  return <div className="space-y-2.5 p-2">{Array.from({ length: lines }, (_, i) => <div key={i} className="skeleton h-4" style={{ width: `${90 - i * 12}%` }} />)}</div>;
}

export function Chip({ color = "gray", children, onRemove }: { color?: string; children: ReactNode; onRemove?: () => void }) {
  return (
    <span className={cx("chip", `c-${color}`)}>
      {children}
      {onRemove && <button className="ml-1 opacity-60 hover:opacity-100" onClick={(e) => { e.stopPropagation(); onRemove(); }} aria-label="Remove">×</button>}
    </span>
  );
}

export function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <button type="button" role="switch" aria-checked={checked} aria-label={label} onClick={() => onChange(!checked)}
      className={cx("relative h-[18px] w-8 rounded-full transition-colors", checked ? "bg-accent" : "bg-active")}>
      <span className={cx("absolute top-[2px] size-[14px] rounded-full bg-white shadow transition-transform", checked ? "translate-x-[16px]" : "translate-x-[2px]")} />
    </button>
  );
}

const EMOJI = "📄 📝 📚 📌 ⭐ 💡 🎯 🚀 ✅ 📅 🧠 🔬 💼 🏠 🎨 🧩 📊 📈 💰 🛠️ ⚙️ 🌱 🔥 ❤️ 🎓 ✈️ 🍳 🏃 🎵 📷 🗂️ 🧭 🔒 🌍 ☕ 🐛".split(" ");
export function IconPicker({ onPick, onClose, anchor }: { onPick: (v: string) => void; onClose: () => void; anchor: DOMRect | { x: number; y: number } | null }) {
  return (
    <Popover anchor={anchor} onClose={onClose} className="w-[264px]">
      <div className="grid grid-cols-8 gap-0.5 p-1">
        {EMOJI.map((e) => (
          <button key={e} className="flex size-7 items-center justify-center rounded hover:bg-hover text-[17px]" onClick={() => { onPick(e); onClose(); }}>{e}</button>
        ))}
      </div>
      <MenuSep />
      <MenuItem onClick={() => { onPick(""); onClose(); }}>Remove icon</MenuItem>
    </Popover>
  );
}

/** The icon a person chose ("▦" was the automatic icon of databases before 0.5.2 and counts as none). */
export const ownIcon = (p: { icon?: string | null } | null | undefined) => (p?.icon && p.icon !== "▦" ? p.icon : "");

/** A page's icon: its own emoji when it has one, otherwise one line icon for pages and another for databases. */
export function PageIcon({ page, size = 14 }: { page: { icon?: string | null; kind?: string } | null | undefined; size?: number }) {
  if (ownIcon(page)) return <>{ownIcon(page)}</>;
  const Icon = page?.kind === "database" ? Table2 : FileText;
  return <Icon size={size} aria-hidden className="inline align-[-2px] text-faint" />;
}

/** Copies text and says so, or says why it could not. */
export async function copyText(text: string, what = "Copied") {
  try {
    await navigator.clipboard.writeText(text);
    useApp.getState().toast(`${what} to the clipboard`, "success");
  } catch {
    useApp.getState().toast("Couldn't copy: the clipboard isn't available here. Select the text and press Ctrl+C.", "error");
  }
}
