import { db } from "@/data/db";
import { useSettings } from "@/store/settings";
import { useApp } from "@/store/app";

/**
 * Local reminder loop (no network). Fires once per task reminder and event reminder while the app runs.
 * Uses native notifications through the Electron bridge when available, otherwise the Web Notification API,
 * and always shows an in-app toast.
 */
const fired = new Set<string>();

async function notify(title: string, body: string) {
  useApp.getState().toast(`${title}${body ? ` · ${body}` : ""}`, "info");
  if (!useSettings.getState().s.notifications) return;
  if (window.rea) return void window.rea.notify(title, body);
  if (typeof Notification !== "undefined") {
    if (Notification.permission === "default") await Notification.requestPermission();
    if (Notification.permission === "granted") new Notification(title, { body });
  }
}

async function tick() {
  const ws = useApp.getState().workspaceId;
  if (!ws) return;
  const t = Date.now();
  const tasks = await db().tasks.where("[workspaceId+deletedAt]").equals([ws, 0]).filter((x) => !!x.reminderAt && x.reminderAt <= t && x.reminderAt > t - 864e5 && x.status !== "done").toArray();
  for (const task of tasks) {
    const key = `t:${task.id}:${task.reminderAt}`;
    if (fired.has(key)) continue;
    fired.add(key);
    await notify("Task reminder", task.title);
  }
  const events = await db().events.where("start").between(t, t + 864e5).filter((e) => e.workspaceId === ws && !e.deletedAt && e.reminderMin !== null).toArray();
  for (const ev of events) {
    const at = ev.start - (ev.reminderMin ?? 0) * 60e3;
    const key = `e:${ev.id}:${ev.start}`;
    if (at <= t && !fired.has(key)) {
      fired.add(key);
      await notify("Upcoming event", `${ev.title} at ${new Date(ev.start).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}`);
    }
  }
}

let timer: ReturnType<typeof setInterval> | undefined;
export function startReminders() {
  if (timer) return;
  void tick();
  timer = setInterval(() => void tick(), 30_000);
}
