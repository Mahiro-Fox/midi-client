type Props = { className?: string };

const base = "shrink-0";

export function IconPlay({ className = "" }: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={`${base} ${className}`}>
      <path d="M8 5.14v13.72a1 1 0 0 0 1.52.86l11-6.86a1 1 0 0 0 0-1.72l-11-6.86A1 1 0 0 0 8 5.14Z" />
    </svg>
  );
}

export function IconStop({ className = "" }: Props) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={`${base} ${className}`}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  );
}

export function IconRefresh({ className = "" }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} ${className}`}
    >
      <path d="M21 12a9 9 0 1 1-2.64-6.36" />
      <path d="M21 3v6h-6" />
    </svg>
  );
}

export function IconSearch({ className = "" }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={`${base} ${className}`}
    >
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function IconFolder({ className = "" }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} ${className}`}
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </svg>
  );
}

export function IconSparkle({ className = "" }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} ${className}`}
    >
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4" />
      <path d="M12 8.5 13.4 11l2.6 1-2.6 1-1.4 2.5L10.6 13 8 12l2.6-1Z" />
    </svg>
  );
}

export function IconClose({ className = "" }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      className={`${base} ${className}`}
    >
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

export function IconCheck({ className = "" }: Props) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`${base} ${className}`}
    >
      <path d="m4 12.5 5 5L20 6.5" />
    </svg>
  );
}

export function Logo({ className = "" }: Props) {
  return (
    <svg viewBox="0 0 32 32" className={`${base} ${className}`} aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="#14142a" />
      <rect x="1" y="1" width="30" height="30" rx="9" fill="none" stroke="#7c6cf5" strokeWidth="1.4" />
      <g fill="#f2f2f8">
        <rect x="7.5" y="9" width="4" height="14" rx="1" />
        <rect x="12.5" y="9" width="4" height="14" rx="1" />
        <rect x="17.5" y="9" width="4" height="14" rx="1" />
        <rect x="22.5" y="9" width="2.5" height="14" rx="1" />
      </g>
      <g fill="#0b0b16">
        <rect x="10.6" y="9" width="2.6" height="8" rx="0.8" />
        <rect x="15.6" y="9" width="2.6" height="8" rx="0.8" />
      </g>
    </svg>
  );
}
