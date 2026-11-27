// Chooses where Mindstone keeps its data. The folder follows the product name, but data from earlier builds
// (Cairn, REA) must carry over. Electron creates the new folder itself at startup, so its existence means nothing.
// The decision is made once and recorded in "<new folder>/.mindstone-data" as "data-folder: <path>", so later
// starts never re-decide (an earlier marker without that line means "this folder").
import fs from "node:fs";
import path from "node:path";

export const MARKER = ".mindstone-data";

export function chooseDataFolder(home: string, appData: string, legacyNames = ["Cairn", "REA"]): string {
  const marker = path.join(home, MARKER);
  if (fs.existsSync(marker)) {
    const recorded = /^data-folder: (.+)$/m.exec(fs.readFileSync(marker, "utf8"))?.[1]?.trim();
    return recorded && fs.existsSync(recorded) ? recorded : home;
  }
  const legacy = legacyNames.map((n) => path.join(appData, n)).find((p) => fs.existsSync(path.join(p, "IndexedDB")));
  const target = legacy ?? home;
  fs.mkdirSync(home, { recursive: true });
  fs.writeFileSync(marker, `This folder belongs to Mindstone.\ndata-folder: ${target}\n`);
  return target;
}
