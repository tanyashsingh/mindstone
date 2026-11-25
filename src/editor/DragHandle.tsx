import { useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { NodeSelection } from "@tiptap/pm/state";
import { closeHistory } from "@tiptap/pm/history";
import { GripVertical } from "lucide-react";

interface Hover { pos: number; top: number; height: number; dom: HTMLElement }

/**
 * A ⋮⋮ handle beside the hovered top-level block. Dragging it hands ProseMirror a node selection
 * through `view.dragging`, so the editor's own drop logic moves the block (undoable as one step).
 * Clicking it selects the whole block, so Backspace, Ctrl+C, Ctrl+D and Alt+Shift+↑/↓ act on it.
 */
export function DragHandle({ editor, container }: { editor: Editor; container: React.RefObject<HTMLDivElement | null> }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const frame = useRef(0);
  const pressed = useRef(false); // freeze the target while the handle is held or dragged

  useEffect(() => {
    const el = container.current;
    if (!el) return;
    const find = (clientY: number) => {
      const view = editor.view;
      const box = el.getBoundingClientRect();
      let found: Hover | null = null;
      view.state.doc.forEach((_node, offset) => {
        if (found) return;
        const dom = view.nodeDOM(offset);
        if (!(dom instanceof HTMLElement)) return;
        const r = dom.getBoundingClientRect();
        if (clientY >= r.top - 4 && clientY <= r.bottom + 4) found = { pos: offset, top: r.top - box.top, height: r.height, dom };
      });
      return found;
    };
    const move = (e: MouseEvent) => {
      if (pressed.current) return;
      if (!editor.isEditable) return setHover(null);
      cancelAnimationFrame(frame.current);
      frame.current = requestAnimationFrame(() => setHover(find(e.clientY)));
    };
    const leave = (e: MouseEvent) => { if (!pressed.current && !el.contains(e.relatedTarget as Node)) setHover(null); };
    const release = () => { pressed.current = false; };
    window.addEventListener("mouseup", release);
    window.addEventListener("dragend", release);
    el.addEventListener("mousemove", move);
    el.addEventListener("mouseleave", leave);
    return () => { cancelAnimationFrame(frame.current); el.removeEventListener("mousemove", move); el.removeEventListener("mouseleave", leave); window.removeEventListener("mouseup", release); window.removeEventListener("dragend", release); };
  }, [editor, container]);

  if (!hover) return null;
  const lineTop = hover.top + Math.min(hover.height / 2, 14) - 11;

  const select = () => {
    const sel = NodeSelection.create(editor.view.state.doc, hover.pos);
    // closeHistory: a move is always its own undo step, never merged with the typing before it.
    editor.view.dispatch(closeHistory(editor.view.state.tr.setSelection(sel)));
    editor.view.focus();
    return sel;
  };

  return (
    <button
      type="button"
      draggable
      contentEditable={false}
      aria-label="Drag to move block, click to select it"
      title="Drag to move · click to select"
      className="absolute -left-7 z-10 flex h-[22px] w-5 cursor-grab items-center justify-center rounded text-faint hover:bg-hover hover:text-muted active:cursor-grabbing"
      style={{ top: lineTop }}
      onMouseDown={(e) => { e.stopPropagation(); pressed.current = true; }}
      onClick={() => select()}
      onDragStart={(e) => {
        const view = editor.view;
        const sel = select();
        const slice = sel.content();
        const { dom, text } = view.serializeForClipboard(slice);
        e.dataTransfer.clearData();
        e.dataTransfer.setData("text/html", dom.innerHTML);
        e.dataTransfer.setData("text/plain", text);
        e.dataTransfer.effectAllowed = "copyMove";
        e.dataTransfer.setDragImage(hover.dom, 0, 0);
        // `node` lets ProseMirror delete exactly this block on drop, even if the selection changes meanwhile.
        view.dragging = { slice, move: true, node: sel } as unknown as typeof view.dragging;
      }}
      onDragEnd={() => { pressed.current = false; setHover(null); }}
    >
      <GripVertical size={14} />
    </button>
  );
}
