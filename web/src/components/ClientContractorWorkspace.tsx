import { useEffect, useRef, useState } from "react";
import { importSuppliers, parseSupplierFiles } from "../api";
import type { AuthUser, Job, SupplierDraft } from "../types";
import QuickSupplierSearch from "./QuickSupplierSearch";
import SupplierDirectory from "./SupplierDirectory";
import SupplierPanel from "./SupplierPanel";

const FILE_TYPES = ".xlsx,.csv,.pdf,.docx,.pptx,.png,.jpg,.jpeg";
const EMPTY_TABS = [
  { id: "master", label: "Master Directory" },
  { id: "quick", label: "Quick Search by Name" },
  { id: "shortlists", label: "Project Shortlists" },
] as const;
type DirectoryTab = (typeof EMPTY_TABS)[number]["id"];

export default function ClientContractorWorkspace({
  active,
  job,
  user,
  initialQuery,
  onError,
  onUpdated,
  onGenerateEmail,
}: {
  active: boolean;
  job: Job | null;
  user: AuthUser;
  initialQuery?: string;
  onError: (message: string) => void;
  onUpdated: (job: Job) => void;
  onGenerateEmail: () => void;
}) {
  const [tab, setTab] = useState<DirectoryTab>("master");
  const [query, setQuery] = useState(initialQuery ?? "");
  const [showAddForm, setShowAddForm] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [parsing, setParsing] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [reviewRows, setReviewRows] = useState<SupplierDraft[]>([]);
  const [selectedRows, setSelectedRows] = useState<Set<number>>(new Set());
  const [notice, setNotice] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const directorySearchRef = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);

  useEffect(() => {
    setQuery("");
    if (directorySearchRef.current) directorySearchRef.current.value = "";
  }, []);

  useEffect(() => {
    if (initialQuery !== undefined) setQuery(initialQuery);
  }, [initialQuery]);

  useEffect(() => {
    if (!active) {
      dragDepth.current = 0;
      setDragging(false);
      return;
    }

    const hasFiles = (event: DragEvent) =>
      Array.from(event.dataTransfer?.types ?? []).includes("Files");
    const handleDragEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current += 1;
      setDragging(true);
    };
    const handleDragOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const handleDragLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (!dragDepth.current) setDragging(false);
    };
    const handleDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      const files = Array.from(event.dataTransfer?.files ?? []);
      if (files.length) void parseFiles(files);
    };

    window.addEventListener("dragenter", handleDragEnter);
    window.addEventListener("dragover", handleDragOver);
    window.addEventListener("dragleave", handleDragLeave);
    window.addEventListener("drop", handleDrop);
    return () => {
      window.removeEventListener("dragenter", handleDragEnter);
      window.removeEventListener("dragover", handleDragOver);
      window.removeEventListener("dragleave", handleDragLeave);
      window.removeEventListener("drop", handleDrop);
    };
  }, [active]);

  const parseFiles = async (files: File[]) => {
    setParsing(true);
    setNotice(null);
    try {
      const rows = await parseSupplierFiles(files);
      setReviewRows(rows);
      setSelectedRows(new Set(rows.map((_, index) => index)));
      setNotice(
        rows.length
          ? `Found ${rows.length} supplier record${rows.length === 1 ? "" : "s"}. Review and append them to the directory.`
          : "No supplier records were found in those files.",
      );
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setParsing(false);
    }
  };

  const appendRows = async () => {
    const drafts = reviewRows.filter((_, index) => selectedRows.has(index));
    if (!drafts.length) return;
    setParsing(true);
    try {
      const result = await importSuppliers(drafts);
      setReviewRows((rows) => rows.filter((_, index) => !selectedRows.has(index)));
      setSelectedRows(new Set());
      setRefreshKey((key) => key + 1);
      setNotice(`Added ${result.added}; skipped ${result.skipped} duplicate or empty row${result.skipped === 1 ? "" : "s"}.`);
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      setParsing(false);
    }
  };

  const updateReviewRow = (index: number, patch: Partial<SupplierDraft>) => {
    setReviewRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  };

  return (
    <section>
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-ink-800 pb-5 pt-4">
        <div>
          <p className="font-mono text-[10px] uppercase tracking-[0.3em] text-rose/80">Workspace / Directory</p>
          <h1 className="mt-2 font-mono text-2xl font-semibold text-paper-50 sm:text-3xl">
            Client / Contractor List
          </h1>
        </div>
        <div className="flex w-full flex-wrap gap-2 sm:w-auto">
          <label className="min-w-[220px] flex-1 sm:w-64 sm:flex-none">
            <span className="sr-only">Search contractors</span>
            <input
              ref={directorySearchRef}
              id="contractor_directory_search_no_autofill"
              name="contractor_directory_search_no_autofill"
              autoComplete="new-password"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search contractors..."
              className="w-full rounded-lg border border-ink-700 bg-[#16181E] px-3 py-2.5 font-mono text-xs text-paper-50 placeholder:text-paper-200/50 focus:border-rose focus:outline-none"
            />
          </label>
          <button
            onClick={() => {
              setTab("master");
              setShowAddForm(true);
            }}
            className="rounded-lg bg-maroon px-4 py-2.5 font-mono text-xs font-semibold text-paper-50 transition hover:bg-maroon-light"
          >
            + New Contractor/Client
          </button>
        </div>
      </div>

      <nav className="mt-5 border-b border-ink-800">
        <ul className="flex gap-5 overflow-x-auto font-mono text-xs">
          {EMPTY_TABS.map((item) => (
            <li key={item.id}>
              <button
                onClick={() => setTab(item.id)}
                aria-current={tab === item.id ? "page" : undefined}
                className={`whitespace-nowrap border-b-2 px-1 py-3 transition ${
                  tab === item.id
                    ? "border-rose text-rose"
                    : "border-transparent text-paper-200/75 hover:text-paper-50"
                }`}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className={tab === "master" ? "pt-5" : "hidden"}>
        <div
          onClick={() => fileInput.current?.click()}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") fileInput.current?.click();
          }}
          role="button"
          tabIndex={0}
          className="mb-4 flex cursor-pointer flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-rose/50 bg-maroon-800/30 px-5 py-4 transition hover:bg-maroon-800/50"
        >
          <div>
            <p className="font-mono text-xs font-semibold text-paper-50">
              {parsing ? "READING SUPPLIER DOCUMENTS…" : "Drop supplier documents to extract records"}
            </p>
            <p className="mt-1 font-mono text-[10px] text-paper-200/70">
              Excel, CSV, PDF, Word, PowerPoint or images · extracted rows can be reviewed before saving
            </p>
          </div>
          <span className="rounded-lg border border-ink-600 px-3 py-2 font-mono text-[10px] text-paper-200/85">
            {parsing ? "PARSING…" : "BROWSE FILES"}
          </span>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={FILE_TYPES}
            className="hidden"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              event.target.value = "";
              if (files.length) void parseFiles(files);
            }}
          />
        </div>

        {notice && (
          <p className="mb-4 rounded-lg border border-teal/30 bg-teal/5 px-3 py-2 font-mono text-[11px] text-teal">
            {notice}
          </p>
        )}

        {reviewRows.length > 0 && (
          <section className="mb-5 overflow-hidden rounded-xl border border-rose/30 bg-[#16181E]">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-[#12141A] px-4 py-3">
              <p className="font-mono text-xs font-semibold text-paper-50">Review extracted records</p>
              <button
                onClick={appendRows}
                disabled={parsing || selectedRows.size === 0}
                className="rounded-lg bg-maroon px-3 py-2 font-mono text-[10px] font-semibold text-paper-50 disabled:opacity-50"
              >
                {parsing ? "SAVING…" : `APPEND SELECTED (${selectedRows.size})`}
              </button>
            </div>
            <div className="max-h-[45vh] overflow-auto">
              <table className="w-full min-w-[700px] border-collapse text-left">
                <thead className="sticky top-0 bg-[#12141A] font-mono text-[10px] uppercase tracking-wider text-paper-200/75">
                  <tr>
                    <th className="px-3 py-2">ID</th>
                    <th className="px-3 py-2">NAME</th>
                    <th className="px-3 py-2">BUSINESS / SCOPE + CONTACT</th>
                    <th className="px-3 py-2">SOURCE / ACTIONS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/5">
                  {reviewRows.map((row, index) => (
                    <tr key={`${row.source}-${index}`} className="align-top hover:bg-white/[0.03]">
                      <td className="px-3 py-3">
                        <input
                          type="checkbox"
                          checked={selectedRows.has(index)}
                          onChange={(event) => {
                            setSelectedRows((selected) => {
                              const next = new Set(selected);
                              if (event.target.checked) next.add(index);
                              else next.delete(index);
                              return next;
                            });
                          }}
                          aria-label={`Select extracted row ${index + 1}`}
                        />
                        <span className="ml-2 font-mono text-[10px] text-paper-200/60">{index + 1}</span>
                      </td>
                      <td className="px-3 py-2">
                        <input
                          value={row.company_name}
                          onChange={(event) => updateReviewRow(index, { company_name: event.target.value })}
                          aria-label="Contractor name"
                          className="w-full min-w-40 rounded border border-ink-700 bg-ink-950/60 px-2 py-1.5 font-mono text-xs text-paper-50"
                        />
                      </td>
                      <td className="space-y-1 px-3 py-2">
                        <input
                          value={row.business_scope}
                          onChange={(event) => updateReviewRow(index, { business_scope: event.target.value })}
                          placeholder="business scope"
                          aria-label="Business scope"
                          className="w-full min-w-52 rounded border border-ink-700 bg-ink-950/60 px-2 py-1.5 font-mono text-xs text-paper-50"
                        />
                        <div className="flex gap-1">
                          <input
                            value={row.contact}
                            onChange={(event) => updateReviewRow(index, { contact: event.target.value })}
                            placeholder="contact"
                            aria-label="Contact"
                            className="w-1/2 min-w-24 rounded border border-ink-700 bg-ink-950/60 px-2 py-1.5 font-mono text-[10px] text-paper-50"
                          />
                          <input
                            value={row.email}
                            onChange={(event) => updateReviewRow(index, { email: event.target.value })}
                            placeholder="email"
                            aria-label="Email"
                            className="w-1/2 min-w-28 rounded border border-ink-700 bg-ink-950/60 px-2 py-1.5 font-mono text-[10px] text-paper-50"
                          />
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="mb-1 max-w-36 truncate font-mono text-[10px] text-paper-200/60" title={row.source}>
                          {row.source}
                        </div>
                        <div className="flex gap-1">
                          <input
                            value={row.website}
                            onChange={(event) => updateReviewRow(index, { website: event.target.value })}
                            placeholder="website"
                            aria-label="Website"
                            className="w-36 rounded border border-ink-700 bg-ink-950/60 px-2 py-1.5 font-mono text-[10px] text-paper-50"
                          />
                          <button
                            onClick={() => {
                              setReviewRows((rows) => rows.filter((_, i) => i !== index));
                              setSelectedRows((rows) => new Set([...rows].filter((i) => i !== index).map((i) => i > index ? i - 1 : i)));
                            }}
                            className="rounded border border-ink-600 px-2 text-[10px] text-paper-200/75 hover:border-danger/50 hover:text-danger"
                            aria-label={`Remove extracted row ${index + 1}`}
                          >
                            remove
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <SupplierDirectory
          job={job}
          user={user}
          onError={onError}
          query={query}
          showForm={showAddForm}
          onShowFormChange={setShowAddForm}
          refreshKey={refreshKey}
        />
      </div>

      <div className={tab === "quick" ? "pt-5" : "hidden"}>
        <p className="mb-4 font-mono text-xs text-paper-200/75">Find suppliers by item name and append results to the master directory.</p>
        <QuickSupplierSearch
          onError={onError}
          onSaved={() => setRefreshKey((key) => key + 1)}
        />
      </div>

      <div className={tab === "shortlists" ? "pt-5" : "hidden"}>
        {job?.status === "done" ? (
          <SupplierPanel job={job} onError={onError} onUpdated={onUpdated} />
        ) : (
          <div className="rounded-xl border border-dashed border-ink-700 bg-[#16181E] p-8 text-center">
            <p className="font-mono text-xs text-paper-200/80">Open a completed JobList run to review its project shortlist.</p>
          </div>
        )}
      </div>

      <div className="mt-10 flex justify-end border-t border-ink-800 pt-5">
        <button
          type="button"
          onClick={onGenerateEmail}
          className="rounded-lg bg-maroon px-5 py-3 font-mono text-xs font-semibold text-paper-50 transition hover:bg-maroon-light focus:outline-none focus:ring-2 focus:ring-rose/60"
        >
          Generate Email <span aria-hidden="true">→</span>
        </button>
      </div>

      {dragging && active && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0D0E12]/90 p-8 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-2xl border-2 border-dashed border-rose bg-[#16181E] p-12 text-center">
            <p className="font-mono text-lg font-semibold text-paper-50">Drop files to extract contractor records</p>
            <p className="mt-3 font-mono text-xs text-paper-200/70">
              .xlsx · .csv · .pdf · .docx · .pptx · .png · .jpg · .jpeg
            </p>
          </div>
        </div>
      )}
    </section>
  );
}
