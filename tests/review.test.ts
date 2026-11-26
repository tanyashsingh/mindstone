import { describe, expect, it } from "vitest";
import { Editor } from "@tiptap/core";
import { schemaExtensions } from "@/editor/schema";
import { resolveSuggestions, suggestionsIn } from "@/editor/review";
import type { JSONContent } from "@/data/types";

const ins = (id: string, text: string) => ({ type: "text", text, marks: [{ type: "insertion", attrs: { id, author: "You", at: 1 } }] });
const del = (id: string, text: string) => ({ type: "text", text, marks: [{ type: "deletion", attrs: { id, author: "You", at: 1 } }] });
const doc = (): JSONContent => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Ship in " }, del("d1", "March"), ins("i1", "April"), { type: "text", text: "." }] }, { type: "paragraph", content: [ins("i2", "New line")] }] });

describe("suggestions", () => {
  it("lists pending suggestions in order", () => {
    expect(suggestionsIn(doc()).map((s) => `${s.kind}:${s.text}`)).toEqual(["deletion:March", "insertion:April", "insertion:New line"]);
  });

  it("accepts and rejects one or all", () => {
    const run = (fn: (e: Editor) => void) => {
      const e = new Editor({ extensions: schemaExtensions(), content: doc() });
      fn(e);
      const out = e.getText({ blockSeparator: "|" });
      e.destroy();
      return out;
    };
    expect(run((e) => resolveSuggestions(e, null, true))).toBe("Ship in April.|New line");
    expect(run((e) => resolveSuggestions(e, null, false))).toBe("Ship in March.|");
    expect(run((e) => { resolveSuggestions(e, "d1", true); resolveSuggestions(e, "i1", false); })).toBe("Ship in .|New line");
    const e = new Editor({ extensions: schemaExtensions(), content: doc() });
    resolveSuggestions(e, "i2", true);
    expect(suggestionsIn(e.getJSON() as JSONContent).map((s) => s.id)).toEqual(["d1", "i1"]);
    e.destroy();
  });
});
