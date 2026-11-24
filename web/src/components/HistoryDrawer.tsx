import { useState } from "react";
import type { HistoryItem } from "../types";

interface Props {
  items: HistoryItem[];
  loading: boolean;
  onClose: () => void;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, title: string) => void;
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const days = Math.floor((Date.now() - date.getTime()) / 86_400_000);
  if (days < 1) return "today";
  if (days === 1) return "1d ago";
  if (days < 7) return `${days}d ago`;
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function HistoryDrawer({
  items,
  loading,
  onClose,
  onSelect,
  onDelete,
  onRename,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  return (
    <div className="fixed inset-0 z-[70] flex justify-end">
      <button
        type="button"
        aria-label="Close saved run history"
        onClick={onClose}
        className="history-drawer-backdrop absolute inset-0 bg-black/65 backdrop-blur-[2px]"
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-labelledby="history-drawer-title"
        className="history-drawer-panel relative flex h-full w-full max-w-md flex-col border-l border-ink-700 bg-ink-950 shadow-2xl shadow-black/50"
      >
        <div className="flex items-start justify-between border-b border-ink-800 px-5 py-5">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-red">JobList archive</p>
            <h2 id="history-drawer-title" className="mt-1 font-sans text-lg font-semibold text-paper-50">
              Saved runs
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close history"
            className="flex h-8 w-8 items-center justify-center rounded-md border border-ink-700 text-paper-200/70 transition hover:border-ink-500 hover:text-paper-50"
          >
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
              <path d="m6 6 12 12M18 6 6 18" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-3">
          {loading && items.length === 0 ? (
            <p className="px-3 py-6 font-mono text-xs text-paper-200/55">Loading saved runs…</p>
          ) : items.length === 0 ? (
            <p className="px-3 py-6 font-mono text-xs leading-relaxed text-paper-200/55">
              No saved runs yet. Completed JobList runs will appear here.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {items.map((item) => (
                <li key={item.id} className="rounded-lg border border-transparent px-3 py-2 transition hover:border-ink-700 hover:bg-ink-900">
                  {editingId === item.id ? (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        const nextTitle = title.trim();
                        if (nextTitle) onRename(item.id, nextTitle);
                        setEditingId(null);
                      }}
                    >
                      <input
                        autoFocus
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        className="w-full rounded border border-ink-700 bg-ink-950 px-2 py-1.5 font-mono text-xs text-paper-50 focus:border-rose focus:outline-none"
                      />
                      <div className="mt-2 flex justify-end gap-3 font-mono text-[10px]">
                        <button type="button" onClick={() => setEditingId(null)} className="text-paper-200/70 hover:text-paper-50">Cancel</button>
                        <button type="submit" className="text-rose hover:text-paper-50">Save name</button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => onSelect(item.id)}
                        className="w-full text-left"
                      >
                        <span className="flex items-center gap-2">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            item.status === "done" ? "bg-teal" : item.status === "error" ? "bg-danger" : "bg-paper-200/40"
                          }`} />
                          <span className="min-w-0 flex-1 truncate font-mono text-xs font-medium text-paper-50">
                            {item.title}
                          </span>
                          <span className="shrink-0 font-mono text-[10px] text-paper-200/45">{formatWhen(item.created_at)}</span>
                        </span>
                        <span className="mt-1 block truncate pl-3.5 font-mono text-[10px] text-paper-200/55">
                          {item.subtitle}
                        </span>
                        <span className="mt-2 block pl-3.5 font-mono text-[9px] uppercase tracking-wide text-paper-200/40">
                          {item.line_items_count} item{item.line_items_count === 1 ? "" : "s"} · {item.files_count} file{item.files_count === 1 ? "" : "s"}
                        </span>
                      </button>
                      <div className="mt-2 flex justify-end gap-3 font-mono text-[10px]">
                        <button
                          type="button"
                          onClick={() => {
                            setTitle(item.title);
                            setEditingId(item.id);
                          }}
                          className="text-paper-200/55 transition hover:text-paper-50"
                        >
                          rename
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            if (window.confirm(`Delete "${item.title}" and its saved files?`)) {
                              onDelete(item.id);
                            }
                          }}
                          className="text-paper-200/55 transition hover:text-danger"
                        >
                          delete
                        </button>
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="border-t border-ink-800 px-5 py-3 font-mono text-[10px] text-paper-200/45">
          {items.length} saved run{items.length === 1 ? "" : "s"}
        </div>
      </aside>
    </div>
  );
}
