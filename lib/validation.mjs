const SUS_IDS = ['valeria', 'mateo', 'camila', 'julian', 'sofia'];
function int(v, min, max) { v = Math.floor(Number(v)); return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min; }
function tsOrNull(v) { v = Number(v); return Number.isFinite(v) && v > 0 && v < 4e12 ? v : null; }
function clean(d) {
  d = d && typeof d === 'object' ? d : {};
  const closed = d.status === 'solved' || d.status === 'gaveup';
  const opened = Array.isArray(d.opened) ? [...new Set(d.opened.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 8))].sort((a, b) => a - b) : [];
  return {
    team: String(d.team || '').slice(0, 40),
    status: closed ? d.status : 'playing',
    start: tsOrNull(d.start),
    end: closed ? tsOrNull(d.end) : null,
    timeMs: closed ? int(d.timeMs, 0, 1e9) : null,
    clues: opened.length,
    opened,
    out: Array.isArray(d.out) ? [...new Set(d.out.filter((x) => SUS_IDS.includes(x)))] : [],
    hints: int(d.hints, 0, 2),
    wrong: int(d.wrong, 0, 99),
    pts: closed ? int(d.pts, 0, 100) : null,
    culprit: SUS_IDS.includes(d.culprit) ? d.culprit : '',
    motiveOk: closed && typeof d.motiveOk === 'boolean' ? d.motiveOk : null,
    methodOk: closed && typeof d.methodOk === 'boolean' ? d.methodOk : null
  };
}


export { clean };
