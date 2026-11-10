type Props = { className?: string };

/** 应用图标里的钢琴键盘，图形简单，直接用内联 SVG 而不走 lucide */
export function Logo({ className = "" }: Props) {
  return (
    <svg viewBox="0 0 32 32" className={`shrink-0 ${className}`} aria-hidden="true">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="#14142a" />
      <rect
        x="1"
        y="1"
        width="30"
        height="30"
        rx="9"
        fill="none"
        stroke="#7c6cf5"
        strokeWidth="1.4"
      />
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
