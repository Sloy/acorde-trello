// Genera test/fixture.json (formato REST de Trello) con datos de ejemplo inventados.
import { writeFileSync } from 'node:fs';
let n = 0; const id = (p) => p + (++n);
const I = (name, done) => ({ id: id('it'), name, state: done ? 'complete' : 'incomplete', pos: n });
const CL = (name, items) => ({ id: id('cl'), name, pos: n, checkItems: items });
const L = (name, color) => ({ id: id('lb'), name, color });
const lists = [['bandeja', 'Bandeja de entrada 📫'], ['acep', 'Aceptado 🤝'], ['doc', 'Documentación 📝'], ['dir', 'Dirección 👷'], ['ent', 'Entregado ✅'], ['rech', 'Rechazado ❌']]
  .map(([i, name], k) => ({ id: i, name, pos: k + 1, closed: false }));
const cards = [];
const C = (idList, name, opts = {}) => cards.push({ id: id('card'), name, desc: opts.desc ?? (opts.sep ? '' : 'Carpeta en Drive'), idList, pos: cards.length + 1, closed: false, shortUrl: 'https://trello.com/c/demo', labels: opts.labels || [], checklists: opts.cl || [] });
const viv = L('Vivienda', 'blue'), vut = L('Apartamento turístico', 'orange'), tram = L('Trámite / informe', 'sky');
C('bandeja', '💬 Contacto inicial', { sep: true });
C('bandeja', 'Nave agrícola ❓');
C('acep', '✅ Por empezar', { sep: true });
C('acep', 'C/ Olmo 3, Villanorte ❓', { labels: [viv] });
C('acep', 'C/ Fresno 8, Puebla Alta ❓');
C('acep', '⌛ Esperando pago', { sep: true });
C('doc', '📏 Básico', { sep: true });
C('doc', 'C/ Acacia 12, Ciudad Ejemplo ❓', { labels: [vut], cl: [CL('Básico', [I('Estudio de viabilidad · 9/11/26 → 20/11/26')]), CL('Ejecución', [I('Proyecto de reforma')])] });
C('doc', 'C/ Río 5, Ciudad Ejemplo ❓', { labels: [vut], cl: [CL('Básico', [I('Estudio de viabilidad · 26/10/26 → 13/11/26')]), CL('Ejecución', [I('Proyecto de reforma')])] });
C('doc', 'Urb. Los Pinos 21, Costa Sur ❓', { labels: [vut], cl: [CL('Básico', [I('Documentación VUT · 26/10/26 → 20/11/26')])] });
C('doc', 'Pza. Mayor 2, Ciudad Ejemplo ❓', { cl: [CL('Básico', [I('Estudio de viabilidad · 28/9/26 → 9/10/26', 1), I('Nota técnica · 5/10/26 → 16/10/26', 1), I('Siguiente fase')])] });
C('doc', 'C/ Molino 9, Ciudad Ejemplo ❓', { cl: [CL('Básico', [I('Estudio de viabilidad · 17/8/26 → 23/10/26', 1), I('Siguiente fase')])] });
C('doc', '📐 Ejecución', { sep: true });
C('doc', 'C/ Castaño 14, Villanorte ❓', { labels: [viv], cl: [CL('Ejecución', [I('Proyecto de agregación · 12/10/26 → 23/10/26', 1), I('PByE reforma y ampliación · 19/10/26 → 18/12/26')]), CL('Dirección de obra', [I('Dirección de obra')])] });
C('doc', 'Camino Viejo 6, Valle Bajo ❓', { labels: [tram], cl: [CL('Ejecución', [I('Informe sectorial · 26/10/26 → 30/10/26', 1), I('Contestar requerimiento · 9/11/26 → 20/11/26')])] });
C('ent', 'C/ Jara 7, Ciudad Ejemplo ❓');
writeFileSync(new URL('./fixture.json', import.meta.url), JSON.stringify({ lists, cards }, null, 1));
console.log('fixture:', cards.length, 'tarjetas');
