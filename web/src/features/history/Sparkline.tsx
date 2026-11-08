export function Sparkline({ values, label }: { values: readonly (number | null)[]; label: string }) {
  const width = 160;
  const height = 40;
  const points = values.flatMap((v, i) => (v === null ? [] : [{ x: values.length === 1 ? width / 2 : (i / (values.length - 1)) * width, y: height - (Math.max(0, Math.min(100, v)) / 100) * height }]));
  if (points.length === 0) return <span className="text-sm text-slate-500">no scores</span>;
  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const last = points[points.length - 1]!;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} width={width} height={height} role="img" aria-label={label} className="overflow-visible">
      <line x1="0" y1={height * 0.2} x2={width} y2={height * 0.2} stroke="#cbd5e1" strokeDasharray="3 3" />
      <path d={path} fill="none" stroke="#0f766e" strokeWidth="2" />
      <circle cx={last.x} cy={last.y} r="3" fill="#0f766e" />
    </svg>
  );
}
