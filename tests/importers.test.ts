import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { md5, isTodoistCSV } from "@/data/importers";

describe("importer helpers", () => {
  it("computes MD5 like the reference implementation (Evernote image hashes)", () => {
    const enc = (s: string) => new TextEncoder().encode(s);
    expect(md5(enc(""))).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5(enc("abc"))).toBe("900150983cd24fb0d6963f7d28e17f72");
    for (const n of [55, 56, 63, 64, 65, 1000, 100_000]) {
      const b = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 0xff);
      expect(md5(b)).toBe(createHash("md5").update(b).digest("hex"));
    }
  });

  it("recognises Todoist exports", () => {
    expect(isTodoistCSV("TYPE,CONTENT,DESCRIPTION,PRIORITY\ntask,x,,1")).toBe(true);
    expect(isTodoistCSV("﻿\"TYPE\",\"CONTENT\",\"PRIORITY\"")).toBe(true);
    expect(isTodoistCSV("Name,Status\nA,B")).toBe(false);
  });
});
