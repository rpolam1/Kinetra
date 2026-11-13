import { computeAge, formatPercent, formatWeek } from '../../domain';
import type { ExerciseProgress, HeartProgress, Patient, ProgressReport, WeekPoint } from '../../domain';
import { changeTone, describeChange, fmtDegrees, fmtSeconds, metricsFor } from './format';
import type { MetricSpec } from './format';

// Brand colours for the report. They are plain hex because the report is a separate document with no access to the page styles.
const TEAL = '#0f766e';
const TEAL_DARK = '#0b3b38';
const TEAL_SOFT = '#ccfbf1';
const AMBER = '#b45309';
const INK = '#0f172a';
const MUTED = '#64748b';
const GRID = '#e2e8f0';
// The most points shown in the highlights list
const MAX_HIGHLIGHTS = 6;

/** Escapes text so it can go inside HTML. Patient names and goals are typed by staff, so they cannot be trusted as markup. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Wraps text as a CSS string for the page footer, which is set through a custom property. */
export function cssString(text: string): string {
  const body = text
    .replace(/[\r\n]+/g, ' ')
    .replace(/[\\"]/g, (c) => `\\${c}`)
    .replace(/</g, '\\3c ')
    .replace(/>/g, '\\3e ');
  return `"${body}"`;
}

/** A long date in the person's own locale, or an empty string when there is no date. */
function longDate(ms: number | null): string {
  return ms === null ? '' : new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
}

/** The options for one chart in the report. */
interface ChartOptions<T extends { weekStart: number }> {
  pick: (w: T) => number | null;
  format: (v: number) => string;
  min?: number;
  max?: number;
  color?: string;
}

// The sizes of the small charts, in SVG units
const W = 240;
const H = 112;
const PAD = { left: 38, right: 14, top: 14, bottom: 22 };

/** Draws a weekly line chart as an inline SVG string. */
function lineChart<T extends { weekStart: number }>(weeks: readonly T[], o: ChartOptions<T>): string {
  const values = weeks.map(o.pick);
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) {
    return `<div class="empty">No data yet</div>`;
  }
  const color = o.color ?? TEAL;
  const lo0 = Math.min(...present);
  const hi0 = Math.max(...present);
  const span = hi0 - lo0 || Math.max(Math.abs(hi0) * 0.2, 1);
  const lo = o.min ?? lo0 - span * 0.2;
  const hi = o.max ?? hi0 + span * 0.2;
  const iw = W - PAD.left - PAD.right;
  const ih = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (weeks.length === 1 ? iw / 2 : (i / (weeks.length - 1)) * iw);
  const y = (v: number) => PAD.top + ih - ((v - lo) / (hi - lo || 1)) * ih;
  const pts = values.flatMap((v, i) => (v === null ? [] : [{ x: x(i), y: y(v), v, i }]));
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const base = PAD.top + ih;
  const area = pts.length > 1 ? `${line} L${pts[pts.length - 1]!.x.toFixed(1)},${base} L${pts[0]!.x.toFixed(1)},${base} Z` : '';
  const grid = [lo, (lo + hi) / 2, hi]
    .map(
      (t) =>
        `<line x1="${PAD.left}" x2="${W - PAD.right}" y1="${y(t).toFixed(1)}" y2="${y(t).toFixed(1)}" stroke="${GRID}" stroke-width="1"/>` +
        `<text x="${PAD.left - 5}" y="${(y(t) + 3).toFixed(1)}" text-anchor="end" font-size="8.5" fill="${MUTED}">${escapeHtml(o.format(t))}</text>`,
    )
    .join('');
  const last = pts[pts.length - 1]!;
  const labelX = Math.min(Math.max(last.x, PAD.left + 14), W - PAD.right - 4);
  const firstWeek = formatWeek(weeks[0]!.weekStart);
  const lastWeek = formatWeek(weeks[weeks.length - 1]!.weekStart);
  return (
    `<svg viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escapeHtml(`from ${firstWeek} to ${lastWeek}`)}">` +
    grid +
    (area ? `<path d="${area}" fill="${color}" opacity="0.12"/>` : '') +
    (pts.length > 1 ? `<path d="${line}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>` : '') +
    pts.map((p) => `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3" fill="#fff" stroke="${color}" stroke-width="1.8"/>`).join('') +
    `<text x="${labelX.toFixed(1)}" y="${(last.y - 7).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="${INK}">${escapeHtml(o.format(last.v))}</text>` +
    `<text x="${x(0).toFixed(1)}" y="${H - 7}" text-anchor="${weeks.length === 1 ? 'middle' : 'start'}" font-size="8.5" fill="${MUTED}">${escapeHtml(firstWeek)}</text>` +
    (weeks.length > 1 ? `<text x="${x(weeks.length - 1).toFixed(1)}" y="${H - 7}" text-anchor="end" font-size="8.5" fill="${MUTED}">${escapeHtml(lastWeek)}</text>` : '') +
    `</svg>`
  );
}

/** Draws the repetitions per week as a bar chart across the full page width. */
function barChart(weeks: readonly WeekPoint[]): string {
  const width = 720;
  const height = 150;
  const pad = { left: 36, right: 8, top: 18, bottom: 26 };
  const max = Math.max(...weeks.map((w) => w.reps), 1);
  const iw = width - pad.left - pad.right;
  const ih = height - pad.top - pad.bottom;
  const slot = iw / weeks.length;
  const bar = Math.min(slot * 0.62, 38);
  // Labels are skipped on long reports so the weeks do not run into each other
  const every = Math.ceil(weeks.length / 12);
  const bars = weeks
    .map((w, i) => {
      const h = (w.reps / max) * ih;
      const cx = pad.left + slot * i + slot / 2;
      return (
        `<rect x="${(cx - bar / 2).toFixed(1)}" y="${(pad.top + ih - h).toFixed(1)}" width="${bar.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${TEAL}"/>` +
        `<text x="${cx.toFixed(1)}" y="${(pad.top + ih - h - 4).toFixed(1)}" text-anchor="middle" font-size="9" font-weight="700" fill="${INK}">${w.reps}</text>` +
        (i % every === 0 ? `<text x="${cx.toFixed(1)}" y="${height - 8}" text-anchor="middle" font-size="9" fill="${MUTED}">${escapeHtml(formatWeek(w.weekStart))}</text>` : '')
      );
    })
    .join('');
  const grid = [0, max / 2, max]
    .map(
      (t) =>
        `<line x1="${pad.left}" x2="${width - pad.right}" y1="${(pad.top + ih - (t / max) * ih).toFixed(1)}" y2="${(pad.top + ih - (t / max) * ih).toFixed(1)}" stroke="${GRID}"/>` +
        `<text x="${pad.left - 5}" y="${(pad.top + ih - (t / max) * ih + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="${MUTED}">${Math.round(t)}</text>`,
    )
    .join('');
  return `<svg viewBox="0 0 ${width} ${height}" width="100%" role="img" aria-label="Repetitions per week">${grid}${bars}</svg>`;
}

/** The text and background colours for a change chip. */
function toneColor(tone: 'green' | 'amber' | 'slate'): { fg: string; bg: string } {
  if (tone === 'green') return { fg: '#047857', bg: '#d1fae5' };
  if (tone === 'amber') return { fg: AMBER, bg: '#fef3c7' };
  return { fg: '#475569', bg: '#f1f5f9' };
}

/** The chips that show how each metric changed since the first week. */
function chips(ex: ExerciseProgress): string {
  if (!ex.change) return `<p class="note">Changes appear once there are two or more weeks of data.</p>`;
  const change = ex.change;
  return (
    `<div class="chips">` +
    metricsFor(ex).map((m) => {
      const c = toneColor(changeTone(m, change[m.key]));
      return `<span class="chip" style="color:${c.fg};background:${c.bg}">${escapeHtml(m.title.split(' (')[0]!)}: ${escapeHtml(describeChange(m, change[m.key]))}</span>`;
    }).join('') +
    `</div>`
  );
}

/** A week by week table for timed exercises. */
function holdTable(weeks: readonly WeekPoint[]): string {
  const dash = '&mdash;';
  const rows = weeks
    .map(
      (w) =>
        `<tr><td>${escapeHtml(formatWeek(w.weekStart))}</td><td>${w.sessions}</td><td>${w.holdAttempts}</td><td>${w.holdsCompleted}</td>` +
        `<td>${w.bestHoldSeconds === null ? dash : escapeHtml(fmtSeconds(w.bestHoldSeconds))}</td>` +
        `<td>${w.avgHoldSeconds === null ? dash : escapeHtml(fmtSeconds(w.avgHoldSeconds))}</td></tr>`,
    )
    .join('');
  return (
    `<table><thead><tr><th>Week of</th><th>Sessions</th><th>Holds attempted</th><th>Holds completed</th><th>Longest hold</th><th>Average hold</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  );
}

/** A week by week table for rep based exercises. */
function table(weeks: readonly WeekPoint[]): string {
  const dash = '&mdash;';
  const rows = weeks
    .map(
      (w) =>
        `<tr><td>${escapeHtml(formatWeek(w.weekStart))}</td><td>${w.sessions}</td><td>${w.reps}</td>` +
        `<td>${w.goodRate === null ? dash : escapeHtml(formatPercent(w.goodRate))}</td>` +
        `<td>${w.avgScore === null ? dash : Math.round(w.avgScore)}</td>` +
        `<td>${w.avgRom === null ? dash : escapeHtml(fmtDegrees(w.avgRom))}</td>` +
        `<td>${w.avgRepSeconds === null ? dash : escapeHtml(fmtSeconds(w.avgRepSeconds))}</td></tr>`,
    )
    .join('');
  return (
    `<table><thead><tr><th>Week of</th><th>Sessions</th><th>Reps</th><th>Good reps</th><th>Form score</th><th>Range of motion</th><th>Seconds per rep</th></tr></thead>` +
    `<tbody>${rows}</tbody></table>`
  );
}

/** One exercise block with its charts, change chips and weekly table. */
function exerciseSection(ex: ExerciseProgress): string {
  const charts = metricsFor(ex).map(
    (m: MetricSpec) =>
      `<div class="chart"><h4>${escapeHtml(m.title)}</h4>${lineChart(ex.weeks, { pick: m.pick, format: m.format, min: m.min, max: m.max })}</div>`,
  ).join('');
  const ready = ex.readyToProgress
    ? `<div class="callout good"><strong>Ready to progress.</strong> The last two sessions had ${ex.goodRepsLastTwo.join(' and ')} good reps. Consider increasing the load or difficulty.</div>`
    : '';
  return (
    `<section class="exercise">` +
    `<div class="ex-head"><h3>${escapeHtml(ex.name)}</h3><span class="meta">${ex.sessions} session${ex.sessions === 1 ? '' : 's'} &middot; ${ex.timed ? `${ex.holdsCompleted} of ${ex.holdAttempts} holds completed` : `${ex.reps} reps`}</span></div>` +
    chips(ex) +
    ready +
    `<div class="charts">${charts}</div>` +
    (ex.timed ? holdTable(ex.weeks) : table(ex.weeks)) +
    `</section>`
  );
}

/** The heart rate block, shown only when a watch was worn. */
function heartSection(heart: HeartProgress): string {
  const bpm = (v: number) => `${Math.round(v)}`;
  const share = (v: number | null) => (v === null ? '&mdash;' : formatPercent(v));
  const zone = heart.zoneLow !== null && heart.zoneHigh !== null ? `${heart.zoneLow} to ${heart.zoneHigh} bpm` : 'not set';
  const stats: [string, string][] = [
    ['Average heart rate', heart.avgBpm !== null ? `${Math.round(heart.avgBpm)} bpm` : '&mdash;'],
    ['Highest recorded', heart.peakBpm !== null ? `${Math.round(heart.peakBpm)} bpm` : '&mdash;'],
    ['Time in target zone', share(heart.inZoneRate)],
    ['Above / below zone', `${share(heart.aboveRate)} / ${share(heart.belowRate)}`],
  ];
  return (
    `<section class="exercise heart">` +
    `<div class="ex-head"><h3>Heart rate</h3><span class="meta">${heart.sessions} session${heart.sessions === 1 ? '' : 's'} with a watch &middot; target zone ${escapeHtml(zone)}</span></div>` +
    `<div class="kpis four">${stats.map(([l, v]) => `<div class="kpi small"><div class="v">${v}</div><div class="l">${escapeHtml(l)}</div></div>`).join('')}</div>` +
    `<div class="charts two">` +
    `<div class="chart"><h4>Average heart rate (bpm)</h4>${lineChart(heart.weeks, { pick: (w) => w.avgBpm, format: bpm, color: '#be123c' })}</div>` +
    `<div class="chart"><h4>Time in target zone</h4>${lineChart(heart.weeks, { pick: (w) => w.inZoneRate, format: (v) => `${Math.round(v * 100)}%`, min: 0, max: 1 })}</div>` +
    `</div></section>`
  );
}

/** The short plain language points at the top of the report. The thresholds are small enough to ignore noise from week to week. */
export function highlights(report: ProgressReport): string[] {
  const out: string[] = [];
  if (report.heart && report.heart.inZoneRate !== null) {
    out.push(`Heart rate was in the target zone ${Math.round(report.heart.inZoneRate * 100)}% of the recorded time.`);
  }
  const weekCount = report.weeks.length;
  if (weekCount > 0) {
    const perWeek = report.sessionCount / weekCount;
    out.push(`${report.sessionCount} session${report.sessionCount === 1 ? '' : 's'} over ${weekCount} week${weekCount === 1 ? '' : 's'} (about ${perWeek.toFixed(1)} per active week).`);
  }
  for (const ex of report.exercises) {
    const c = ex.change;
    if (!c) continue;
    if (c.bestHoldSeconds !== null && c.bestHoldSeconds >= 3) out.push(`${ex.name}: longest hold is up ${Math.round(c.bestHoldSeconds)} seconds since the first week.`);
    if (c.bestHoldSeconds !== null && c.bestHoldSeconds <= -3) out.push(`Worth a look: ${ex.name} longest hold is down ${Math.round(Math.abs(c.bestHoldSeconds))} seconds.`);
    if (c.avgRom !== null && c.avgRom >= 5) out.push(`${ex.name}: range of motion is up ${Math.round(c.avgRom)}° since the first week.`);
    if (c.goodRate !== null && c.goodRate >= 0.1) out.push(`${ex.name}: good-rep rate is up ${Math.round(c.goodRate * 100)} points.`);
    if (c.goodRate !== null && c.goodRate <= -0.1) out.push(`Worth a look: ${ex.name} good-rep rate is down ${Math.round(Math.abs(c.goodRate) * 100)} points.`);
    if (c.avgRom !== null && c.avgRom <= -5) out.push(`Worth a look: ${ex.name} range of motion is down ${Math.round(Math.abs(c.avgRom))}°.`);
  }
  for (const ex of report.exercises) if (ex.readyToProgress) out.push(`${ex.name}: ready to progress.`);
  if (out.length <= 1 && report.weeks.length < 2) out.push('More weeks of data are needed to show a trend.');
  return out.slice(0, MAX_HIGHLIGHTS);
}

// The print layout. Colours are forced so the banner and charts keep their colour on paper.
const STYLE = `
@page { size: auto; margin: 14mm 13mm 17mm; @bottom-left { content: var(--footer-left); font: 8pt Helvetica, Arial, sans-serif; color: ${MUTED}; } @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt Helvetica, Arial, sans-serif; color: ${MUTED}; } }
* { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
html { font-family: "Segoe UI", -apple-system, Roboto, Helvetica, Arial, sans-serif; color: ${INK}; font-size: 10pt; line-height: 1.45; }
body { margin: 0; }
h1, h2, h3, h4, p { margin: 0; }
.banner { background: ${TEAL_DARK}; color: #fff; border-radius: 3mm; padding: 6mm 7mm; display: flex; justify-content: space-between; align-items: flex-end; }
.banner .brand { font-size: 9pt; letter-spacing: 0.18em; text-transform: uppercase; color: #5eead4; font-weight: 700; }
.banner h1 { font-size: 21pt; line-height: 1.1; margin-top: 1.5mm; }
.banner .sub { margin-top: 1.5mm; color: #cbd5e1; font-size: 9.5pt; }
.banner .period { text-align: right; font-size: 9pt; color: #cbd5e1; }
.banner .period strong { display: block; color: #fff; font-size: 10.5pt; margin-top: 0.5mm; }
.kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 4mm; margin-top: 5mm; }
.kpi { border: 0.3mm solid ${GRID}; border-top: 1.2mm solid ${TEAL}; border-radius: 2mm; padding: 3mm 4mm; background: #f8fafc; }
.kpi .v { font-size: 20pt; font-weight: 700; line-height: 1.1; }
.kpi .l { font-size: 8pt; color: ${MUTED}; text-transform: uppercase; letter-spacing: 0.06em; margin-top: 1mm; }
h2 { font-size: 12.5pt; margin: 7mm 0 2.5mm; padding-bottom: 1.5mm; border-bottom: 0.4mm solid ${TEAL}; color: ${TEAL_DARK}; }
.goals { background: ${TEAL_SOFT}; border-radius: 2mm; padding: 3mm 4mm; margin-top: 5mm; }
.goals .t { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.08em; color: ${TEAL_DARK}; font-weight: 700; }
ul.hl { margin: 0; padding-left: 5mm; }
ul.hl li { margin: 1mm 0; }
.overview, .exercise { break-inside: avoid; }
.exercises-title { break-before: page; margin-top: 0; }
.exercise { margin-top: 5mm; border: 0.3mm solid ${GRID}; border-radius: 2.5mm; padding: 3.5mm 5mm 4mm; }
.ex-head { display: flex; justify-content: space-between; align-items: baseline; gap: 4mm; border-left: 1.2mm solid ${TEAL}; padding-left: 3mm; }
.ex-head h3 { font-size: 13pt; }
.meta { color: ${MUTED}; font-size: 9pt; white-space: nowrap; }
.chips { display: flex; flex-wrap: wrap; gap: 2mm; margin-top: 3mm; }
.chip { font-size: 8.5pt; font-weight: 600; border-radius: 10mm; padding: 0.8mm 3mm; }
.note { color: ${MUTED}; font-size: 9pt; margin-top: 3mm; }
.callout { margin-top: 3mm; border-radius: 2mm; padding: 2.5mm 3.5mm; font-size: 9.5pt; }
.callout.good { background: #d1fae5; color: #065f46; }
.charts { display: grid; grid-template-columns: repeat(3, 1fr); gap: 3mm; margin-top: 3mm; }
.charts.two { grid-template-columns: repeat(2, 1fr); }
.kpis.four { margin-top: 3mm; }
.kpi.small .v { font-size: 14pt; }
.chart { border: 0.3mm solid ${GRID}; border-radius: 2mm; padding: 2mm 2.5mm 1mm; }
.chart h4 { font-size: 8.5pt; color: #334155; font-weight: 700; }
.empty { color: ${MUTED}; font-size: 9pt; text-align: center; padding: 12mm 0; }
table { width: 100%; border-collapse: collapse; margin-top: 3mm; font-size: 8.5pt; }
th { background: #f1f5f9; color: #334155; font-weight: 700; text-align: right; padding: 1.3mm 2.2mm; border-bottom: 0.4mm solid #cbd5e1; }
td { text-align: right; padding: 0.9mm 2.2mm; border-bottom: 0.2mm solid ${GRID}; }
th:first-child, td:first-child { text-align: left; }
tbody tr:nth-child(even) td { background: #f8fafc; }
.how { margin-top: 7mm; break-inside: avoid; font-size: 8.5pt; color: #475569; }
.how h2 { font-size: 10.5pt; }
.how dt { font-weight: 700; margin-top: 1.5mm; color: ${INK}; }
.how dd { margin: 0; }
.legal { margin-top: 5mm; font-size: 8pt; color: ${MUTED}; border-top: 0.2mm solid ${GRID}; padding-top: 2mm; }
`;

/** Builds the whole report as one self contained HTML document so it can be printed from a hidden frame. */
export function buildReportHtml(patient: Patient, report: ProgressReport, generatedAt: number): string {
  const name = `${patient.firstName} ${patient.lastName}`;
  const age = computeAge(patient.dateOfBirth);
  const subtitle = `${patient.code}${age !== null ? ` · ${age} years` : ''}`;
  const footer = `Kinetra · ${name} · ${patient.code} · Confidential`;
  const title = `Kinetra progress - ${name} - ${new Date(generatedAt).toISOString().slice(0, 10)}`;
  const kpis: [string, string][] = [
    ['Sessions', String(report.sessionCount)],
    ['Reps counted', String(report.totalReps)],
    ['Good-rep rate', formatPercent(report.goodRate)],
    ['Average form score', report.avgScore !== null ? `${Math.round(report.avgScore)}<span style="font-size:10pt;color:${MUTED}"> / 100</span>` : '&mdash;'],
  ];
  const points = highlights(report);
  return (
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>` +
    `<style>:root{--footer-left:${cssString(footer)}}${STYLE}</style></head><body>` +
    `<header class="banner"><div><div class="brand">Kinetra progress report</div><h1>${escapeHtml(name)}</h1><div class="sub">${escapeHtml(subtitle)}</div></div>` +
    `<div class="period">Reporting period<strong>${escapeHtml(longDate(report.from))} &ndash; ${escapeHtml(longDate(report.to))}</strong>Prepared ${escapeHtml(longDate(generatedAt))}</div></header>` +
    (patient.goals ? `<div class="goals"><div class="t">Goals</div><p>${escapeHtml(patient.goals)}</p></div>` : '') +
    `<div class="kpis">${kpis.map(([l, v]) => `<div class="kpi"><div class="v">${v}</div><div class="l">${escapeHtml(l)}</div></div>`).join('')}</div>` +
    `<section class="overview"><h2>Highlights</h2><ul class="hl">${points.map((p) => `<li>${escapeHtml(p)}</li>`).join('')}</ul></section>` +
    `<section class="overview"><h2>Repetitions per week</h2>${barChart(report.weeks)}</section>` +
    (report.heart ? `<h2 class="exercises-title">Heart rate</h2>${heartSection(report.heart)}` : '') +
    `<h2 class="exercises-title">Exercise progress</h2>` +
    report.exercises.map(exerciseSection).join('') +
    `<section class="how"><h2>How to read this report</h2><dl>` +
    `<dt>Good-rep rate</dt><dd>The share of scored repetitions rated good form (score 80 or higher).</dd>` +
    `<dt>Form score</dt><dd>Each repetition is compared with this person's own calibrated reference for the exercise, from 0 to 100.</dd>` +
    `<dt>Range of motion</dt><dd>How far the main joint moved, in degrees, measured from camera images. It depends on camera position, so compare weeks recorded with the same setup.</dd>` +
    `<dt>Hold time</dt><dd>For timed exercises such as the wall sit or plank: how long each hold lasted, counting attempts that stopped before the target. A hold under 3 seconds is ignored.</dd>` +
    (report.heart ? `<dt>Heart rate</dt><dd>Recorded by an Apple Watch worn during the session. The target zone comes from this person's resting heart rate and the prescribed intensity (heart-rate reserve method). Wrist readings can be inaccurate during vigorous arm movement, and people on beta blockers may not reach their calculated zone.</dd>` : '') +
    `<dt>Seconds per rep</dt><dd>Average time for one repetition. A slower, controlled tempo is not a problem; a much faster one can mean less control.</dd></dl>` +
    `<p class="legal">This report supports coaching and is not a clinical measurement or diagnosis.</p></section>` +
    `</body></html>`
  );
}
