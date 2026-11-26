/** Phone layout helpers: a bottom bar (menu, home, capture, tasks, search) and a quick capture sheet. */
import { useEffect, useState } from "react";
import { Home, ListChecks, Menu, Plus, Search } from "lucide-react";
import { useApp } from "@/store/app";
import { QuickAdd } from "@/views/Tasks";
import { cx } from "@/lib/util";
import { Modal } from "./ui";

const PHONE = "(max-width: 640px)";
export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof matchMedia !== "undefined" && matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return phone;
}

export function MobileBar() {
  const { set, open, tabs, active } = useApp();
  const kind = tabs[active]?.route.kind;
  const [capture, setCapture] = useState(false);
  const item = (label: string, icon: React.ReactNode, onClick: () => void, on = false) => (
    <button className={cx("flex flex-1 flex-col items-center gap-0.5 py-1.5 text-[10.5px]", on ? "text-accent" : "text-muted")} aria-label={label} aria-current={on ? "page" : undefined} onClick={onClick}>{icon}<span>{label}</span></button>
  );
  return (
    <>
      <nav className="flex shrink-0 border-t border-line bg-sunken pb-[env(safe-area-inset-bottom)]" aria-label="Phone navigation">
        {item("Menu", <Menu size={20} />, () => set("sidebarOpen", true))}
        {item("Home", <Home size={20} />, () => open({ kind: "home" }), kind === "home")}
        {item("Capture", <Plus size={22} />, () => setCapture(true))}
        {item("Tasks", <ListChecks size={20} />, () => open({ kind: "tasks" }), kind === "tasks")}
        {item("Search", <Search size={20} />, () => set("paletteOpen", true))}
      </nav>
      {capture && (
        <Modal open onClose={() => setCapture(false)} title="Capture a task" width={420}>
          <QuickAdd placeholder="What needs doing? e.g. “Call Sam tomorrow !high”" />
          <p className="mt-2 text-[12px] text-faint">Press Enter to add. It appears in Tasks and syncs to your other devices.</p>
        </Modal>
      )}
    </>
  );
}
