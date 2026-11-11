// Conversión entre los datos del tablero de Trello y el modelo del cronograma.
// Sin dependencias del navegador: se puede probar con Node.

export const DAY = 86400000;
export const WEEK = 7 * DAY;

// Fases: se reconocen por el nombre del checklist de la tarjeta.
export const PHASES = [
  { id: 'pres', name: 'Presupuesto', color: '#4c6b1f', match: /presupuesto/i },
  { id: 'bas', name: 'Básico', color: '#7e3fa6', match: /b[aá]sico|viabilidad/i },
  { id: 'eje', name: 'Ejecución', color: '#943d73', match: /ejecuci[oó]n/i },
  { id: 'dir', name: 'Dirección de obra', color: '#0055cc', match: /direcci[oó]n/i }
];
export const OTHER_PHASE = { id: 'otra', name: 'Otra', color: '#626f86' };

export function phaseOf(checklistName) {
  return PHASES.find((p) => p.match.test(checklistName || '')) || OTHER_PHASE;
}
export function phaseById(id) {
  return PHASES.find((p) => p.id === id) || OTHER_PHASE;
}

// Etiquetas que no son tipo de encargo.
const NON_TYPE_LABELS = /falta pago/i;
const REVIEW_SUFFIX = /\s*❓\s*$/;

// ---------- fechas ----------
export function mondayOf(ms) {
  const d = new Date(ms);
  const day = (d.getUTCDay() + 6) % 7; // lunes = 0
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - day * DAY;
}
function parseDMY(d, m, y) {
  let yy = Number(y);
  if (yy < 100) yy += 2000;
  const ms = Date.UTC(yy, Number(m) - 1, Number(d));
  return isNaN(ms) ? null : ms;
}
function fmtDMY(ms) {
  const d = new Date(ms);
  return d.getUTCDate() + '/' + (d.getUTCMonth() + 1) + '/' + String(d.getUTCFullYear()).slice(2);
}

// "Nombre · 9/11/26 → 20/11/26"  |  "Nombre · 9/11/26"  |  "Nombre"
const RANGE_RE = /^(.*?)\s*·\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*(?:→|->|-)\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*$/;
const SINGLE_RE = /^(.*?)\s*·\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*$/;

export function parseItemName(raw) {
  const text = (raw || '').trim();
  let m = text.match(RANGE_RE);
  if (m) {
    const a = parseDMY(m[2], m[3], m[4]);
    const b = parseDMY(m[5], m[6], m[7]);
    if (a != null && b != null) return { name: m[1].trim(), start: Math.min(a, b), end: Math.max(a, b), parsed: true };
  }
  m = text.match(SINGLE_RE);
  if (m) {
    const a = parseDMY(m[2], m[3], m[4]);
    if (a != null) return { name: m[1].trim(), start: a, end: a, parsed: true };
  }
  // Tiene "·" y algo que parece fecha pero no se entiende: se avisa.
  const suspicious = /·\s*\d/.test(text);
  return { name: text, start: null, end: null, parsed: !suspicious };
}

// Semana (índice) -> texto que se guarda en Trello. Inicio = lunes, entrega = viernes.
export function formatItemName(name, startWeekMs, endWeekMs) {
  const clean = (name || '').trim() || 'Tarea';
  if (startWeekMs == null) return clean;
  return clean + ' · ' + fmtDMY(startWeekMs) + ' → ' + fmtDMY(endWeekMs + 4 * DAY);
}

// ---------- tablero ----------
function isSeparator(card) {
  const noLabels = !card.labels || card.labels.length === 0;
  const noChecklists = !card.checklists || card.checklists.length === 0;
  const noDesc = !(card.desc || '').trim();
  const startsWithSymbol = /^[^\p{L}\p{N}]/u.test(card.name || '');
  return noLabels && noChecklists && noDesc && startsWithSymbol;
}
function cleanSeparator(name) {
  return (name || '').replace(/^[^\p{L}\p{N}]+/u, '').trim();
}

// board: { lists:[{id,name,pos,closed}], cards:[{id,name,desc,idList,pos,closed,labels:[{id,name,color}],checklists:[{id,name,pos,checkItems:[{id,name,state,pos}]}]}] }
export function buildModel(board) {
  const lists = (board.lists || []).filter((l) => !l.closed).sort((a, b) => a.pos - b.pos);
  const cards = (board.cards || []).filter((c) => !c.closed).sort((a, b) => a.pos - b.pos);
  const types = new Map();
  const warnings = [];
  const groups = lists.map((l) => ({ id: l.id, name: l.name.replace(/[^\p{L}\p{N})]+$/u, '').trim(), projects: [] }));
  const byList = new Map(groups.map((g) => [g.id, g]));

  const subByList = new Map();
  for (const card of cards) {
    const g = byList.get(card.idList);
    if (!g) continue;
    if (isSeparator(card)) { subByList.set(card.idList, cleanSeparator(card.name)); continue; }
    const typeLabel = (card.labels || []).find((lb) => lb.name && !NON_TYPE_LABELS.test(lb.name));
    if (typeLabel) types.set(typeLabel.name, typeLabel.color);
    const flags = (card.labels || []).filter((lb) => NON_TYPE_LABELS.test(lb.name || '')).map((lb) => lb.name);
    const items = [];
    const checklists = (card.checklists || []).slice().sort((a, b) => a.pos - b.pos);
    for (const cl of checklists) {
      const ph = phaseOf(cl.name);
      for (const it of (cl.checkItems || []).slice().sort((a, b) => a.pos - b.pos)) {
        const p = parseItemName(it.name);
        if (!p.parsed) warnings.push({ cardId: card.id, card: card.name, item: it.name });
        items.push({
          id: it.id, checklistId: cl.id, cardId: card.id, ph: ph.id, name: p.name,
          start: p.start == null ? null : mondayOf(p.start),
          end: p.end == null ? null : mondayOf(p.end),
          done: it.state === 'complete', raw: it.name, pos: it.pos
        });
      }
    }
    g.projects.push({
      id: card.id, name: (card.name || '').replace(REVIEW_SUFFIX, ''), review: REVIEW_SUFFIX.test(card.name || ''),
      url: card.shortUrl || card.url, type: typeLabel ? typeLabel.name : '', flags, sub: subByList.get(card.idList) || '',
      checklists: checklists.map((cl) => ({ id: cl.id, name: cl.name, ph: phaseOf(cl.name).id })),
      items
    });
  }
  return { groups, types: Array.from(types.keys()), warnings };
}

// Rango visible: desde 2 semanas antes de la primera tarea hasta 26 semanas después de hoy (o 4 tras la última).
export function computeRange(model, todayMs) {
  const today = mondayOf(todayMs);
  let min = today - 8 * WEEK;
  let max = today + 26 * WEEK;
  for (const g of model.groups) for (const p of g.projects) for (const it of p.items) {
    if (it.start != null) { min = Math.min(min, it.start - 2 * WEEK); max = Math.max(max, it.end + 4 * WEEK); }
  }
  const r0 = mondayOf(min);
  const weeks = Math.round((mondayOf(max) - r0) / WEEK) + 1;
  return { r0, weeks, todayIdx: (todayMs - r0) / WEEK };
}
