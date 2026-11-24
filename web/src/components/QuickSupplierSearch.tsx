import { useState } from "react";
import { createSupplier, searchSuppliersByName } from "../api";
import type { Supplier } from "../types";

export default function QuickSupplierSearch({
  onError,
  onSaved,
}: {
  onError: (msg: string) => void;
  onSaved?: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [itemName, setItemName] = useState("");
  const [backend, setBackend] = useState<string | null>(null);
  const [savedKeys, setSavedKeys] = useState<Set<number>>(new Set());

  const run = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setSuppliers([]);
    try {
      const res = await searchSuppliersByName(name.trim(), description.trim());
      setItemName(res.item_name);
      setSuppliers(res.suppliers ?? []);
      setBackend(res.backend ?? null);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  const save = async (idx: number, s: Supplier) => {
    try {
      await createSupplier({
        company_name: s.company_name ?? "",
        business_scope: description.trim(),
        website: s.website ?? "",
        email: s.email ?? "",
        contact: s.contact ?? "",
        source: s.source ?? "",
        notes: itemName ? `found for ${itemName}` : "",
        tags: "",
      });
      setSavedKeys((prev) => new Set(prev).add(idx));
      onSaved?.();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="rounded-2xl border border-ink-700 bg-ink-900/70 p-6">
      <form onSubmit={run} className="space-y-3">
        <div>
          <label className="font-mono text-xs uppercase tracking-wide text-paper-200/85">Item name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. centrifugal pump"
            className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 font-mono text-sm text-paper-100"
          />
        </div>
        <div>
          <label className="font-mono text-xs uppercase tracking-wide text-paper-200/85">Description (optional)</label>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="optional context"
            className="mt-1 w-full rounded-lg border border-ink-600 bg-ink-800 px-3 py-2 font-mono text-sm text-paper-100"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !name.trim()}
          className="rounded-lg bg-maroon px-5 py-2.5 font-mono text-xs font-semibold text-paper-50 disabled:opacity-50"
        >
          {loading ? "SEARCHING…" : "FIND SUPPLIERS"}
        </button>
      </form>

      {suppliers.length > 0 && (
        <div className="mt-5 max-h-[60vh] overflow-auto rounded-xl border border-ink-800 bg-[#16181E]">
          <table className="w-full min-w-[620px] border-collapse text-left">
            <thead className="sticky top-0 bg-[#12141A] font-mono text-[10px] uppercase tracking-wider text-paper-200/75">
              <tr>
                <th className="px-3 py-3">ID</th>
                <th className="px-3 py-3">NAME</th>
                <th className="px-3 py-3">BUSINESS / SCOPE + CONTACT</th>
                <th className="px-3 py-3">SOURCE / ACTIONS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5 font-mono text-xs">
              {suppliers.map((s, i) => (
                <tr key={`${s.company_name}-${i}`} className="transition-colors hover:bg-white/[0.04]">
                  <td className="px-3 py-3 text-paper-200/60">{i + 1}</td>
                  <td className="px-3 py-3 font-semibold text-paper-50">{s.company_name || "—"}</td>
                  <td className="px-3 py-3 text-paper-200/85">
                    <div>{description || itemName}</div>
                    <div className="mt-1 flex gap-3 text-[10px] text-paper-200/65">
                      {s.contact && <span>{s.contact}</span>}
                      {s.email && <a href={`mailto:${s.email}`} className="hover:text-paper-50">{s.email}</a>}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    {s.source && (
                      <a
                        href={s.source}
                        target="_blank"
                        rel="noreferrer"
                        className="block max-w-36 truncate text-[10px] text-rose/80 hover:underline"
                      >
                        source
                      </a>
                    )}
                    {s.website && (
                      <a
                        href={s.website.startsWith("http") ? s.website : `https://${s.website}`}
                        target="_blank"
                        rel="noreferrer"
                        className="block max-w-36 truncate text-[10px] text-paper-200/65 hover:text-paper-50"
                      >
                        {s.website.replace(/^https?:\/\//, "")}
                      </a>
                    )}
                    <button
                      onClick={() => save(i, s)}
                      disabled={savedKeys.has(i)}
                      className={[
                        "mt-1 rounded border px-2 py-1 font-mono text-[10px] transition",
                        savedKeys.has(i)
                          ? "border-teal/40 text-teal"
                          : "border-ink-600 text-paper-200/85 hover:border-rose/50 hover:text-rose",
                      ].join(" ")}
                    >
                      {savedKeys.has(i) ? "appended ✓" : "+ append"}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!loading && suppliers.length === 0 && itemName && (
        <p className="mt-4 font-mono text-xs text-paper-200/85">No suppliers found.</p>
      )}
      {backend && suppliers.length > 0 && (
        <p className="mt-3 font-mono text-[10px] text-paper-200/80">
          via {backend === "web_search" ? "web search" : "live AI search"}
        </p>
      )}
    </div>
  );
}