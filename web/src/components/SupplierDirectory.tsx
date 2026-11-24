import { useEffect, useMemo, useState } from "react";
import {
  createSupplier,
  deleteSupplier,
  importSuppliers,
  listSuppliers,
  updateSupplier,
} from "../api";
import type { AuthUser, Job, SavedSupplier, SupplierDraft, SupplierScope } from "../types";

/** Blank draft used by the "add supplier" form. */
const EMPTY_DRAFT: SupplierDraft = {
  company_name: "",
  business_scope: "",
  website: "",
  email: "",
  contact: "",
  source: "",
  notes: "",
  tags: "",
};

const FIELDS: { key: keyof SupplierDraft; label: string; placeholder: string }[] = [
  { key: "company_name", label: "company", placeholder: "Acme Industrial Ltd" },
  { key: "business_scope", label: "business / scope", placeholder: "industrial valves and maintenance" },
  { key: "website", label: "website", placeholder: "https://acme.com" },
  { key: "email", label: "email", placeholder: "sales@acme.com" },
  { key: "contact", label: "contact", placeholder: "name / phone" },
  { key: "source", label: "source", placeholder: "where you found them" },
  { key: "tags", label: "tags", placeholder: "steel, fasteners" },
];

/** Does a saved supplier match the free-text query (name/site/email/tags)? */
function matches(supplier: SavedSupplier, query: string): boolean {
  if (!query) return true;
  const haystack = [
    supplier.company_name,
    supplier.business_scope,
    supplier.website,
    supplier.email,
    supplier.contact,
    supplier.source,
    supplier.tags,
    supplier.notes,
  ]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

/**
 * Section 04 — a hand-curated master list of suppliers that lives independently
 * of any ITB run. Suppliers can be typed in by hand, edited, deleted, and a
 * finished run's shortlist can be imported in one click.
 */
export default function SupplierDirectory({
  job,
  user,
  onError,
  query,
  showForm: controlledShowForm,
  onShowFormChange,
  refreshKey,
}: {
  job: Job | null;
  user: AuthUser | null;
  onError: (msg: string) => void;
  query?: string;
  showForm?: boolean;
  onShowFormChange?: (value: boolean) => void;
  refreshKey?: number;
}) {
  const [items, setItems] = useState<SavedSupplier[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<SupplierScope>("mine");
  const [draft, setDraft] = useState<SupplierDraft>(EMPTY_DRAFT);
  const [adding, setAdding] = useState(false);
  const [localShowForm, setLocalShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editDraft, setEditDraft] = useState<SupplierDraft>(EMPTY_DRAFT);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const isAdmin = user?.role === "admin";
  const showForm = controlledShowForm ?? localShowForm;
  const activeQuery = query ?? "";
  const setShowForm = (value: boolean) => {
    if (onShowFormChange) onShowFormChange(value);
    else setLocalShowForm(value);
  };

  const load = async (which: SupplierScope = scope) => {
    setLoading(true);
    try {
      setItems(await listSuppliers(which));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!isAdmin && scope === "all") {
      setScope("mine");
      return;
    }
    load(scope);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, isAdmin, refreshKey]);

  /** Whether the current user may edit/delete a supplier entry. */
  const canEdit = (s: SavedSupplier) => !s.owner || s.owner === user?.id;

  const filtered = useMemo(
    () => items.filter((s) => matches(s, activeQuery.trim().toLowerCase())),
    [items, activeQuery],
  );

  const flash = (msg: string) => {
    setNotice(msg);
    window.setTimeout(() => setNotice((c) => (c === msg ? null : c)), 2500);
  };

  /** Add the manually-typed supplier. */
  const addManual = async () => {
    if (!draft.company_name.trim() && !draft.website.trim()) {
      onError("A supplier needs at least a company name or a website.");
      return;
    }
    setAdding(true);
    try {
      const created = await createSupplier(draft);
      setItems((prev) => [created, ...prev]);
      setDraft(EMPTY_DRAFT);
      setShowForm(false);
      flash(`added “${created.company_name || created.website}”`);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  /** Import every supplier found in the currently open run's shortlist. */
  const importFromRun = async () => {
    const rows = job?.result?.suppliers ?? [];
    const drafts: SupplierDraft[] = [];
    for (const row of rows) {
      for (const s of row.suppliers ?? []) {
        drafts.push({
          company_name: s.company_name ?? "",
          business_scope: "",
          website: s.website ?? "",
          email: s.email ?? "",
          contact: s.contact ?? "",
          source: s.source ?? "",
          notes: row.item_name ? `for ${row.item_name}` : "",
          tags: "",
        });
      }
    }
    if (drafts.length === 0) {
      onError("This run has no shortlisted suppliers to import.");
      return;
    }
    setAdding(true);
    try {
      const result = await importSuppliers(drafts);
      await load();
      flash(`imported ${result.added}, skipped ${result.skipped} duplicate(s)`);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (s: SavedSupplier) => {
    setEditingId(s.id);
    setEditDraft({
      company_name: s.company_name,
      business_scope: s.business_scope ?? "",
      website: s.website,
      email: s.email,
      contact: s.contact,
      source: s.source,
      notes: s.notes,
      tags: s.tags,
    });
  };

  const commitEdit = async () => {
    if (!editingId) return;
    setBusyId(editingId);
    try {
      const updated = await updateSupplier(editingId, editDraft);
      setItems((prev) => prev.map((s) => (s.id === editingId ? updated : s)));
      setEditingId(null);
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (id: string) => {
    setBusyId(id);
    try {
      await deleteSupplier(id);
      setItems((prev) => prev.filter((s) => s.id !== id));
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-900/70 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-mono text-xs uppercase tracking-wide text-paper-200/85">Master supplier list</p>
          <p className="mt-1 font-mono text-[11px] text-paper-200/80">
            {items.length} supplier{items.length === 1 ? "" : "s"} shown ·{" "}
            {scope === "mine" ? "your list" : "every user's list"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex overflow-hidden rounded-lg border border-ink-600">
            <button
              onClick={() => setScope("mine")}
              title="Show only your own suppliers"
              className={`px-3 py-2 font-mono text-xs transition ${
                scope === "mine"
                  ? "bg-maroon text-paper-50"
                  : "text-paper-200/90 hover:text-paper-50"
              }`}
            >
              my list
            </button>
            {isAdmin && (
              <button
                onClick={() => setScope("all")}
                title="Show suppliers saved by every user"
                className={`border-l border-ink-600 px-3 py-2 font-mono text-xs transition ${
                  scope === "all"
                    ? "bg-maroon text-paper-50"
                    : "text-paper-200/90 hover:text-paper-50"
                }`}
              >
                all users
              </button>
            )}
          </div>
          {job?.result?.suppliers?.some((r) => (r.suppliers?.length ?? 0) > 0) && (
            <button
              onClick={importFromRun}
              disabled={adding}
              title="Add every supplier found in the open run's shortlist"
              className="rounded-lg border border-ink-600 px-4 py-2 font-mono text-xs text-paper-200/90 transition hover:border-rose/50 hover:text-rose disabled:opacity-50"
            >
              import from current run
            </button>
          )}
        </div>
      </div>

      {scope === "all" && (
        <p className="mt-3 rounded-lg border border-ink-700 bg-ink-800/40 p-2.5 font-mono text-[11px] text-paper-200/85">
          Viewing suppliers from every user. Entries owned by someone else are read-only —
          switch to <span className="text-paper-100">my list</span> to edit your own.
        </p>
      )}

      {notice && (
        <p className="mt-3 rounded-lg border border-teal/30 bg-teal/5 p-2.5 font-mono text-[11px] text-teal">
          {notice}
        </p>
      )}

      {/* Manual add form */}
      {showForm && (
        <div className="mt-4 rounded-xl border border-ink-700 bg-ink-800/40 p-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {FIELDS.map((f) => (
              <label key={f.key} className="flex flex-col gap-1">
                <span className="font-mono text-[10px] uppercase tracking-wide text-paper-200/85">
                  {f.label}
                  {(f.key === "company_name" || f.key === "website") && <span className="text-rose"> *</span>}
                </span>
                <input
                  value={draft[f.key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                  placeholder={f.placeholder}
                  className="rounded border border-ink-700 bg-ink-950/60 px-2.5 py-1.5 font-mono text-xs text-paper-50 placeholder:text-paper-200/70 focus:border-rose focus:outline-none"
                />
              </label>
            ))}
            <label className="flex flex-col gap-1 sm:col-span-2">
              <span className="font-mono text-[10px] uppercase tracking-wide text-paper-200/85">notes</span>
              <input
                value={draft.notes}
                onChange={(e) => setDraft((d) => ({ ...d, notes: e.target.value }))}
                placeholder="anything worth remembering"
                className="rounded border border-ink-700 bg-ink-950/60 px-2.5 py-1.5 font-mono text-xs text-paper-50 placeholder:text-paper-200/70 focus:border-rose focus:outline-none"
              />
            </label>
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <button
              onClick={() => {
                setDraft(EMPTY_DRAFT);
                setShowForm(false);
              }}
              className="rounded-lg border border-ink-600 px-4 py-2 font-mono text-xs text-paper-200/90 transition hover:text-paper-100"
            >
              cancel
            </button>
            <button
              onClick={addManual}
              disabled={adding}
              className="rounded-lg bg-maroon px-5 py-2 font-mono text-xs font-semibold text-paper-50 transition hover:bg-maroon-light disabled:opacity-50"
            >
              {adding ? "SAVING…" : "SAVE"}
            </button>
          </div>
        </div>
      )}

      {/* List */}
      {loading ? (
        <p className="mt-6 font-mono text-xs text-paper-200/80">loading…</p>
      ) : items.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed border-ink-700 bg-ink-900/40 p-8 text-center">
          <p className="font-mono text-xs text-paper-200/85">
            No suppliers saved yet. Add one by hand, or import a run's shortlist.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <p className="mt-6 font-mono text-xs text-paper-200/80">No suppliers match “{activeQuery}”.</p>
      ) : (
        <div className="mt-4 max-h-[60vh] overflow-auto rounded-xl border border-ink-800 bg-[#16181E]">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead className="sticky top-0 z-10 bg-[#12141A] font-mono text-[10px] uppercase tracking-wider text-paper-200/80">
              <tr>
                <th className="px-3 py-3 font-medium">ID</th>
                <th className="px-3 py-3 font-medium">NAME</th>
                <th className="px-3 py-3 font-medium">BUSINESS / SCOPE</th>
                <th className="px-3 py-3 font-medium">SOURCE / ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono text-xs">
              {filtered.map((s) => (
                editingId === s.id ? (
                  <tr key={s.id}>
                    <td colSpan={4} className="p-4">
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        {FIELDS.map((f) => (
                          <label key={f.key} className="flex flex-col gap-1">
                            <span className="font-mono text-[10px] uppercase tracking-wide text-paper-200/85">
                              {f.label}
                            </span>
                            <input
                              value={editDraft[f.key] ?? ""}
                              onChange={(e) => setEditDraft((d) => ({ ...d, [f.key]: e.target.value }))}
                              className="rounded border border-ink-700 bg-ink-950/60 px-2.5 py-1.5 font-mono text-xs text-paper-50 focus:border-rose focus:outline-none"
                            />
                          </label>
                        ))}
                        <label className="flex flex-col gap-1 sm:col-span-2">
                          <span className="font-mono text-[10px] uppercase tracking-wide text-paper-200/85">notes</span>
                          <input
                            value={editDraft.notes}
                            onChange={(e) => setEditDraft((d) => ({ ...d, notes: e.target.value }))}
                            className="rounded border border-ink-700 bg-ink-950/60 px-2.5 py-1.5 font-mono text-xs text-paper-50 focus:border-rose focus:outline-none"
                          />
                        </label>
                      </div>
                      <div className="mt-3 flex justify-end gap-2">
                        <button
                          onClick={() => setEditingId(null)}
                          className="rounded-lg border border-ink-600 px-4 py-1.5 font-mono text-xs text-paper-200/90 transition hover:text-paper-100"
                        >
                          cancel
                        </button>
                        <button
                          onClick={commitEdit}
                          disabled={busyId === s.id}
                          className="rounded-lg bg-maroon px-4 py-1.5 font-mono text-xs font-semibold text-paper-50 transition hover:bg-maroon-light disabled:opacity-50"
                        >
                          save
                        </button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id} className="transition-colors hover:bg-white/[0.04]">
                    <td className="px-3 py-3 text-paper-200/60">{s.id.slice(0, 7)}</td>
                    <td className="max-w-56 px-3 py-3">
                      <div className="truncate font-semibold text-paper-50">{s.company_name || "— unnamed —"}</div>
                      {s.website && (
                        <a
                          href={s.website.startsWith("http") ? s.website : `https://${s.website}`}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-1 block truncate text-[10px] text-rose/80 hover:underline"
                        >
                          {s.website.replace(/^https?:\/\//, "")}
                        </a>
                      )}
                    </td>
                    <td className="max-w-72 px-3 py-3 text-paper-200/90">
                      <div>{s.business_scope || "—"}</div>
                      {s.tags && <div className="mt-1 text-[10px] text-paper-200/65">{s.tags}</div>}
                      {s.notes && <div className="mt-1 text-[10px] text-paper-200/60">{s.notes}</div>}
                      <div className="mt-1 flex flex-wrap gap-x-3 text-[10px] text-paper-200/70">
                        {s.contact && <span>{s.contact}</span>}
                        {s.email && <a href={`mailto:${s.email}`} className="hover:text-paper-50">{s.email}</a>}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="max-w-40 truncate text-[10px] text-paper-200/70" title={s.source}>
                        {s.source || "—"}
                      </div>
                      <div className="mt-2 flex gap-1">
                        {canEdit(s) ? (
                          <>
                            <button
                              onClick={() => startEdit(s)}
                              className="rounded border border-ink-600 px-2 py-1 text-[10px] text-paper-200/90 transition hover:border-rose/50 hover:text-rose"
                            >
                              edit
                            </button>
                            <button
                              onClick={() => remove(s.id)}
                              disabled={busyId === s.id}
                              className="rounded border border-ink-600 px-2 py-1 text-[10px] text-paper-200/90 transition hover:border-danger/50 hover:text-danger disabled:opacity-50"
                            >
                              delete
                            </button>
                          </>
                        ) : (
                          <span title="Saved by another user — read only" className="text-[10px] text-paper-200/60">
                            read only
                          </span>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
