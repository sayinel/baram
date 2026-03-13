// §4.3 File tree — Mono-style SVG Icons (Lucide-based, 24x24 viewBox)

const S = {
  width: 14,
  height: 14,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinejoin: "round" as const,
  strokeLinecap: "round" as const,
};

export function IconChevron(): React.JSX.Element {
  return <>{"\u25B6"}</>;
}

export function IconFile({
  label,
  color,
}: {
  color?: string;
  label?: string;
}): React.JSX.Element {
  const props = color ? { ...S, stroke: color } : S;
  return (
    <svg {...props}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      {label && (
        <text
          fill={color ?? "currentColor"}
          fontFamily="system-ui,sans-serif"
          fontSize="8"
          fontWeight="700"
          stroke="none"
          textAnchor="middle"
          x="12"
          y="19"
        >
          {label}
        </text>
      )}
    </svg>
  );
}

export function IconFolder(): React.JSX.Element {
  return (
    <svg {...S}>
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  );
}

export function IconNewFile(): React.JSX.Element {
  return (
    <svg {...S}>
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" x2="12" y1="18" y2="12" />
      <line x1="9" x2="15" y1="15" y2="15" />
    </svg>
  );
}

export function IconNewFolder(): React.JSX.Element {
  return (
    <svg {...S}>
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
      <line x1="12" x2="12" y1="11" y2="17" />
      <line x1="9" x2="15" y1="14" y2="14" />
    </svg>
  );
}
