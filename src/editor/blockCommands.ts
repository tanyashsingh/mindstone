import { Extension } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { TextSelection } from "@tiptap/pm/state";

/** Top-level block containing the selection head: returns [start, end, index]. */
function topBlock(state: EditorState) {
  const $from = state.selection.$from;
  if ($from.depth < 1) {
    // Whole top-level block selected (e.g. via the drag handle): the selection sits between blocks.
    const node = state.doc.nodeAt($from.pos);
    if (!node || !node.isBlock) return null;
    return { start: $from.pos, end: $from.pos + node.nodeSize, index: $from.index(0), node };
  }
  const index = $from.index(0);
  const start = $from.before(1);
  const node = state.doc.child(index);
  return { start, end: start + node.nodeSize, index, node };
}

function move(dir: -1 | 1) {
  return ({ state, dispatch }: { state: EditorState; dispatch?: (tr: Transaction) => void }) => {
    const b = topBlock(state);
    if (!b) return false;
    const targetIndex = b.index + dir;
    if (targetIndex < 0 || targetIndex >= state.doc.childCount) return false;
    if (!dispatch) return true;
    const other = state.doc.child(targetIndex);
    const offset = state.selection.from - b.start;
    const tr = state.tr.delete(b.start, b.end);
    const insertAt = dir === -1 ? b.start - other.nodeSize : b.start + other.nodeSize;
    tr.insert(insertAt, b.node);
    tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(insertAt + offset, tr.doc.content.size))));
    dispatch(tr.scrollIntoView());
    return true;
  };
}

/** Keyboard block operations: move (Alt+Shift+↑/↓), duplicate (Ctrl+D), delete (Ctrl+Shift+K). */
export const BlockCommands = Extension.create({
  name: "blockCommands",
  addKeyboardShortcuts() {
    return {
      "Alt-Shift-ArrowUp": () => move(-1)({ state: this.editor.state, dispatch: this.editor.view.dispatch }),
      "Alt-Shift-ArrowDown": () => move(1)({ state: this.editor.state, dispatch: this.editor.view.dispatch }),
      "Mod-d": () => {
        const b = topBlock(this.editor.state);
        if (!b) return false;
        this.editor.view.dispatch(this.editor.state.tr.insert(b.end, b.node.type.create({ ...b.node.attrs, id: null }, b.node.content, b.node.marks)));
        return true;
      },
      "Mod-Shift-k": () => {
        const b = topBlock(this.editor.state);
        if (!b || this.editor.state.doc.childCount < 2) return false;
        this.editor.view.dispatch(this.editor.state.tr.delete(b.start, b.end));
        return true;
      },
    };
  },
});
