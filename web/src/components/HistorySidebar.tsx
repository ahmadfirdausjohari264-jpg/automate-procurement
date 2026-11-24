import type { ReactNode } from "react";

type WorkspaceTab = "dashboard" | "joblist" | "directory" | "emails" | "settings";

interface Props {
  activeTab: WorkspaceTab;
  open: boolean;
  collapsed: boolean;
  running: boolean;
  onClose: () => void;
  onToggle: () => void;
  onNavigate: (tab: WorkspaceTab) => void;
  onNew: () => void;
  onGenerateEmail: () => void;
}

const navItems: { id: WorkspaceTab; label: string; icon: ReactNode }[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    icon: <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z" />,
  },
  {
    id: "joblist",
    label: "JobList",
    icon: <path d="M4 19V5m0 14h16M8 15l3-4 3 2 5-7" />,
  },
  {
    id: "directory",
    label: "Client / Contractor List",
    icon: <path d="M3 21h18M5 21V7l7-4 7 4v14M9 10h1m4 0h1m-6 4h1m4 0h1m-5 7v-4h2v4" />,
  },
];

/** Navigation sidebar; saved runs remain available from JobList history. */
export default function HistorySidebar({
  activeTab,
  open,
  collapsed,
  running,
  onClose,
  onToggle,
  onNavigate,
  onNew,
  onGenerateEmail,
}: Props) {
  const navigate = (tab: WorkspaceTab) => {
    onNavigate(tab);
    onClose();
  };

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-30 bg-maroon-950/75 backdrop-blur-sm md:hidden"
          onClick={onClose}
        />
      )}
      <aside
        className={[
          "z-40 flex shrink-0 flex-col overflow-hidden border-r border-ink-800/80 bg-ink-950/55 backdrop-blur-xl",
          "fixed inset-y-0 left-0 transition-transform duration-200",
          "md:sticky md:top-0 md:h-screen md:self-start md:translate-x-0 md:transition-all md:duration-300 md:ease-in-out",
          collapsed ? "md:w-16" : "md:w-72",
          "w-72",
          open ? "translate-x-0" : "-translate-x-full",
        ].join(" ")}
      >
        <div
          className={`flex items-center border-b border-ink-800 px-4 py-4 ${
            collapsed ? "md:h-16 md:justify-center md:px-0" : "h-16 justify-between"
          }`}
        >
          <div className={`flex min-w-0 items-center gap-2 ${collapsed ? "md:hidden" : ""}`}>
            <svg
              className="h-5 w-5 shrink-0"
              viewBox="0 0 24 24"
              fill="none"
              strokeWidth="3"
              strokeLinecap="square"
              aria-hidden="true"
            >
              <path d="M3 4 11 12 3 20" stroke="#4A4A4A" />
              <path d="m13 4 8 8-8 8" stroke="#E63946" />
            </svg>
            <span className="whitespace-nowrap font-mono text-sm font-bold tracking-[0.16em] text-paper-50">
              DYNACONSURV
            </span>
          </div>
          <button
            onClick={onToggle}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-ink-700 bg-ink-900 text-paper-200/90 transition hover:border-rose/60 hover:bg-ink-800"
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-expanded={!collapsed}
          >
            <svg
              className={`h-4 w-4 transition-transform duration-200 ${collapsed ? "rotate-180" : ""}`}
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="m15 18-6-6 6-6" />
            </svg>
          </button>
          <button
            onClick={onClose}
            className="font-mono text-xs text-paper-200/85 hover:text-paper-50 md:hidden"
          >
            close
          </button>
        </div>

        <p
          className={`overflow-hidden whitespace-nowrap px-4 pb-2 pt-1 font-mono text-[11px] uppercase tracking-wide text-paper-200/80 transition-[max-height,opacity] duration-200 ${
            collapsed ? "md:max-h-0 md:px-0 md:py-0 md:opacity-0" : "md:max-h-8 md:opacity-100"
          }`}
        >
          workspace
        </p>
        <nav className={`px-2 pb-3 ${collapsed ? "md:px-1" : ""}`}>
          <ul className="space-y-1">
            {navItems.map((item) => {
              const active =
                activeTab === item.id || (item.id === "joblist" && activeTab === "emails");
              if (item.id === "joblist") {
                return (
                  <li key={item.id}>
                    <div
                      className={`relative flex w-full items-center rounded-lg border transition ${
                        active
                          ? "border-maroon-700 bg-maroon-800 text-paper-50"
                          : "border-transparent text-paper-200/90 hover:border-ink-700 hover:bg-ink-900 hover:text-paper-50"
                      } ${collapsed ? "md:justify-center" : "px-1"}`}
                    >
                      {active && <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-r bg-red" />}
                      <button
                        onClick={() => navigate(item.id)}
                        title={collapsed ? item.label : undefined}
                        aria-label={item.label}
                        aria-current={active ? "page" : undefined}
                        className={`flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-2.5 text-left font-mono text-xs ${
                          collapsed ? "md:justify-center md:px-1" : ""
                        }`}
                      >
                        <svg
                          className="h-4 w-4 shrink-0"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.7"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          aria-hidden="true"
                        >
                          {item.icon}
                        </svg>
                        <span
                          className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ${
                            collapsed ? "md:max-w-0 md:opacity-0" : "md:max-w-48 md:opacity-100"
                          }`}
                        >
                          {item.label}
                        </span>
                      </button>
                      <button
                        onClick={() => {
                          onNew();
                          onClose();
                        }}
                        disabled={running}
                        title={collapsed ? "New ITB" : undefined}
                        aria-label="Create new ITB run"
                        className={`inline-flex shrink-0 items-center justify-center rounded-md font-mono font-semibold text-rose transition hover:bg-rose/10 disabled:cursor-not-allowed disabled:opacity-50 ${
                          collapsed
                            ? "gap-1 px-2 py-1 text-[10px] md:absolute md:right-0 md:top-0 md:h-4 md:w-4 md:gap-0 md:rounded-full md:bg-maroon-800 md:p-0 md:text-[10px]"
                            : "mr-1 gap-1 px-2 py-1 text-[10px]"
                        }`}
                      >
                        <span>+</span>
                        <span className={collapsed ? "md:hidden" : ""}>New ITB</span>
                      </button>
                    </div>
                  </li>
                );
              }

              return (
                <li key={item.id}>
                  <button
                    onClick={() => navigate(item.id)}
                    title={collapsed ? item.label : undefined}
                    aria-label={item.label}
                    aria-current={active ? "page" : undefined}
                    className={`relative flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left font-mono text-xs transition ${
                      active
                        ? "border-maroon-700 bg-maroon-800 text-paper-50"
                        : "border-transparent text-paper-200/90 hover:border-ink-700 hover:bg-ink-900 hover:text-paper-50"
                    } ${collapsed ? "md:justify-center md:px-1" : ""}`}
                  >
                    {active && <span className="absolute bottom-2 left-0 top-2 w-0.5 rounded-r bg-red" />}
                    <svg
                      className="h-4 w-4 shrink-0"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      {item.icon}
                    </svg>
                    <span
                      className={`overflow-hidden whitespace-nowrap transition-[max-width,opacity] duration-200 ${
                        collapsed ? "md:max-w-0 md:opacity-0" : "md:max-w-48 md:opacity-100"
                      }`}
                    >
                      {item.label}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className={`mt-auto border-t border-ink-800 p-3 ${collapsed ? "md:px-2" : ""}`}>
          <button
            type="button"
            onClick={() => {
              onGenerateEmail();
              onClose();
            }}
            title={collapsed ? "Generate Email" : undefined}
            aria-label="Generate Email"
            className={`flex w-full items-center gap-3 rounded-lg border border-red/45 bg-red/10 px-3 py-3 text-left text-paper-50 transition hover:border-red hover:bg-red/15 hover:shadow-[0_0_18px_rgba(230,57,70,0.14)] ${
              collapsed ? "md:justify-center md:px-0" : ""
            }`}
          >
            <svg className="h-4 w-4 shrink-0 text-red" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <rect x="3" y="5" width="18" height="14" rx="2" />
              <path d="m3 7 9 6 9-6" />
            </svg>
            <span className={`min-w-0 ${collapsed ? "md:hidden" : ""}`}>
              <span className="block font-sans text-xs font-semibold">Generate Email</span>
              <span className="mt-0.5 block font-mono text-[9px] text-paper-200/60">Email Composer</span>
            </span>
          </button>
        </div>
      </aside>
    </>
  );
}
