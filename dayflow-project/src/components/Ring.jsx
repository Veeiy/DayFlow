export const Ring = ({ pct, size = 140, stroke = 10, fg = "#1a1a2e", bg = "rgba(0,0,0,0.06)" }) => {
  const r = (size - stroke) / 2;
  const circ = 2 * Math.PI * r;
  const fill = Math.min(1, Math.max(0, pct)) * circ;
  return (
    <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={bg} strokeWidth={stroke}/>
      <circle
        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={fg} strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={`${fill} ${circ}`}
        style={{ transition: "stroke-dasharray 0.8s cubic-bezier(.4,0,.2,1)" }}
      />
    </svg>
  );
};
