import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chooseDataFolder, MARKER } from "../electron/dataFolder";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "ms-df-"));

describe("choosing the data folder", () => {
  it("carries over an older folder once, and keeps using it afterwards", () => {
    const appData = tmp(), home = path.join(appData, "Mindstone"), cairn = path.join(appData, "Cairn");
    fs.mkdirSync(path.join(cairn, "IndexedDB"), { recursive: true });
    fs.mkdirSync(path.join(home, "IndexedDB"), { recursive: true }); // Electron pre-creates folders; not a signal
    expect(chooseDataFolder(home, appData)).toBe(cairn);
    expect(fs.readFileSync(path.join(home, MARKER), "utf8")).toContain(`data-folder: ${cairn}`);
    // Even if the older folder briefly looks empty, the recorded choice holds.
    fs.rmSync(path.join(cairn, "IndexedDB"), { recursive: true });
    expect(chooseDataFolder(home, appData)).toBe(cairn);
  });

  it("uses the new folder on a fresh install, and honours older markers", () => {
    const appData = tmp(), home = path.join(appData, "Mindstone");
    expect(chooseDataFolder(home, appData)).toBe(home);
    expect(chooseDataFolder(home, appData)).toBe(home);
    const appData2 = tmp(), home2 = path.join(appData2, "Mindstone");
    fs.mkdirSync(home2, { recursive: true });
    fs.writeFileSync(path.join(home2, MARKER), "This folder holds Mindstone's data.\n"); // 0.3–0.5 marker
    fs.mkdirSync(path.join(appData2, "Cairn", "IndexedDB"), { recursive: true });
    expect(chooseDataFolder(home2, appData2)).toBe(home2);
  });

  it("falls back to the new folder if the recorded one was removed", () => {
    const appData = tmp(), home = path.join(appData, "Mindstone");
    fs.mkdirSync(home, { recursive: true });
    fs.writeFileSync(path.join(home, MARKER), `data-folder: ${path.join(appData, "Gone")}\n`);
    expect(chooseDataFolder(home, appData)).toBe(home);
  });
});
