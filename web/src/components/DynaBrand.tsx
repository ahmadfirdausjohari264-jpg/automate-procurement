import { useId } from "react";

export default function DynaBrand({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, "");

  return (
    <div
      role="img"
      aria-label="DYNACONSURV"
      className={`flex min-w-0 items-center gap-2 whitespace-nowrap ${className}`}
    >
      <svg
        className="h-6 w-8 shrink-0"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id={`${gradientId}-gray`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4A4A4A" />
            <stop offset="100%" stopColor="#1C1C1C" />
          </linearGradient>
          <linearGradient id={`${gradientId}-red`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4D0000" />
            <stop offset="100%" stopColor="#E63946" />
          </linearGradient>
        </defs>
        <polyline
          points="2 3 11 12 2 21"
          stroke={`url(#${gradientId}-gray)`}
          strokeWidth="5"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
        <polyline
          points="13 3 22 12 13 21"
          stroke={`url(#${gradientId}-red)`}
          strokeWidth="5"
          strokeLinecap="square"
          strokeLinejoin="miter"
        />
      </svg>
      <span className={`flex overflow-hidden font-sans text-sm font-bold tracking-[0.12em] ${compact ? "md:hidden" : ""}`}>
        <span className="text-paper-50">DYNA</span>
        <span className="text-rose">CONSURV</span>
      </span>
    </div>
  );
}
