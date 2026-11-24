import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AuthError,
  createJob,
  deleteHistory,
  getCurrentUser,
  getJob,
  getQuotaStatus,
  listHistory,
  logout as apiLogout,
  renameHistory,
} from "./api";
import AddFiles from "./components/AddFiles";
import AdminHistory from "./components/AdminHistory";
import AiSettings from "./components/AiSettings";
import ClientContractorWorkspace from "./components/ClientContractorWorkspace";
import Dashboard from "./components/Dashboard";
import DropZone from "./components/DropZone";
import EmailDraftPage from "./components/EmailDraftPage";
import HistoryDrawer from "./components/HistoryDrawer";
import HistorySidebar from "./components/HistorySidebar";
import JobPanel from "./components/JobPanel";
import Login from "./components/Login";
import Results from "./components/Results";
import RfqEmails from "./components/RfqEmails";
import SettingsPanel, { parseSkipList } from "./components/SettingsPanel";
import UsersAdmin from "./components/UsersAdmin";
import VersionsAudit from "./components/VersionsAudit";
import useOnClickOutside from "./hooks/useOnClickOutside";
import { getFileTypeBadge } from "./itbFiles";
import type { AuthUser, HistoryItem, Job, QuotaStatus } from "./types";

/** Format a byte count as a short human-readable string (B / KB / MB). */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

type TabId = "dashboard" | "joblist" | "directory" | "emails" | "settings";

/** Human labels for AI providers, used by the API-key setup wall. */
const PROVIDER_LABELS: Record<string, string> = {
  gemini: "Google Gemini",
  openai: "OpenAI",
  anthropic: "Anthropic",
};

/**
 * Root component: holds the selected files, starts a processing job and polls
 * it until it finishes, then renders the results. Past runs are available in
 * the JobList history drawer.
 */
export default function App() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [job, setJob] = useState<Job | null>(null);
  const [pollId, setPollId] = useState<string | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(
    () => localStorage.getItem("procurement-sidebar-collapsed") === "true",
  );
  const [error, setError] = useState<string | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [includeImages, setIncludeImages] = useState(true);
  const [skipFiles, setSkipFiles] = useState("");
  const [quota, setQuota] = useState<QuotaStatus | null>(null);
  const [tab, setTab] = useState<TabId>("dashboard");
  const [showEmailDraft, setShowEmailDraft] = useState(false);
  const [globalSearch, setGlobalSearch] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [directorySearchSeed, setDirectorySearchSeed] = useState("");
  const globalSearchRef = useRef<HTMLInputElement>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);

  // Total size of the selected files, shown in the file summary bar.
  const totalSize = useMemo(() => files.reduce((sum, f) => sum + f.size, 0), [files]);
  const running = busy || pollId != null;
  const closeProfileMenu = useCallback(() => setProfileOpen(false), []);
  useOnClickOutside(profileMenuRef, closeProfileMenu);

  useEffect(() => {
    localStorage.setItem("procurement-sidebar-collapsed", String(sidebarCollapsed));
  }, [sidebarCollapsed]);

  useEffect(() => {
    const message = error?.startsWith("Failed to read Word document")
      ? error
      : job?.status === "error" && job.message.startsWith("Failed to read Word document")
        ? job.message
        : null;
    if (!message) {
      setToastMessage(null);
      return;
    }
    setToastMessage(message);
    const timer = window.setTimeout(() => setToastMessage(null), 8000);
    return () => window.clearTimeout(timer);
  }, [error, job?.id, job?.message, job?.status]);

  useEffect(() => {
    const handleShortcut = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        globalSearchRef.current?.focus();
        setSearchOpen(true);
      }
      if (event.key === "Escape") {
        setSearchOpen(false);
        setProfileOpen(false);
        setHistoryOpen(false);
      }
    };
    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, []);

  // Every account must save its own AI key before using the system. Supplier
  // search pinned to Gemini additionally needs a personal Gemini key.
  const activeProvider = user?.ai_provider ?? "gemini";
  const missingProviders = useMemo(() => {
    if (!user) return [];
    const required = new Set<string>([activeProvider]);
    if (user.supplier_search_provider === false) required.add("gemini");
    return [...required].filter(
      (p) => !(user.keys?.[p]?.has_api_key ?? (p === "gemini" ? Boolean(user.has_api_key) : false)),
    );
  }, [user, activeProvider]);
  const needsSetup = !!user && missingProviders.length > 0;
  // Reading saved suppliers needs no AI key; only AI work (jobs/search) does.
  const canBrowseWithoutKey = tab === "dashboard" || tab === "directory";
  const reportError = useCallback((message: string) => setError(message), []);
  const matchingHistory = useMemo(() => {
    const query = globalSearch.trim().toLowerCase();
    return query
      ? history.filter((item) => `${item.title} ${item.subtitle}`.toLowerCase().includes(query)).slice(0, 4)
      : [];
  }, [history, globalSearch]);

  /** Reload the saved-run history from the backend. */
  const loadHistory = useCallback(async () => {
    try {
      setHistory(await listHistory());
    } catch (e) {
      if (e instanceof AuthError) return;
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // Resolve the current session on mount; show login until it succeeds.
  // `getCurrentUser` never rejects and gives up after a short timeout, so this
  // can never leave the UI stuck on "checking session…".
  useEffect(() => {
    let cancelled = false;
    getCurrentUser()
      .then((u) => {
        if (cancelled) return;
        setUser(u);
        setAuthChecked(true);
      })
      .catch(() => {
        if (!cancelled) setAuthChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load history once signed in.
  useEffect(() => {
    if (!user) return;
    loadHistory();
  }, [user, loadHistory]);

  // Refresh the Google-Search grounding quota badge every 30s (cheap, no API cost).
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const refresh = async () => {
      try {
        const q = await getQuotaStatus();
        if (!cancelled) setQuota(q);
      } catch {
        /* backend not up yet; try again next tick */
      }
    };
    refresh();
    const timer = window.setInterval(refresh, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [user]);

  // Poll the in-flight job every 1.5s until it is done or has errored. This is
  // keyed on the job id (not the displayed job) so navigating to history
  // mid-run keeps the run tracked and refreshes the sidebar on completion.
  useEffect(() => {
    if (!pollId) return;
    let timer: number;
    let cancelled = false;

    const tick = async () => {
      try {
        const updated = await getJob(pollId);
        if (cancelled) return;
        setJob((prev) => (prev && prev.id === pollId ? updated : prev));
        if (updated.status === "done" || updated.status === "error") {
          setPollId(null);
          loadHistory();
          return;
        }
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      }
      timer = window.setTimeout(tick, 1500);
    };

    timer = window.setTimeout(tick, 1500);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [pollId, loadHistory]);

  /** Merge newly dropped files into the list, skipping duplicate names. */
  const onFiles = (incoming: File[]) => {
    const merged = [...files];
    const seen = new Set(files.map((f) => f.name));
    for (const f of incoming) {
      if (!seen.has(f.name)) {
        merged.push(f);
        seen.add(f.name);
      }
    }
    setFiles(merged);
    setJob(null);
    setShowEmailDraft(false);
    setError(null);
  };

  /** Upload the selected files and start a processing job. */
  const process = async () => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    setJob(null);
    setShowEmailDraft(false);
    try {
      const j = await createJob(files, { includeImages, skipFiles: parseSkipList(skipFiles) });
      setJob(j);
      setPollId(j.id);
      setSidebarOpen(false);
    } catch (e) {
      reportError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  /** Open a saved run from the sidebar and show its results. */
  const openHistory = async (id: string) => {
    setError(null);
    setShowEmailDraft(false);
    setSidebarOpen(false);
    try {
      setJob(await getJob(id));
      setTab("joblist");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Delete a saved run from history. */
  const removeHistory = async (id: string) => {
    try {
      await deleteHistory(id);
      if (job?.id === id) setJob(null);
      await loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Rename a saved run in history. */
  const renameRun = async (id: string, title: string) => {
    try {
      await renameHistory(id, title);
      await loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** Set up polling for an incremental reprocess after files were added. */
  const onFilesAdded = (updated: Job) => {
    setJob(updated);
    setShowEmailDraft(false);
    setPollId(updated.id);
  };

  /** Start a fresh run: clear the current selection and results. */
  const startNew = () => {
    setFiles([]);
    setJob(null);
    setShowEmailDraft(false);
    setError(null);
    setSkipFiles("");
    setSidebarOpen(false);
    setTab("joblist");
  };

  /** Sign out: clear the session cookie and reset app state. */
  const signOut = async () => {
    try {
      await apiLogout();
    } catch {
      /* ignore — cookie may already be gone */
    }
    setUser(null);
    setHistory([]);
    setJob(null);
    setShowEmailDraft(false);
    setFiles([]);
    setTab("dashboard");
  };

  const done = job?.status === "done";
  const openEmailFromDirectory = () => {
    setError(null);
    setSidebarOpen(false);
    if (!job || !done) {
      setTab("joblist");
      setError("Complete or open a JobList run before generating an email.");
      return;
    }
    setShowEmailDraft(true);
    setTab("joblist");
  };

  // Gate the whole app behind the login screen until a session is confirmed.
  if (!authChecked) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-grid">
        <p className="font-mono text-xs text-paper-200/85">checking session…</p>
      </div>
    );
  }
  if (!user) {
    return <Login onSuccess={setUser} />;
  }

  return (
    <div className="flex min-h-screen bg-grid">
      <HistorySidebar
        activeTab={tab}
        open={sidebarOpen}
        collapsed={sidebarCollapsed}
        running={running}
        onClose={() => setSidebarOpen(false)}
        onToggle={() => setSidebarCollapsed((collapsed) => !collapsed)}
        onNavigate={setTab}
        onNew={startNew}
        onGenerateEmail={openEmailFromDirectory}
      />

      <div className="min-w-0 flex-1">
        <header className="sticky top-0 z-30 border-b border-ink-700/80 bg-space-950/85 backdrop-blur-xl">
          <div className="flex min-h-[68px] items-center justify-between gap-4 px-4 sm:px-6">
            <div className="flex min-w-0 items-center gap-4">
              <button
                onClick={() => setSidebarOpen(true)}
                className="flex h-7 w-7 items-center justify-center rounded border border-ink-700 text-paper-200/90 transition hover:border-rose/50 hover:text-rose md:hidden"
                title="Open navigation"
                aria-label="Open navigation"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M3 6h18M3 12h18M3 18h18" />
                </svg>
              </button>
              <span className="whitespace-nowrap font-sans text-sm font-bold tracking-[0.14em] text-red">
                DYNA CONSURV
              </span>
              <div className="relative hidden w-[min(34vw,360px)] lg:block">
                <svg className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-paper-200/55" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-4-4" />
                </svg>
                <input
                  ref={globalSearchRef}
                  id="global_search_input"
                  name="global_search_no_autofill"
                  autoComplete="new-password"
                  value={globalSearch}
                  onFocus={() => setSearchOpen(true)}
                  onChange={(event) => {
                    setGlobalSearch(event.target.value);
                    setSearchOpen(true);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (matchingHistory[0]) {
                        void openHistory(matchingHistory[0].id);
                      } else {
                        setDirectorySearchSeed(globalSearch);
                        setTab("directory");
                      }
                      setSearchOpen(false);
                    }
                  }}
                  placeholder="Search anything..."
                  aria-label="Global search (Ctrl + K)"
                  className="h-9 w-full rounded-lg border border-ink-700 bg-ink-950/80 py-2 pl-9 pr-16 font-sans text-xs text-paper-50 outline-none transition focus:border-red/70 focus:ring-2 focus:ring-red/10"
                />
                <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-ink-700 px-1.5 py-0.5 font-mono text-[9px] text-paper-200/50">
                  Ctrl + K
                </kbd>
                {searchOpen && globalSearch.trim() && (
                  <div className="absolute left-0 right-0 top-full z-50 mt-2 overflow-hidden rounded-xl border border-ink-700 bg-ink-900 p-1.5 shadow-2xl shadow-black/50">
                    {matchingHistory.map((item) => (
                      <button
                        key={item.id}
                        onMouseDown={(event) => event.preventDefault()}
                        onClick={() => {
                          setSearchOpen(false);
                          setGlobalSearch("");
                          void openHistory(item.id);
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition hover:bg-ink-800"
                      >
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-teal" />
                        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-paper-50">{item.title}</span>
                        <span className="font-mono text-[9px] text-paper-200/50">saved run</span>
                      </button>
                    ))}
                    <button
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        setDirectorySearchSeed(globalSearch);
                        setTab("directory");
                        setSearchOpen(false);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left font-mono text-[11px] text-paper-200/80 transition hover:bg-ink-800 hover:text-paper-50"
                    >
                      <span className="text-red">↳</span>
                      Search the Client / Contractor List
                    </button>
                    {matchingHistory.length === 0 && (
                      <p className="px-3 py-2 font-mono text-[10px] text-paper-200/50">No saved runs match. Search the directory instead.</p>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              {tab === "joblist" && !needsSetup && (
                <button
                  type="button"
                  onClick={() => {
                    setHistoryOpen(true);
                    void loadHistory();
                  }}
                  className="inline-flex h-9 items-center gap-2 rounded-lg border border-ink-700 bg-ink-900/70 px-3 font-mono text-[10px] text-paper-200/80 transition hover:border-red/60 hover:text-paper-50"
                >
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="12" cy="12" r="9" />
                    <path d="M12 7v5l3 2" />
                  </svg>
                  HISTORY
                </button>
              )}
              <div ref={profileMenuRef} className="relative">
                <button
                  onClick={() => setProfileOpen((open) => !open)}
                  aria-expanded={profileOpen}
                  aria-haspopup="menu"
                  aria-label={`Open profile menu for ${user.username}`}
                  className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition hover:bg-ink-800"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-md border border-ink-700 bg-ink-900 text-paper-200/80">
                    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                      <circle cx="12" cy="8" r="3" /><path d="M5 20a7 7 0 0 1 14 0" />
                    </svg>
                  </span>
                  <span className="hidden max-w-[120px] truncate font-mono text-[10px] text-paper-200/85 md:inline">
                    {user.username} · {user.role}
                  </span>
                  <svg className="h-3 w-3 text-paper-200/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                    <path d="m7 10 5 5 5-5" />
                  </svg>
                </button>
                <div
                  role="menu"
                  aria-label="Profile menu"
                  aria-hidden={!profileOpen}
                  className={`absolute right-0 top-full z-50 mt-2 w-64 origin-top-right rounded-xl border border-ink-700 bg-ink-900 p-3 shadow-2xl shadow-black/50 transition-[opacity,transform,visibility] duration-150 ease-out ${
                    profileOpen
                      ? "visible translate-y-0 scale-100 opacity-100"
                      : "invisible pointer-events-none -translate-y-1 scale-95 opacity-0"
                  }`}
                >
                  <div className="border-b border-ink-700 pb-3">
                    <p className="truncate font-sans text-xs font-semibold text-paper-50">{user.display_name || user.username}</p>
                    <p className="mt-1 font-mono text-[10px] text-paper-200/55">{user.username} · {user.role}</p>
                  </div>
                  <div className="space-y-2 border-b border-ink-700 py-3">
                    <p className="font-mono text-[9px] uppercase tracking-[0.16em] text-paper-200/45">System &amp; AI status</p>
                    <div className="flex items-center justify-between gap-3 font-mono text-[10px] text-paper-200/80">
                      <span className="inline-flex items-center gap-2">
                        <span className="h-1.5 w-1.5 rounded-full bg-teal animate-pulse-dot" />
                        JobList document processing
                      </span>
                      <span className="text-teal">active</span>
                    </div>
                    <a
                      href={quota?.link ?? "https://ai.dev/rate-limit"}
                      target="_blank"
                      rel="noreferrer"
                      title={quota?.detail ?? "Gemini grounding quota (last check)"}
                      role="menuitem"
                      className="flex items-center justify-between gap-3 font-mono text-[10px] text-paper-200/80 transition hover:text-paper-50"
                    >
                      <span className="inline-flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${
                          quota?.state === "ok" ? "bg-teal" : quota?.state === "exhausted" ? "bg-danger" : "bg-paper-200/40"
                        }`} />
                        quota: {!quota ? "…" : quota.state === "unknown" ? "not checked" : quota.state}
                      </span>
                      <span aria-hidden="true">↗</span>
                    </a>
                  </div>
                  <div className="space-y-1 pt-3">
                    <button
                      onClick={() => {
                        setTab("settings");
                        setProfileOpen(false);
                      }}
                      role="menuitem"
                      className="w-full rounded-md px-2 py-2 text-left font-mono text-[10px] text-paper-200/80 transition hover:bg-ink-800 hover:text-paper-50"
                    >
                      Account Settings
                    </button>
                    <button
                      onClick={signOut}
                      role="menuitem"
                      className="w-full rounded-md px-2 py-2 text-left font-mono text-[10px] text-danger transition hover:bg-danger/10"
                    >
                      Sign Out
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </header>

        {historyOpen && (
          <HistoryDrawer
            items={history}
            loading={historyLoading}
            onClose={() => setHistoryOpen(false)}
            onSelect={(id) => {
              setHistoryOpen(false);
              void openHistory(id);
            }}
            onDelete={removeHistory}
            onRename={renameRun}
          />
        )}

        {toastMessage && (
          <div
            role="alert"
            aria-live="assertive"
            className="fixed bottom-5 right-5 z-[80] flex max-w-lg items-start gap-3 rounded-xl border border-danger/40 bg-ink-900 px-4 py-3 shadow-2xl shadow-black/50"
          >
            <span className="mt-0.5 h-2 w-2 shrink-0 rounded-full bg-danger" />
            <p className="flex-1 font-mono text-xs leading-relaxed text-paper-50">{toastMessage}</p>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              aria-label="Dismiss error notification"
              className="text-paper-200/55 transition hover:text-paper-50"
            >
              ×
            </button>
          </div>
        )}

        <div className="w-full px-4 py-4 sm:px-6 lg:px-8">
          {error && (
            <div className="mb-5 rounded-xl border border-danger/30 bg-danger/5 p-4 font-mono text-xs text-danger">
              {error}
            </div>
          )}

          {/* ── setup wall: blocks the app until a personal AI key exists ── */}
          {needsSetup && !canBrowseWithoutKey && tab !== "settings" && (
            <section className="rounded-2xl border border-rose/30 bg-rose/5 p-6">
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-rose/80">
                Setup required
              </p>
              <h1 className="mt-3 font-mono text-2xl font-semibold leading-tight text-paper-50 sm:text-3xl">
                Add your API key first.
              </h1>
              <p className="mt-3 max-w-xl font-sans text-sm leading-relaxed text-paper-200/90">
                Every account must connect its own AI API key before running jobs or supplier
                searches. You still need a key for{" "}
                <span className="text-paper-50">
                  {missingProviders.map((p) => PROVIDER_LABELS[p] ?? p).join(" and ")}
                </span>
                .
              </p>
              <button
                onClick={() => setTab("settings")}
                className="mt-5 rounded-lg bg-maroon px-5 py-2.5 font-mono text-sm font-semibold text-paper-50 transition hover:bg-maroon-light"
              >
                GO TO SETTINGS
              </button>
            </section>
          )}

          <section className={tab === "dashboard" ? "" : "hidden"}>
            <Dashboard
              history={history}
              job={job}
              running={running}
              attendanceKey={user.username}
              onFiles={(incoming) => {
                onFiles(incoming);
                setTab("joblist");
              }}
              onNewRun={startNew}
              onOpenDirectory={(query) => {
                setDirectorySearchSeed(query ?? "");
                setTab("directory");
              }}
              onError={reportError}
            />
          </section>

          {/* ── 01 · JobList: upload, run, results ──────────────────────── */}
          <section className={tab === "joblist" && (!needsSetup || (showEmailDraft && done)) ? "" : "hidden"}>
            <div className={showEmailDraft && done ? "hidden" : ""}>
            <section className="pb-8 pt-6">
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-rose/80">Section 01 / 02 — JobList</p>
              <h1 className="mt-3 font-mono text-3xl font-semibold leading-tight text-paper-50 sm:text-4xl">
                Drop an ITB folder.
                <br />
                Get a spec sheet.
              </h1>
              <p className="mt-4 max-w-2xl font-sans text-sm leading-relaxed text-paper-200/90">
                Upload your Invitation To Bid documents and media. PDFs, Word, text, spreadsheets, presentations,
                images and audio metadata are read and combined before your AI provider separates line items from
                requirements and generates a formatted RFQ specification sheet.
              </p>
            </section>

            <DropZone
              onFiles={onFiles}
              onOpenHistory={() => {
                setHistoryOpen(true);
                void loadHistory();
              }}
              disabled={running}
            />

            {files.length > 0 && (
              <div className="mt-5 rounded-2xl border border-ink-700 bg-ink-900/70 p-5">
                <div className="flex items-center justify-between">
                  <p className="font-mono text-xs uppercase tracking-wide text-paper-200/85">
                    {files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(totalSize)}
                  </p>
                  <button
                    className="font-mono text-xs text-paper-200/85 transition hover:text-danger"
                    onClick={() => {
                      setFiles([]);
                      setJob(null);
                      setError(null);
                    }}
                    disabled={running}
                  >
                    clear
                  </button>
                </div>

                <ul className="mt-3 flex flex-wrap gap-2">
                  {files.map((f) => {
                    const badge = getFileTypeBadge(f.name);
                    return (
                      <li
                        key={f.name}
                        className="flex min-w-0 items-center gap-2 rounded-lg border border-ink-700 bg-ink-800 px-3 py-1.5 font-mono text-xs text-paper-200/95"
                      >
                        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[9px] uppercase ${badge.className}`}>
                          {badge.label}
                        </span>
                        <span className="max-w-[240px] truncate">{f.name}</span>
                        <span className="shrink-0 text-paper-200/60">{formatBytes(f.size)}</span>
                      </li>
                    );
                  })}
                </ul>

                <SettingsPanel
                  names={files.map((f) => f.name)}
                  value={skipFiles}
                  onChange={setSkipFiles}
                  disabled={running}
                />

                <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
                  <label className="flex items-center gap-2 font-mono text-xs text-paper-200/90">
                    <input
                      type="checkbox"
                      checked={includeImages}
                      onChange={(e) => setIncludeImages(e.target.checked)}
                      disabled={running}
                      className="h-4 w-4 accent-[var(--color-rose)]"
                    />
                    read images &amp; screenshots with AI vision
                  </label>

                  <button
                    onClick={process}
                    disabled={running}
                    className="rounded-lg bg-maroon px-6 py-2.5 font-mono text-sm font-semibold text-paper-50 transition hover:bg-maroon-light disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {running ? "PROCESSING…" : "RUN JOBLIST"}
                  </button>
                </div>
              </div>
            )}

            {job && (
              <div className="mt-5 space-y-5">
                <JobPanel job={job} />
                {done && (
                  <button
                    onClick={() => setTab("emails")}
                    className="rounded-lg border border-ink-700 px-3 py-2 font-mono text-xs text-paper-200/80 transition hover:border-red/50 hover:text-paper-50"
                  >
                    Open Quotation Emails
                  </button>
                )}
                {done && (
                  <AddFiles jobId={job.id} onProcessed={onFilesAdded} onError={reportError} />
                )}
                {done && <Results job={job} onUpdated={setJob} />}
                {done && <VersionsAudit job={job} onNextStep={() => setShowEmailDraft(true)} />}
              </div>
            )}
            <footer className="mt-10 border-t border-ink-700/70 pt-4 font-mono text-[10px] text-paper-200/50">
              DYNA CONSURV · local pipeline · powered by Gemini, OpenAI &amp; Anthropic
            </footer>
            </div>
            {showEmailDraft && done && job && (
              <EmailDraftPage
                job={job}
                onBack={() => setShowEmailDraft(false)}
                onJobUpdated={setJob}
              />
            )}
          </section>

          {/* ── Client / contractor directory workspace ─────────────────── */}
          <section className={tab === "directory" ? "" : "hidden"}>
            <ClientContractorWorkspace
              active={tab === "directory"}
              job={job}
              user={user}
              initialQuery={directorySearchSeed}
              onError={reportError}
              onUpdated={setJob}
              onGenerateEmail={openEmailFromDirectory}
            />
          </section>

          {/* ── 04 · quotation email (project) ──────────────────────────── */}
          <section className={tab === "emails" && !needsSetup ? "" : "hidden"}>
            <section className="pb-8 pt-6">
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-rose/80">Project — Quotation Email</p>
              <h1 className="mt-3 font-mono text-3xl font-semibold leading-tight text-paper-50 sm:text-4xl">
                Copy-ready RFQ emails.
              </h1>
              <p className="mt-4 max-w-2xl font-sans text-sm leading-relaxed text-paper-200/90">
                One quotation request email per line item, drafted from the extracted specs. Copy them
                individually or grab all of them at once.
              </p>
            </section>

            {done ? (
              <RfqEmails emails={job.result?.rfq_emails ?? []} />
            ) : (
              <div className="rounded-2xl border border-dashed border-ink-700 bg-ink-900/40 p-8 text-center">
                <p className="font-mono text-xs text-paper-200/85">
                  This project's JobList run must be finished before quotation emails are generated.
                </p>
              </div>
            )}
          </section>

            {/* ── 06 · settings (per-user AI provider/key/model, admin: users) ── */}
          <section className={tab === "settings" ? "" : "hidden"}>
            <section className="pb-8 pt-6">
              <p className="font-mono text-xs uppercase tracking-[0.3em] text-rose/80">Settings — AI</p>
              <h1 className="mt-3 font-mono text-3xl font-semibold leading-tight text-paper-50 sm:text-4xl">
                Your AI, your choice.
              </h1>
              <p className="mt-4 max-w-2xl font-sans text-sm leading-relaxed text-paper-200/90">
                Connect your own Gemini, OpenAI or Anthropic API key so your runs use your quota,
                and choose which provider and model reads your ITBs. Keys are stored on the server
                for your account and never shown back in full.
              </p>
            </section>

            <AiSettings
              onError={(msg) => setError(msg)}
              onSaved={() => {
                getCurrentUser()
                  .then((u) => {
                    if (u) setUser(u);
                  })
                  .catch(() => {
                    /* keep the old user; the wall re-checks on next load */
                  });
              }}
            />

            {user.role === "admin" && (
              <section className="mt-12">
                <section className="pb-6 pt-6">
                  <p className="font-mono text-xs uppercase tracking-[0.3em] text-rose/80">Admin — Users</p>
                  <h2 className="mt-3 font-mono text-2xl font-semibold leading-tight text-paper-50 sm:text-3xl">
                    Manage accounts.
                  </h2>
                  <p className="mt-4 max-w-2xl font-sans text-sm leading-relaxed text-paper-200/90">
                    Create accounts for your team, reset passwords, and remove users. This section is
                    visible to admins only.
                  </p>
                </section>

                <UsersAdmin currentUser={user} onError={(msg) => setError(msg)} />

                <section className="mt-12">
                  <section className="pb-6 pt-6">
                    <p className="font-mono text-xs uppercase tracking-[0.3em] text-rose/80">
                      Admin — User history
                    </p>
                    <h2 className="mt-3 font-mono text-2xl font-semibold leading-tight text-paper-50 sm:text-3xl">
                      Every run, every user.
                    </h2>
                    <p className="mt-4 max-w-2xl font-sans text-sm leading-relaxed text-paper-200/90">
                      This is the activity of every account on the server, grouped by user. It is
                      kept separate from your own history rail, which only ever shows the runs of
                      the account you are signed in as.
                    </p>
                  </section>

                  <AdminHistory onError={(msg) => setError(msg)} />
                </section>
              </section>
            )}
          </section>

        </div>
      </div>
    </div>
  );
}
