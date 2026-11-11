import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseItemName, formatItemName, buildModel, computeRange, mondayOf, WEEK, DAY } from '../js/model.js';

const U = (y, m, d) => Date.UTC(y, m - 1, d);
let r = parseItemName('Estudio de viabilidad · 9/11/26 → 20/11/26');
assert.equal(r.name, 'Estudio de viabilidad'); assert.equal(r.start, U(2026, 11, 9)); assert.equal(r.end, U(2026, 11, 20));
r = parseItemName('Informe · 26/10/2026 -> 30/10/2026'); assert.equal(r.start, U(2026, 10, 26)); assert.ok(r.parsed);
r = parseItemName('Visita · 3/12/26'); assert.equal(r.start, r.end);
r = parseItemName('Proyecto de reforma'); assert.equal(r.start, null); assert.ok(r.parsed);
r = parseItemName('Raro · 3 dic'); assert.equal(r.parsed, false);
r = parseItemName('Bloque A · 2-3 · 9/11/26 → 20/11/26'); assert.equal(r.name, 'Bloque A · 2-3');
// ida y vuelta
const s = mondayOf(U(2026, 11, 9)), e = mondayOf(U(2026, 11, 20));
assert.equal(formatItemName('Estudio', s, e), 'Estudio · 9/11/26 → 20/11/26');
assert.equal(formatItemName('Estudio', null, null), 'Estudio');
assert.equal(formatItemName('  ', s, s), 'Tarea · 9/11/26 → 13/11/26');
const back = parseItemName(formatItemName('X', s, e)); assert.equal(mondayOf(back.end), e);

const board = JSON.parse(readFileSync(new URL('./fixture.json', import.meta.url)));
const m = buildModel(board);
const doc = m.groups.find((g) => g.name === 'Documentación');
assert.equal(doc.projects.length, 7);
const sb = doc.projects.find((p) => p.name.startsWith('C/ Castaño'));
assert.equal(sb.review, true); assert.equal(sb.sub, 'Ejecución'); assert.equal(sb.type, 'Vivienda');
assert.deepEqual(sb.items.map((i) => i.ph), ['eje', 'eje', 'dir']);
assert.equal(sb.items[0].done, true); assert.equal(sb.items[2].start, null);
assert.equal(doc.projects.find((p) => p.name.startsWith('Pza. Mayor')).sub, 'Básico');
assert.equal(m.warnings.length, 0);
assert.ok(!m.groups.flatMap((g) => g.projects).some((p) => /^[✅⌛📏📐💬]/u.test(p.name)), 'separadores fuera');
assert.deepEqual(m.types.sort(), ['Apartamento turístico', 'Trámite / informe', 'Vivienda']);
const rg = computeRange(m, U(2026, 11, 11));
assert.equal(rg.r0, mondayOf(U(2026, 8, 3)));
assert.ok(rg.todayIdx > 14 && rg.todayIdx < 15);
console.log('OK: model', m.groups.map((g) => g.name + ':' + g.projects.length).join(', '), '| semanas', rg.weeks);
