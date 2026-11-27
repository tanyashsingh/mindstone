/** Renders the first `step` items of a long list and a "Show more" button, so huge lists stay fast. */
import { useState } from "react";

export function Limited<T>({ items, step = 200, render, label = "items" }: { items: T[]; step?: number; render: (item: T) => React.ReactNode; label?: string }) {
  const [shown, setShown] = useState(step);
  const rest = items.length - shown;
  return (
    <>
      {items.slice(0, shown).map(render)}
      {rest > 0 && (
        <div className="flex items-center gap-2 px-2 py-1.5 text-meta text-muted">
          <button className="btn h-7" onClick={() => setShown((n) => n + step)}>Show {Math.min(step, rest).toLocaleString()} more</button>
          <span>{rest.toLocaleString()} more {label} not shown</span>
        </div>
      )}
    </>
  );
}
