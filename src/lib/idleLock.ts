/** Locks Mindstone after a period without keyboard or mouse activity, when passphrase protection is on. */
import { lockNow, vaultActive } from "@/data/vault";
import { useSettings } from "@/store/settings";

export function lockAndReload() {
  lockNow();
  location.reload(); // drop every decrypted value held in memory
}

let started = false;
export function startIdleLock() {
  if (started) return;
  started = true;
  let last = Date.now();
  const touch = () => { last = Date.now(); };
  for (const ev of ["pointerdown", "keydown", "wheel", "pointermove"]) addEventListener(ev, touch, { passive: true, capture: true });
  setInterval(() => {
    const min = useSettings.getState().s.security.autoLockMin;
    if (vaultActive() && min > 0 && Date.now() - last > min * 60_000) lockAndReload();
  }, 15_000);
}
