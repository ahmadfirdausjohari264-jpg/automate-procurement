import { useMemo } from "react";

/** Props for the SettingsPanel component. */
interface Props {
  /** Names of the currently selected files (used for the quick toggles). */
  names: string[];
  /** Raw textarea value: one filename per line. */
  value: string;
  /** Called whenever the skip list changes. */
  onChange: (value: string) => void;
  /** Disable the controls while a job is running. */
  disabled?: boolean;
}

/** Split the raw textarea text into a clean list of filenames. */
export function parseSkipList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Matches filenames the backend reads as documents (PDF / Word / Excel). */
const DOC_EXT = /\.(doc|docx|pdf|txt|rtf|odt|pages|xls|xlsx|xlsm|csv|ods|ppt|pptx|key|svg|psd|ai|mp3|wav|m4a|flac|ogg|opus|aac|aiff|aif|wma|png|jpe?g|webp|bmp|gif|tif|tiff)$/i;

/**
 * Settings section where the user lists exact filenames to skip.
 *
 * Every document is read by default; anything listed here (matched
 * case-insensitively on the full filename) is left out of item extraction.
 */
export default function SettingsPanel({ names, value, onChange, disabled }: Props) {
  const parsed = parseSkipList(value);
  const skipped = useMemo(
    () => new Set(parsed.map((s) => s.toLowerCase())),
    [value],
  );
  const docNames = useMemo(
    () => names.filter((n) => DOC_EXT.test(n)),
    [names],
  );

  /** Add the filename to the skip list, or remove it if already present. */
  const toggle = (name: string) => {
    const exists = parsed.some((s) => s.toLowerCase() === name.toLowerCase());
    const next = exists
      ? parsed.filter((s) => s.toLowerCase() !== name.toLowerCase())
      : [...parsed, name];
    onChange(next.join("\n"));
  };

  return (
    <div className="mt-4 rounded-xl border border-ink-700 bg-ink-800/50 p-4">
      <div className="flex items-center justify-between">
        <p className="font-mono text-xs uppercase tracking-wide text-paper-200/85">
          settings · skip files
        </p>
        <span className="font-mono text-[11px] text-paper-200/80">
          {skipped.size} skipped
        </span>
      </div>

      <p className="mt-2 font-sans text-xs leading-relaxed text-paper-200/85">
        Every supported file is read by default. Click a file below or type its{" "}
        <span className="text-paper-200/95">exact filename</span> (one per line) to exclude it
        from item extraction. Matching is case-insensitive.
      </p>

      {docNames.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {docNames.map((name) => {
            const active = skipped.has(name.toLowerCase());
            return (
              <button
                key={name}
                type="button"
                onClick={() => toggle(name)}
                disabled={disabled}
                className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-mono text-xs transition disabled:cursor-not-allowed disabled:opacity-50 ${
                  active
                    ? "border-danger/40 bg-danger/10 text-danger"
                    : "border-ink-700 bg-ink-900 text-paper-200/90 hover:border-rose/50 hover:text-paper-50"
                }`}
              >
                <span className="max-w-[240px] truncate">{name}</span>
                <span className="text-paper-200/80">{active ? "skip" : "+"}</span>
              </button>
            );
          })}
        </div>
      )}

      <textarea
        id="skip_files_input"
        name="skip_files_no_autofill"
        autoComplete="new-password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        rows={3}
        placeholder={"e.g. GENERAL TERMS AND CONDITIONS (GTC).docx"}
        className="mt-3 w-full resize-y rounded-lg border border-ink-700 bg-ink-900 px-3 py-2 font-mono text-xs text-paper-50 placeholder:text-paper-200/70 focus:border-rose focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />
    </div>
  );
}
