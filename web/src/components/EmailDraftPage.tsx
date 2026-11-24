import { useEffect, useMemo, useState } from "react";
import { generateEmailDraft, saveEmailDraft, uploadEmailAttachments } from "../api";
import type { EmailDraft, EmailDraftUpdate, Job } from "../types";

const fieldClass =
  "w-full rounded-lg border border-ink-700 bg-ink-950/70 px-3 py-2 font-sans text-sm text-paper-50 placeholder:text-paper-200/50 focus:border-rose focus:outline-none";

function editableValues(draft: EmailDraft): EmailDraftUpdate {
  return {
    mode: draft.mode ?? "scratch",
    to: draft.to,
    cc: draft.cc,
    bcc: draft.bcc ?? "",
    subject: draft.subject,
    body: draft.body,
    selected_attachments: draft.selected_attachments,
  };
}

function copyText(text: string): Promise<void> {
  return navigator.clipboard.writeText(text);
}

export default function EmailDraftPage({
  job,
  onBack,
  onJobUpdated,
}: {
  job: Job;
  onBack: () => void;
  onJobUpdated: (job: Job) => void;
}) {
  const [draft, setDraft] = useState<EmailDraft | null>(job.email_draft ?? null);
  const [savedDraft, setSavedDraft] = useState<EmailDraft | null>(job.email_draft ?? null);
  const [loading, setLoading] = useState(!job.email_draft);
  const [saving, setSaving] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [showRegenerateConfirm, setShowRegenerateConfirm] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (job.email_draft) {
      const existing = {
        ...job.email_draft,
        mode: job.email_draft.mode ?? "pipeline",
        bcc: job.email_draft.bcc ?? "",
      };
      setDraft(existing);
      setSavedDraft(existing);
      setLoading(false);
      setError(null);
      return () => {
        cancelled = true;
      };
    }

    setLoading(true);
    setError(null);
    generateEmailDraft(job.id)
      .then((updated) => {
        if (cancelled) return;
        if (!updated.email_draft) {
          throw new Error("The server did not return an email draft.");
        }
        onJobUpdated(updated);
        const created = { ...updated.email_draft, mode: updated.email_draft.mode ?? "scratch" };
        setDraft(created);
        setSavedDraft(created);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [job.id, loadAttempt]);

  const dirty = useMemo(
    () =>
      !!draft &&
      !!savedDraft &&
      JSON.stringify(editableValues(draft)) !== JSON.stringify(editableValues(savedDraft)),
    [draft, savedDraft],
  );
  const hasManualEdits = dirty || Boolean(draft?.edited);
  const currentVersion = job.versions.length
    ? job.versions[job.versions.length - 1]
    : undefined;
  const draftIsOutdated =
    !!draft &&
    currentVersion?.id != null &&
    draft.source_version_id !== currentVersion.id;

  const updateField = (
    field: "to" | "cc" | "bcc" | "subject" | "body",
    value: string,
  ) => {
    setDraft((current) => (current ? { ...current, [field]: value } : current));
    setNotice(null);
  };

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await saveEmailDraft(job.id, editableValues(draft));
      if (!updated.email_draft) throw new Error("The server did not return the saved draft.");
      onJobUpdated(updated);
      setDraft(updated.email_draft);
      setSavedDraft(updated.email_draft);
      setNotice("Draft saved to this specification's audit history.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const regenerate = async () => {
    setRegenerating(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await generateEmailDraft(job.id, true, "pipeline");
      if (!updated.email_draft) throw new Error("The server did not return the regenerated draft.");
      onJobUpdated(updated);
      setDraft(updated.email_draft);
      setSavedDraft(updated.email_draft);
      setShowRegenerateConfirm(false);
      setNotice("A fresh draft was generated from the current specification.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setShowRegenerateConfirm(false);
    } finally {
      setRegenerating(false);
    }
  };

  const toggleAttachment = (id: string, checked: boolean) => {
    setDraft((current) => {
      if (!current) return current;
      const selected = new Set(current.selected_attachments);
      if (checked) selected.add(id);
      else selected.delete(id);
      return { ...current, selected_attachments: [...selected] };
    });
    setNotice(null);
  };

  const addAttachments = async (files: File[]) => {
    if (!files.length || !draft) return;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const updated = await uploadEmailAttachments(job.id, files);
      if (!updated.email_draft) throw new Error("The server did not return the updated draft.");
      onJobUpdated(updated);
      const available = updated.email_draft.available_attachments;
      setDraft((current) => current ? { ...current, available_attachments: available } : current);
      setSavedDraft((current) => current ? { ...current, available_attachments: available } : current);
      setNotice("Attachment added to this draft. It will not be sent automatically.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const writeFromScratch = () => {
    setDraft((current) => current ? { ...current, mode: "scratch", body: "" } : current);
    setNotice("Blank email body ready. Your recipient and subject fields remain editable.");
  };

  const copyEmail = async () => {
    if (!draft) return;
    try {
      const headers = [
        draft.to ? `To: ${draft.to}` : "",
        draft.cc ? `Cc: ${draft.cc}` : "",
        draft.bcc ? `Bcc: ${draft.bcc}` : "",
        draft.subject ? `Subject: ${draft.subject}` : "",
      ].filter(Boolean);
      await copyText(`${headers.join("\n")}${headers.length ? "\n\n" : ""}${draft.body}`);
      setNotice("Email copied to clipboard.");
    } catch {
      setError("Could not copy the email. Check clipboard permissions and try again.");
    }
  };

  const downloadDraft = () => {
    if (!draft) return;
    const headers = [
      draft.to ? `To: ${draft.to}` : "",
      draft.cc ? `Cc: ${draft.cc}` : "",
      draft.bcc ? `Bcc: ${draft.bcc}` : "",
      `Subject: ${draft.subject}`,
      "MIME-Version: 1.0",
      "Content-Type: text/plain; charset=UTF-8",
      "Content-Transfer-Encoding: 8bit",
    ].filter(Boolean);
    const blob = new Blob(
      [`${headers.join("\r\n")}\r\n\r\n${draft.body}`],
      { type: "message/rfc822;charset=utf-8" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `email-draft-${job.id}.eml`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const openInEmail = () => {
    if (!draft) return;
    const params = new URLSearchParams({
      cc: draft.cc,
      bcc: draft.bcc,
      subject: draft.subject,
      body: draft.body,
    });
    window.location.href = `mailto:${encodeURIComponent(draft.to)}?${params.toString()}`;
  };

  const summary = draft?.summary;
  const summaryFields: [string, string | undefined][] = [
    ["Tender / RFQ reference", summary?.reference],
    ["Client", summary?.client],
    ["Tender title", summary?.title],
    ["Item count", summary?.item_count == null ? undefined : String(summary.item_count)],
    ["Specification status", summary?.specification_status],
    ["Supplier / recipient", summary?.supplier || summary?.supplier_email],
    ["Specification version", summary?.specification_version],
    ["Submission deadline", summary?.submission_deadline],
    ["Tender dates", summary?.tender_dates?.join(", ")],
    ["Generated date", summary?.generated_at?.replace("T", " ")],
  ];

  return (
    <div className="space-y-5 pb-8 pt-6">
      <div>
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-rose/80">
          JobList / Email Composer
        </p>
        <h1 className="mt-3 font-mono text-3xl font-semibold text-paper-50 sm:text-4xl">
          Generate Email
        </h1>
        <p className="mt-3 max-w-2xl font-sans text-sm text-paper-200/90">
          Create, edit, and prepare an email for your client or supplier.
        </p>
      </div>

      {loading && (
        <div className="rounded-2xl border border-ink-700 bg-ink-900/70 p-6 font-mono text-sm text-paper-200/90">
          <p>Generating email draft...</p>
          <p className="mt-2 text-xs text-paper-200/70">
            Preparing your email composer...
          </p>
        </div>
      )}

      {error && (
        <div className="rounded-xl border border-danger/40 bg-danger/5 p-4">
          <p className="font-mono text-sm text-danger">
            Unable to generate or save the email draft. {error}
          </p>
          {!draft && (
            <button
              onClick={() => setLoadAttempt((attempt) => attempt + 1)}
              className="mt-3 rounded-lg border border-ink-700 px-3 py-1.5 font-mono text-xs text-paper-50 hover:border-rose/50"
            >
              Try Again
            </button>
          )}
        </div>
      )}

      {notice && (
        <p role="status" className="rounded-lg border border-teal/30 bg-teal/5 px-3 py-2 font-mono text-xs text-teal">
          {notice}
        </p>
      )}

      {draft && !loading && (
        <>
          {draftIsOutdated && (
            <div className="rounded-xl border border-amber-400/30 bg-amber-400/5 p-3 font-mono text-xs text-amber-200">
              This draft uses specification {draft.source_version_tag ?? "version unavailable"}; the current specification is {currentVersion?.tag}.
              Generate from JobList to base a suggestion on the current version.
            </div>
          )}

          <section className="rounded-2xl border border-ink-700 bg-ink-900/70 p-5">
            <div className="flex items-center justify-between gap-3">
              <h2 className="font-mono text-xs uppercase tracking-wide text-paper-200/85">
                Tender information summary
              </h2>
              <span className="font-mono text-[11px] text-teal">
                {draft.source_version_tag ?? "specification"}
              </span>
            </div>
            <dl className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {summaryFields.filter(([, value]) => value).map(([label, value]) => (
                <div key={label} className="rounded-lg border border-ink-800 bg-ink-950/40 p-3">
                  <dt className="font-mono text-[10px] uppercase tracking-wide text-paper-200/65">{label}</dt>
                  <dd className="mt-1 break-words font-sans text-sm text-paper-50">{value}</dd>
                </div>
              ))}
            </dl>
            {!!summary?.notes?.length && (
              <div className="mt-4 rounded-lg border border-ink-800 bg-ink-950/40 p-3">
                <p className="font-mono text-[10px] uppercase tracking-wide text-paper-200/65">Relevant notes</p>
                <ul className="mt-2 list-disc space-y-1 pl-5 font-sans text-xs text-paper-200/90">
                  {summary.notes.map((note, index) => <li key={`${index}-${note}`}>{note}</li>)}
                </ul>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-ink-700 bg-ink-900/70 p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h2 className="font-mono text-xs uppercase tracking-wide text-paper-200/85">Email composer</h2>
                <p className="mt-1 font-sans text-xs text-paper-200/70">
                  Write freely or use the current JobList data as an optional starting point.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={writeFromScratch}
                  disabled={saving || regenerating}
                  className={`rounded-lg border px-3 py-2 font-mono text-[10px] transition disabled:opacity-50 ${
                    draft.mode === "scratch"
                      ? "border-rose/60 bg-rose/10 text-paper-50"
                      : "border-ink-700 text-paper-200/90 hover:border-rose/50"
                  }`}
                >
                  Write from Scratch
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (hasManualEdits || draft.body || draft.subject || draft.to || draft.cc || draft.bcc) {
                      setShowRegenerateConfirm(true);
                    } else {
                      void regenerate();
                    }
                  }}
                  disabled={saving || regenerating}
                  className={`rounded-lg border px-3 py-2 font-mono text-[10px] transition disabled:opacity-50 ${
                    draft.mode === "pipeline"
                      ? "border-teal/50 bg-teal/5 text-teal"
                      : "border-ink-700 text-paper-200/90 hover:border-teal/50"
                  }`}
                >
                  Generate from JobList
                </button>
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <label className="space-y-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wide text-paper-200/75">To / Recipient</span>
                <input value={draft.to} onChange={(event) => updateField("to", event.target.value)} className={fieldClass} type="text" />
              </label>
              <label className="space-y-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wide text-paper-200/75">CC</span>
                <input value={draft.cc} onChange={(event) => updateField("cc", event.target.value)} className={fieldClass} type="text" />
              </label>
              <label className="space-y-1.5">
                <span className="font-mono text-[10px] uppercase tracking-wide text-paper-200/75">BCC</span>
                <input value={draft.bcc ?? ""} onChange={(event) => updateField("bcc", event.target.value)} className={fieldClass} type="text" />
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <span className="font-mono text-[10px] uppercase tracking-wide text-paper-200/75">Subject</span>
                <input value={draft.subject} onChange={(event) => updateField("subject", event.target.value)} className={fieldClass} type="text" />
              </label>
              <label className="space-y-1.5 sm:col-span-2">
                <span className="font-mono text-[10px] uppercase tracking-wide text-paper-200/75">Email body</span>
                <textarea
                  value={draft.body}
                  onChange={(event) => updateField("body", event.target.value)}
                  className={`${fieldClass} min-h-[300px] resize-y font-mono text-xs leading-relaxed`}
                  rows={14}
                />
              </label>
            </div>
          </section>

          <section className="rounded-2xl border border-ink-700 bg-ink-900/70 p-5">
            <h2 className="font-mono text-xs uppercase tracking-wide text-paper-200/85">Attachments</h2>
            <p className="mt-1 font-sans text-xs text-paper-200/70">
              Select documents to associate with this draft. They will not be attached or sent automatically.
            </p>
            <div className="mt-4 space-y-2">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-ink-700 px-3 py-2 font-mono text-xs text-paper-200/90 transition hover:border-rose/50">
                <span>+ Add Attachment</span>
                <input
                  type="file"
                  multiple
                  accept="*/*"
                  className="sr-only"
                  onChange={(event) => {
                    void addAttachments(Array.from(event.target.files ?? []));
                    event.target.value = "";
                  }}
                  disabled={saving || regenerating}
                />
              </label>
              {draft.available_attachments.map((attachment) => (
                <label key={attachment.id} className="flex items-center gap-3 rounded-lg border border-ink-800 bg-ink-950/40 px-3 py-2 font-mono text-xs text-paper-200/90">
                  <input
                    type="checkbox"
                    checked={draft.selected_attachments.includes(attachment.id)}
                    onChange={(event) => toggleAttachment(attachment.id, event.target.checked)}
                    className="h-4 w-4 accent-[var(--color-teal)]"
                  />
                  <span className="min-w-0 flex-1 truncate">{attachment.name}</span>
                  <span className="text-[9px] uppercase text-paper-200/55">{attachment.kind}</span>
                </label>
              ))}
              {draft.available_attachments.length === 0 && (
                <p className="font-mono text-xs text-paper-200/60">No source or generated documents are available.</p>
              )}
            </div>
          </section>

          <div className="flex flex-wrap items-center justify-between gap-3">
            {dirty && (
              <span className="w-full font-mono text-[10px] text-amber-200">
                Unsaved edits
              </span>
            )}
            <button
              onClick={onBack}
              className="rounded-lg border border-ink-700 px-4 py-2 font-mono text-xs text-paper-200/90 transition hover:border-rose/50 hover:text-paper-50"
            >
              ← Back to JobList
            </button>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => setShowRegenerateConfirm(true)}
                disabled={saving || regenerating}
                className="rounded-lg border border-ink-700 px-3 py-2 font-mono text-xs text-paper-200/90 transition hover:border-rose/50 hover:text-paper-50 disabled:opacity-50"
              >
                Regenerate
              </button>
              <button
                onClick={save}
                disabled={saving || regenerating}
                className="rounded-lg bg-maroon px-4 py-2 font-mono text-xs font-semibold text-paper-50 transition hover:bg-maroon-light disabled:opacity-50"
              >
                {saving ? "SAVING…" : "SAVE DRAFT"}
              </button>
              <button
                onClick={copyEmail}
                disabled={saving || regenerating}
                className="rounded-lg border border-ink-700 px-3 py-2 font-mono text-xs text-paper-200/90 transition hover:border-rose/50 hover:text-paper-50 disabled:opacity-50"
              >
                Copy Email
              </button>
              <button
                onClick={downloadDraft}
                disabled={saving || regenerating}
                className="rounded-lg border border-ink-700 px-3 py-2 font-mono text-xs text-paper-200/90 transition hover:border-rose/50 hover:text-paper-50 disabled:opacity-50"
              >
                Download Draft
              </button>
              <button
                onClick={openInEmail}
                disabled={saving || regenerating}
                className="rounded-lg border border-teal/40 px-3 py-2 font-mono text-xs text-teal transition hover:bg-teal/10 disabled:opacity-50"
              >
                Open in Email
              </button>
            </div>
          </div>

          {showRegenerateConfirm && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="presentation">
              <div className="w-full max-w-md rounded-2xl border border-ink-600 bg-ink-900 p-5 shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="regenerate-title">
                <h2 id="regenerate-title" className="font-mono text-sm font-semibold text-paper-50">Replace this email draft?</h2>
                <p className="mt-2 font-sans text-sm text-paper-200/85">
                  {hasManualEdits
                    ? "Regenerating will replace the current draft and discard its saved or unsaved edits. Continue?"
                    : "Regenerating will replace the current email draft with fresh content. Continue?"}
                </p>
                <div className="mt-5 flex justify-end gap-2">
                  <button
                    onClick={() => setShowRegenerateConfirm(false)}
                    disabled={regenerating}
                    className="rounded-lg border border-ink-700 px-3 py-2 font-mono text-xs text-paper-200/90"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={regenerate}
                    disabled={regenerating}
                    className="rounded-lg bg-maroon px-3 py-2 font-mono text-xs font-semibold text-paper-50 disabled:opacity-50"
                  >
                    {regenerating ? "REGENERATING…" : "REGENERATE"}
                  </button>
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!loading && (
        <p className="font-mono text-[10px] text-paper-200/50">
          Drafts are saved separately from specification versions. Email is never sent automatically.
        </p>
      )}
    </div>
  );
}
