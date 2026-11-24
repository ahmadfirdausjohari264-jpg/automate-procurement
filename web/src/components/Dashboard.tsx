import { useEffect, useMemo, useRef, useState } from "react";
import { listSuppliers } from "../api";
import type { HistoryItem, Job, SavedSupplier } from "../types";

const PIPELINE_FILE_TYPES = ".pdf,.docx,.xlsx,.xlsm,.png,.jpg,.jpeg,.webp,.bmp";

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
    <svg viewBox="0 0 300 76" className="h-[72px] w-full" role="img" aria-label="Pipeline runs per day over the last seven days">
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
          No recent pipeline activity
        </text>
      )}
    </svg>
  );
}

export default function Dashboard({
  history,
  job,
  running,
  onFiles,
  onNewRun,
  onOpenDirectory,
  onOpenPipeline,
  onError,
}: {
  history: HistoryItem[];
  job: Job | null;
  running: boolean;
  onFiles: (files: File[]) => void;
  onNewRun: () => void;
  onOpenDirectory: (query?: string) => void;
  onOpenPipeline: () => void;
  onError: (message: string) => void;
}) {
  const fileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [directoryLoading, setDirectoryLoading] = useState(true);
  const [contractors, setContractors] = useState<SavedSupplier[]>([]);
  const [directoryQuery, setDirectoryQuery] = useState("");

  useEffect(() => {
    let cancelled = false;
    listSuppliers()
      .then((rows) => {
        if (!cancelled) setContractors(rows);
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
    const accepted = files.filter((file) =>
      PIPELINE_FILE_TYPES.split(",").some((extension) => file.name.toLowerCase().endsWith(extension)),
    );
    if (accepted.length !== files.length) onError("Some selected files are not supported by the ITB pipeline.");
    if (accepted.length) onFiles(accepted);
  };

  return (
    <>
      <section className="mx-auto w-full max-w-[1680px] py-7 sm:py-9">
        <div className="mb-7 flex flex-wrap items-end justify-between gap-5">
          <div>
            <p className="font-mono text-[11px] uppercase tracking-[0.3em] text-rose">Workspace / Overview</p>
            <h1 className="mt-2 font-sans text-3xl font-semibold tracking-tight text-paper-50 sm:text-4xl">Dashboard</h1>
            <p className="mt-2 max-w-2xl font-sans text-sm leading-relaxed text-paper-200/85">
              Start an ITB pipeline, review saved runs, or manage your client and contractor directory.
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={onOpenPipeline}
              className="font-sans text-sm text-paper-200/80 transition hover:text-paper-50"
            >
              Quick Start
            </button>
          </div>
        </div>

        <div className="grid items-stretch gap-4 xl:grid-cols-3">
          <article className="flex min-h-[310px] flex-col rounded-2xl border border-ink-700 bg-[#16181E]/90 p-5 shadow-2xl shadow-black/20 backdrop-blur-xl">
            <div className="mb-4 flex items-center justify-between">
              <span className="rounded-md border border-red/30 bg-red/10 px-2 py-1 font-mono text-[10px] font-semibold tracking-[0.16em] text-red">PIPELINE</span>
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
                  accept={PIPELINE_FILE_TYPES}
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
                <span className="mt-1 font-mono text-[9px] text-paper-200/55">PDF · DOCX · XLSX · IMAGES</span>
              </div>

              <div className="flex flex-col items-center gap-3">
                <svg viewBox="0 0 128 44" className="h-10 w-28" role="img" aria-label="Read, classify, and generate pipeline">
                  <path d="M27 22h20m28 0h20" stroke="#353944" strokeWidth="1.5" />
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
            <div className="mb-4 flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] font-semibold tracking-[0.16em] text-red">CLIENT / CONTRACTOR LIST</span>
              <span className="font-mono text-[10px] text-paper-200/55">{contractors.length} RECORDS</span>
            </div>
            <h2 className="font-sans text-lg font-semibold text-paper-50">Manage your directory</h2>
            <p className="mt-1 font-sans text-xs text-paper-200/70">Search, import and maintain reusable supplier records.</p>

            <div className="mt-4 flex items-center gap-2 rounded-lg border border-ink-700 bg-space-900/70 px-3 py-2">
              <svg className="h-4 w-4 shrink-0 text-paper-200/60" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
                <circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" />
              </svg>
              <input
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
              ) : matches.length ? (
                matches.map((supplier) => (
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
                <p className="mb-1 font-mono text-[10px] text-paper-200/60">Pipeline activity</p>
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
                    <li className="font-mono text-[10px] text-paper-200/55">Pipeline actions will appear here.</li>
                  )}
                </ul>
              </div>
            </div>
          </article>
        </div>

        <footer className="mt-7 border-t border-ink-700/70 pt-4 font-mono text-[10px] text-paper-200/50">
          DYNACONSURV · local pipeline · powered by Gemini, OpenAI &amp; Anthropic
        </footer>
      </section>
    </>
  );
}
