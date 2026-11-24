import { useEffect, useMemo, useRef, useState } from "react";
import { listSuppliers } from "../api";
import { isSupportedItbFile, ITB_FILE_ACCEPT } from "../itbFiles";
import type { HistoryItem, Job, SavedSupplier } from "../types";

function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const minutes = Math.max(0, Math.floor((Date.now() - date.getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return days < 7 ? `${days}d ago` : date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function ActivityChart({ history }: { history: HistoryItem[] }) {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - (6 - index));
    return date;
  });
  const counts = days.map((day) => {
    const key = day.toISOString().slice(0, 10);
    return history.filter((item) => item.created_at.slice(0, 10) === key).length;
  });
  const peak = Math.max(...counts, 1);
  const points = counts.map((count, index) => `${8 + (index * 284) / 6},${52 - (count / peak) * 42}`);
  const hasActivity = counts.some((count) => count > 0);
  const line = hasActivity ? `M ${points.join(" L ")}` : "";
  const area = hasActivity ? `${line} L 292,58 L 8,58 Z` : "";

  return (
    <svg viewBox="0 0 300 76" className="h-[72px] w-full" role="img" aria-label="JobList runs per day over the last seven days">
      <defs>
        <linearGradient id="activity-fill" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#E63946" stopOpacity=".24" />
          <stop offset="100%" stopColor="#E63946" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d="M 8,58 H 292" stroke="#262933" strokeWidth="1" />
      {line && <path d={area} fill="url(#activity-fill)" />}
      {line && <path d={line} fill="none" stroke="#E63946" strokeWidth="2" vectorEffect="non-scaling-stroke" />}
      {hasActivity ? points.map((point, index) => {
        const [cx, cy] = point.split(",");
        return (
          <g key={days[index].toISOString()}>
            <circle cx={cx} cy={cy} r="2.2" fill="#E63946" stroke="#0D0E12" strokeWidth="1.5" />
            <text x={cx} y="72" textAnchor="middle" fill="#AAB0BF" fontSize="6" fontFamily="monospace">
              {days[index].toLocaleDateString(undefined, { weekday: "narrow", timeZone: "UTC" })}
            </text>
          </g>
        );
      }) : (
        <text x="150" y="34" textAnchor="middle" fill="#AAB0BF" fontSize="8" fontFamily="monospace">
          No recent JobList activity
        </text>
      )}
    </svg>
  );
}

function formatDuration(milliseconds: number): string {
  const minutes = Math.floor(milliseconds / 60_000);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

interface AttendanceState {
  date: string;
  clockInAt: number | null;
  elapsedMs: number;
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatClockTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });
}

function readAttendance(storageKey: string): AttendanceState {
  const today = localDateKey(new Date());
  try {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      const state = JSON.parse(stored) as AttendanceState;
      if (
        state.date === today &&
        (state.clockInAt === null || Number.isFinite(state.clockInAt)) &&
        Number.isFinite(state.elapsedMs) &&
        state.elapsedMs >= 0
      ) {
        return state;
      }
    }
  } catch {
    // Ignore stale or malformed local attendance state and start a fresh day.
  }
  return { date: today, clockInAt: null, elapsedMs: 0 };
}

function AttendanceBanner({ storageKey }: { storageKey: string }) {
  const [attendance, setAttendance] = useState(() => readAttendance(storageKey));
  const [now, setNow] = useState(() => Date.now());
  const clockInAt = attendance.clockInAt;
  const active = clockInAt !== null;
  const totalMs = attendance.elapsedMs + (active ? Math.max(0, now - clockInAt) : 0);
  const time = new Date(now).toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(attendance));
  }, [attendance, storageKey]);

  const clockIn = () => {
    const startedAt = Date.now();
    setNow(startedAt);
    setAttendance((current) => ({
      date: localDateKey(new Date(startedAt)),
      clockInAt: startedAt,
      elapsedMs: current.date === localDateKey(new Date(startedAt)) ? current.elapsedMs : 0,
    }));
  };
  const clockOut = () => {
    if (clockInAt === null) return;
    const endedAt = Date.now();
    setNow(endedAt);
    setAttendance((current) => ({
      ...current,
      clockInAt: null,
      elapsedMs: current.elapsedMs + Math.max(0, endedAt - clockInAt),
    }));
  };

  return (
    <section
      aria-label="Time tracking and attendance"
      className="relative mb-5 overflow-hidden rounded-2xl border border-ink-700 bg-[#16181E]/90 p-4 shadow-2xl shadow-black/20 backdrop-blur-xl sm:p-5"
    >
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-red/70 to-transparent" />
      <div className="grid gap-5 lg:grid-cols-[minmax(230px,1fr)_minmax(0,1.4fr)_auto] lg:items-center">
        <div className="border-b border-ink-700 pb-4 lg:border-b-0 lg:border-r lg:pb-0 lg:pr-6">
          <p className="mb-2 inline-flex rounded-md border border-red/30 bg-red/10 px-2 py-1 font-mono text-[10px] uppercase tracking-[0.12em] text-red">
            Time Tracking &amp; Attendance
          </p>
          <p className="font-mono text-3xl tracking-[0.08em] text-paper-50 sm:text-[2rem]" aria-label={`Current time ${time}`}>
            {time}
          </p>
          <p className={`mt-1 font-mono text-[10px] tracking-wide ${active ? "text-teal" : "text-paper-200/50"}`}>
            {active ? `CLOCKED IN AT: ${formatClockTime(clockInAt)}` : "NOT CLOCKED IN"}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="border-b border-ink-700 pb-3 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-4">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-200/60">Total Hours Today</p>
            <p className="mt-2 font-mono text-xl text-paper-50">{formatDuration(totalMs)}</p>
          </div>
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-paper-200/60">Shift Status</p>
            <p className={`mt-2 inline-flex items-center gap-2 font-mono text-sm ${active ? "text-teal" : "text-paper-200/60"}`}>
              <span className={`h-2 w-2 rounded-full ${active ? "animate-pulse-dot bg-teal shadow-[0_0_10px_rgba(16,185,129,0.65)]" : "bg-paper-200/35"}`} />
              {active ? "ACTIVE (In Progress)" : "NOT CLOCKED IN"}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap gap-2 lg:justify-end">
          <button
            onClick={clockIn}
            disabled={active}
            className="inline-flex items-center gap-2 rounded-lg bg-teal px-4 py-2.5 font-sans text-sm font-semibold text-space-950 shadow-lg shadow-teal/20 transition hover:bg-teal/90 disabled:cursor-not-allowed"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="m8 12 2.5 2.5L16 9" />
            </svg>
            Clock In
          </button>
          <button
            onClick={clockOut}
            disabled={!active}
            className="inline-flex items-center gap-2 rounded-lg border border-red/40 bg-red/5 px-4 py-2.5 font-sans text-sm font-medium text-red/75 transition hover:bg-red/10 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
              <circle cx="12" cy="12" r="9" />
              <path d="M8 12h8" />
            </svg>
            Clock Out
          </button>
        </div>
      </div>
    </section>
  );
}

export default function Dashboard({
  history,
  job,
  running,
  attendanceKey,
  onFiles,
  onNewRun,
  onOpenDirectory,
  onError,
}: {
  history: HistoryItem[];
  job: Job | null;
  running: boolean;
  attendanceKey: string;
  onFiles: (files: File[]) => void;
  onNewRun: () => void;
  onOpenDirectory: (query?: string) => void;
  onError: (message: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const directorySearchRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [contractors, setContractors] = useState<SavedSupplier[]>([]);
  const [directoryQuery, setDirectoryQuery] = useState("");

  useEffect(() => {
    setDirectoryQuery("");
    if (directorySearchRef.current) directorySearchRef.current.value = "";
  }, []);

  useEffect(() => {
    let cancelled = false;
    listSuppliers()
      .then((rows) => {
        if (!cancelled) {
          setContractors(rows);
        }
      })
      .catch((error) => {
        if (!cancelled) onError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setDirectoryLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [onError]);

  const matches = useMemo(() => {
    const query = directoryQuery.trim().toLowerCase();
    return contractors
      .filter((supplier) =>
        !query ||
        [supplier.company_name, supplier.business_scope, supplier.email, supplier.contact]
          .join(" ")
          .toLowerCase()
          .includes(query),
      )
      .slice(0, 3);
  }, [contractors, directoryQuery]);
  const previewRows: Array<Pick<SavedSupplier, "id" | "company_name" | "email" | "business_scope" | "contact">> = matches;
  const displayedRecordCount = contractors.length;

  const activeRuns = history.filter((item) => item.status === "running" || item.status === "queued").length;
  const completedRuns = history.filter((item) => item.status === "done").length;
  const successRate = history.length ? Math.round((completedRuns / history.length) * 100) : 0;
  const latestRun = history[0];
  const progress = latestRun?.status === "done"
    ? 100
    : latestRun?.status === "running" && job?.id === latestRun.id && job.total > 0
      ? Math.round((job.current / job.total) * 100)
      : 0;

  const acceptFiles = (files: File[]) => {
    const accepted = files.filter((file) => isSupportedItbFile(file.name));
    if (accepted.length !== files.length) onError("Some selected files are not supported by JobList.");
    if (accepted.length) onFiles(accepted);
  };

  return (
    <>
      <section className="mx-auto w-full max-w-[1680px] py-7 sm:py-9">
        <div className="mb-5">
          <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-rose">Workspace / Overview</p>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <h1 className="font-sans text-3xl font-semibold tracking-tight text-paper-50 sm:text-4xl">Dashboard</h1>
            <button
              onClick={onNewRun}
              disabled={running}
              className="rounded-md bg-white px-3 py-1.5 font-sans text-xs font-bold text-red shadow-sm transition hover:bg-paper-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              + New Project
            </button>
          </div>
          <p className="mt-2 max-w-2xl font-sans text-sm leading-relaxed text-paper-200/85">
            Start a new ITB job, review saved runs, or manage your client and contractor directory.
          </p>
        </div>

        <AttendanceBanner storageKey={`dynaconsurv-attendance-${attendanceKey}`} />

        <div className="grid items-stretch gap-4 xl:grid-cols-3">
          <article className="flex min-h-[310px] flex-col rounded-2xl border border-ink-700 bg-[#16181E]/90 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <span className="rounded-md border border-red/30 bg-red/10 px-2 py-1 font-mono text-[10px] font-semibold tracking-[0.16em] text-red">JOBLIST</span>
              <span className="font-mono text-[10px] text-paper-200/55">01 / ITB PROCESSING</span>
            </div>
            <h2 className="font-sans text-lg font-semibold text-paper-50">Start a new ITB run</h2>
            <p className="mt-1 font-sans text-xs leading-relaxed text-paper-200/70">
              Upload bid files and generate a specification sheet.
            </p>

            <div className="mt-auto grid items-center gap-4 pt-5 sm:grid-cols-[1fr_auto]">
              <div
                onDragOver={(event) => {
                  event.preventDefault();
                  setDragging(true);
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  acceptFiles(Array.from(event.dataTransfer.files));
                }}
                onClick={() => fileInput.current?.click()}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") fileInput.current?.click();
                }}
                role="button"
                tabIndex={0}
                aria-label="Upload ITB files"
                className={`flex min-h-[108px] cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed px-3 py-4 text-center transition ${
                  dragging
                    ? "border-red bg-red/10"
                    : "border-ink-700 bg-space-900/70 hover:border-red/50 hover:bg-red/5"
                }`}
              >
                <input
                  ref={fileInput}
                  type="file"
                  multiple
                  accept={ITB_FILE_ACCEPT}
                  className="hidden"
                  onChange={(event) => {
                    acceptFiles(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                />
                <svg className="mb-2 h-5 w-5 text-red" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 16V4m0 0L8 8m4-4 4 4M4 15v4a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-4" />
                </svg>
                <span className="font-mono text-[11px] text-paper-50">Drop files or click to upload</span>
                <span className="mt-1 font-mono text-[9px] text-paper-200/55">DOCS · SHEETS · SLIDES · MEDIA</span>
              </div>

              <div className="flex flex-col items-center gap-3">
                <svg viewBox="0 0 128 44" className="h-10 w-28" role="img" aria-label="Read, classify, and generate with JobList">
                  <path d="M27 22h20m28 0h20" stroke="#262933" strokeWidth="1.5" />
                  <path d="m43 18 5 4-5 4m44-8 5 4-5 4" stroke="#E63946" strokeWidth="1.5" fill="none" />
                  {["READ", "AI", "SPEC"].map((label, index) => (
                    <g key={label} transform={`translate(${index * 48},0)`}>
                      <rect x="0" y="7" width="30" height="30" rx="8" fill="#16181E" stroke={index === 1 ? "#E63946" : "#262933"} />
                      <circle cx="15" cy="17" r="3" fill={index === 1 ? "#E63946" : "#10B981"} />
                      <text x="15" y="31" textAnchor="middle" fill="#AAB0BF" fontSize="6" fontFamily="monospace">{label}</text>
                    </g>
                  ))}
                </svg>
                <button
                  onClick={onNewRun}
                  disabled={running}
                  className="rounded-lg bg-maroon px-4 py-2 font-sans text-xs font-semibold text-paper-50 transition hover:bg-maroon-light disabled:cursor-not-allowed disabled:opacity-50"
                >
                  New Run
                </button>
              </div>
            </div>
          </article>

          <article className="flex min-h-[310px] flex-col rounded-2xl border border-ink-700 bg-[#16181E]/90 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl">
            <input
              type="text"
              name="dashboard_autofill_trap"
              autoComplete="username"
              aria-hidden="true"
              tabIndex={-1}
              style={{ display: "none" }}
            />
            <div className="mb-4 flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] font-semibold tracking-[0.16em] text-red">CLIENT / CONTRACTOR LIST</span>
              <span className="font-mono text-[10px] text-paper-200/55">{directoryLoading ? "…" : displayedRecordCount} RECORDS</span>
            </div>
            <h2 className="font-sans text-lg font-semibold text-paper-50">Manage your directory</h2>
            <p className="mt-1 font-sans text-xs text-paper-200/70">Search, import and maintain reusable supplier records.</p>

            <div className="mt-4 flex items-center gap-2 rounded-lg border border-ink-700 bg-space-900/70 px-3 py-2">
              <svg className="h-4 w-4 shrink-0 text-paper-200/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
              </svg>
              <input
                ref={directorySearchRef}
                id="directory_search_input"
                name="directory_search_no_autofill"
                autoComplete="new-password"
                value={directoryQuery}
                onChange={(event) => setDirectoryQuery(event.target.value)}
                aria-label="Search contractors in directory preview"
                onKeyDown={(event) => {
                  if (event.key === "Enter") onOpenDirectory(directoryQuery);
                }}
                placeholder="Q Search contractors..."
                className="min-w-0 flex-1 bg-transparent font-mono text-[11px] text-paper-50 outline-none placeholder:text-paper-200/45"
              />
              <button onClick={() => onOpenDirectory(directoryQuery)} className="font-mono text-[10px] text-red hover:text-rose">OPEN</button>
            </div>

            <div className="mt-3 flex-1 divide-y divide-ink-700/70 overflow-hidden rounded-lg border border-ink-700/70">
              {directoryLoading ? (
                Array.from({ length: 3 }, (_, index) => (
                  <div key={index} className="flex animate-pulse items-center gap-3 px-3 py-3">
                    <span className="h-8 w-8 rounded-full bg-ink-800" />
                    <span className="flex-1 space-y-2">
                      <span className="block h-2 w-2/5 rounded bg-ink-800" />
                      <span className="block h-2 w-3/5 rounded bg-ink-800" />
                    </span>
                    <span className="text-paper-200/50">···</span>
                  </div>
                ))
              ) : previewRows.length ? (
                previewRows.map((supplier) => (
                  <button
                    key={supplier.id}
                    onClick={() => onOpenDirectory(directoryQuery)}
                    className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition hover:bg-ink-800/70"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-ink-700 bg-space-900 font-mono text-[10px] text-red">
                      {(supplier.company_name || "C").slice(0, 1).toUpperCase()}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-sans text-xs font-medium text-paper-50">{supplier.company_name || "Contractor"}</span>
                      <span className="block truncate font-mono text-[10px] text-paper-200/60">
                        {supplier.email || supplier.business_scope || supplier.contact || "No contact details"}
                      </span>
                    </span>
                    <span className="font-mono text-paper-200/45" aria-hidden="true">···</span>
                  </button>
                ))
              ) : (
                <div className="flex h-full min-h-[100px] items-center justify-center px-4 text-center font-mono text-[10px] text-paper-200/60">
                  {directoryQuery ? "No matching contractors found." : "No directory entries yet. Add your first contractor."}
                </div>
              )}
            </div>
          </article>

          <article className="flex min-h-[310px] flex-col rounded-2xl border border-ink-700 bg-[#16181E]/90 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] font-semibold tracking-[0.16em] text-paper-200/70">SAVED RUNS</span>
              <span className="font-mono text-paper-200/40" aria-hidden="true">···</span>
            </div>
            <h2 className="mt-2 font-sans text-lg font-semibold text-paper-50">Activity &amp; Overview</h2>

            <div className="mt-4 grid flex-1 grid-cols-2 gap-4">
              <div className="border-r border-ink-700 pr-4">
                <div className="flex items-baseline gap-2">
                  <span className="font-sans text-3xl font-semibold text-paper-50">{activeRuns}</span>
                  <span className="font-mono text-[11px] text-paper-200/70">Active</span>
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-paper-200/75" title={latestRun?.title}>
                  {latestRun?.title ?? "No saved runs"}
                </p>
                <div className="mt-4 flex items-center justify-between font-mono text-[10px]">
                  <span className="text-paper-200/60">Latest run</span>
                  <span className={latestRun?.status === "done" ? "text-teal" : "text-paper-200/65"}>
                    {latestRun?.status === "done" ? "Success" : latestRun?.status ?? "Idle"}
                  </span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink-800">
                  <div
                    className={`h-full rounded-full transition-all ${latestRun?.status === "done" ? "bg-teal" : "bg-red"}`}
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <div className="mt-2 flex justify-between font-mono text-[9px] text-paper-200/55">
                  <span>{successRate}% success</span>
                  <span>{latestRun ? relativeTime(latestRun.created_at) : "—"}</span>
                </div>
              </div>

              <div className="min-w-0">
                <p className="mb-1 font-mono text-[10px] text-paper-200/60">JobList activity</p>
                <ActivityChart history={history} />
                <p className="mt-2 font-sans text-xs font-medium text-paper-50">Recent Activity</p>
                <ul className="mt-2 space-y-2">
                  {history.slice(0, 2).map((item) => (
                    <li key={item.id} className="flex min-w-0 items-start gap-2">
                      <span className={`mt-1 h-1.5 w-1.5 shrink-0 rounded-full ${item.status === "done" ? "bg-teal" : item.status === "error" ? "bg-danger" : "bg-red"}`} />
                      <span className="min-w-0 flex-1 truncate font-mono text-[9px] text-paper-200/70">{item.title}</span>
                      <span className="shrink-0 font-mono text-[9px] text-paper-200/45">{relativeTime(item.created_at)}</span>
                    </li>
                  ))}
                  {history.length === 0 && (
                    <li className="font-mono text-[10px] text-paper-200/55">JobList activity will appear here.</li>
                  )}
                </ul>
              </div>
            </div>
          </article>
        </div>

        <footer className="mt-7 border-t border-ink-700/70 pt-4 font-mono text-[10px] text-paper-200/50">
          DYNA CONSURV · local pipeline · powered by Gemini, OpenAI &amp; Anthropic
        </footer>
      </section>
    </>
  );
}
