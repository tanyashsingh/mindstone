import { X } from "lucide-react";
import { useApp } from "@/store/app";
import { cx } from "@/lib/util";

export function Toasts() {
  const { toasts, dismissToast } = useApp();
  return (
    <div className="pointer-events-none fixed bottom-9 right-4 z-[60] flex flex-col gap-2" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={cx("panel anim-in pointer-events-auto flex min-w-[240px] max-w-[380px] items-center gap-3 px-3 py-2 text-ui shadow-[var(--shadow)]", t.tone === "error" && "border-danger/40", t.tone === "success" && "border-success/40")}>
          <span className="flex-1">{t.text}</span>
          {t.action && <button className="btn h-6 px-2 text-accent" onClick={() => { t.action!.run(); dismissToast(t.id); }}>{t.action.label}</button>}
          <button className="icon-btn size-5" aria-label="Dismiss" onClick={() => dismissToast(t.id)}><X size={12} /></button>
        </div>
      ))}
    </div>
  );
}
