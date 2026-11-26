/**
 * Desktop only: applies the auto-update setting, shows a toast when an update has downloaded, and sends
 * uncaught renderer errors to the local log file (nothing leaves the device).
 */
import { useApp } from "@/store/app";
import { useSettings } from "@/store/settings";

let started = false;

export function startUpdateWatch() {
  const rea = window.rea;
  if (started || !rea) return;
  started = true;

  window.addEventListener("error", (e) => void rea.log("error", `Uncaught: ${e.message} at ${e.filename}:${e.lineno}\n${e.error?.stack ?? ""}`));
  window.addEventListener("unhandledrejection", (e) => {
    const r = e.reason;
    void rea.log("error", `Unhandled rejection: ${r instanceof Error ? `${r.message}\n${r.stack ?? ""}` : String(r)}`);
  });

  let announced = "";
  rea.updates.onState((s) => {
    if (s.status === "ready" && s.version && s.version !== announced) {
      announced = s.version;
      useApp.getState().toast(`Mindstone ${s.version} is ready`, "success", { label: "Restart to update", run: () => void rea.updates.install() });
    }
  });

  let last: boolean | undefined;
  const apply = () => {
    const on = useSettings.getState().s.updates.auto;
    if (on !== last) { last = on; void rea.updates.configure(on); }
  };
  apply();
  useSettings.subscribe(apply);
}
