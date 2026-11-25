import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { create } from "zustand";
import { X } from "lucide-react";
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
      {shortcut && <span className="text-[11px] text-faint">{shortcut}</span>}
    </button>
  );
}
export const MenuSep = () => <div className="my-1 h-px bg-line" />;

export function Modal({ open, onClose, title, children, width = 520, footer }: { open: boolean; onClose: () => void; title?: ReactNode; children: ReactNode; width?: number; footer?: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", key);
    return () => document.removeEventListener("keydown", key);
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 pt-[10vh]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" className="panel anim-in flex max-h-[80vh] flex-col shadow-[var(--shadow)]" style={{ width: `min(${width}px, 94vw)` }}>
        {title && (
          <div className="flex items-center justify-between border-b border-line px-4 h-11">
            <div className="font-medium">{title}</div>
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
interface DialogReq { kind: "confirm" | "prompt"; title: string; body?: string; danger?: boolean; confirmLabel?: string; initial?: string; resolve: (v: string | boolean | null) => void }
const useDialog = create<{ req: DialogReq | null; set: (r: DialogReq | null) => void }>((set) => ({ req: null, set: (req) => set({ req }) }));

export function confirmDialog(title: string, body?: string, opts: { danger?: boolean; confirmLabel?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => useDialog.getState().set({ kind: "confirm", title, body, ...opts, resolve: (v) => resolve(Boolean(v)) }));
}
export function promptDialog(title: string, initial = "", body?: string): Promise<string | null> {
  return new Promise((resolve) => useDialog.getState().set({ kind: "prompt", title, body, initial, resolve: (v) => resolve(typeof v === "string" ? v : null) }));
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
          onClick={() => done(req.kind === "prompt" ? value : true)}>{req.confirmLabel ?? (req.kind === "prompt" ? "OK" : "Confirm")}</button>
      </>}>
      {req.body && <p className="mb-3 whitespace-pre-wrap text-[13px] text-muted">{req.body}</p>}
      {req.kind === "prompt" && (
        <input autoFocus className="input" value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => e.key === "Enter" && done(value)} />
      )}
    </Modal>
  );
}

export function EmptyState({ icon, title, body, action }: { icon?: ReactNode; title: string; body?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-14 text-center">
      {icon && <div className="mb-1 text-faint [&>svg]:size-8">{icon}</div>}
      <div className="font-medium">{title}</div>
      {body && <div className="max-w-sm text-[13px] text-muted">{body}</div>}
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
