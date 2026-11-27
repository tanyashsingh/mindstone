import { useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { Inbox as InboxIcon, Bell } from "lucide-react";
import { db } from "@/data/db";
import type { Task } from "@/data/types";
import { useApp } from "@/store/app";
import { EmptyState } from "@/components/ui";
import { QuickAdd, TaskDetail, TaskRow } from "./Tasks";
import { relTime } from "@/lib/util";
import { usePageList } from "@/data/pageDirectory";

/** Inbox: unsorted captures (tasks with no project and no date), reminders due, and recent activity. */
export default function Inbox() {
  const ws = useApp((s) => s.workspaceId)!;
  const [open, setOpen] = useState<Task | null>(null);
  const go = useApp((s) => s.open);
  const pages = usePageList(ws);
  const pageTitle = new Map((pages ?? []).map((p) => [p.id, p.title]));
  const unsorted = useLiveQuery(() => db().tasks.where("[workspaceId+deletedAt]").equals([ws, 0]).filter((t) => t.status !== "done" && !t.projectId && !t.dueDate && !t.parentTaskId).toArray(), [ws]);
  const reminders = useLiveQuery(() => db().tasks.where("[workspaceId+deletedAt]").equals([ws, 0]).filter((t) => !!t.reminderAt && t.reminderAt <= Date.now() + 864e5 && t.status !== "done").toArray(), [ws]);
  const activity = useLiveQuery(() => db().activity.where("workspaceId").equals(ws).reverse().sortBy("at").then((a) => a.slice(0, 25)), [ws]);
  return (
    <div className="mx-auto max-w-3xl px-10 py-10">
      <div className="mb-5 flex items-center gap-3"><InboxIcon size={22} className="text-muted" /><h1 className="text-[26px] font-bold tracking-tight">Inbox</h1></div>
      <div className="mb-5"><QuickAdd placeholder="Capture anything. Sort it later." /></div>
      {reminders && reminders.length > 0 && <section className="mb-6"><h2 className="label mb-1 flex items-center gap-1"><Bell size={12} /> Reminders</h2>{reminders.map((t) => <TaskRow key={t.id} task={t} onOpen={setOpen} />)}</section>}
      <section className="mb-6">
        <h2 className="label mb-1">Unsorted · {unsorted?.length ?? 0}</h2>
        {unsorted?.length === 0 ? <EmptyState title="Inbox zero" body="Captured tasks without a date or project land here." /> : unsorted?.map((t) => <TaskRow key={t.id} task={t} onOpen={setOpen} />)}
      </section>
      <section>
        <h2 className="label mb-1">Recent activity</h2>
        {activity?.map((a) => {
          // Pages are usually created untitled and named afterwards, so show the name they have now.
          const isPage = a.entity === "page" && pageTitle.has(a.entityId);
          const name = (isPage ? pageTitle.get(a.entityId) : a.detail) || (a.entity === "page" ? "Untitled" : "");
          return (
            <div key={a.id} className="py-0.5 text-ui text-muted">
              {a.entity} {name && (isPage ? <button className="font-medium text-fg hover:underline" onClick={() => go({ kind: "page", id: a.entityId })}>“{name}”</button> : <b className="font-medium text-fg">“{name}”</b>)} {a.action} · {relTime(a.at)}
            </div>
          );
        })}
      </section>
      {open && <TaskDetail task={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
