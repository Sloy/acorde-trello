import { h, render } from '../vendor/preact.mjs';
import { useState, useEffect, useRef, useMemo, useCallback } from '../vendor/hooks.mjs';
import htm from '../vendor/htm.mjs';
import { APP_KEY, APP_NAME, APP_AUTHOR, HIDDEN_LISTS } from './config.js?v=3';
import { createApi } from './api.js?v=3';
import { buildModel, computeRange, formatItemName, phaseById, PHASES, WEEK, DAY } from './model.js?v=3';

const html = htm.bind(h);

const LABEL = 300;
const ZMIN = 14, ZMAX = 140, ZDEF = 56;
const LANE_H = 26, BAR_H = 22, ITEM_H = 36, PROJ_H = 48;
const MES = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sept', 'oct', 'nov', 'dic'];
const MESL = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
const LADDER = ['transparent', '#216e4e', '#5b7f24', '#946f00', '#c25100', '#c9372c'];
const EASE = 'cubic-bezier(.2,.7,.2,1)';
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

const fmt = (ms) => { const d = new Date(ms); return d.getUTCDate() + ' ' + MES[d.getUTCMonth()]; };
const fmtY = (ms) => fmt(ms) + ' ' + new Date(ms).getUTCFullYear();
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const stripes = (c) => 'repeating-linear-gradient(135deg, ' + c + ' 0 8px, ' + c + '99 8px 16px)';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// ---------------------------------------------------------------- arranque
async function boot() {
  if (!document.documentElement.getAttribute('data-color-mode')) {
    document.documentElement.setAttribute('data-color-mode', matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  }
  const root = document.getElementById('app');
  const params = new URLSearchParams(location.search);
  const framed = window.parent !== window;

  if (params.has('demo')) {
    const board = await fetch('./test/fixture.json').then((r) => r.json());
    render(html`<${App} source=${demoSource(board)} />`, root);
    return;
  }
  // Vuelta de una autorización antigua a esta misma página: entregar el token y cerrar.
  if (!framed && /(^|&)token=/.test(location.hash.slice(1))) {
    const tok = new URLSearchParams(location.hash.slice(1)).get('token');
    history.replaceState(null, '', location.pathname);
    try { window.opener && window.opener.postMessage({ type: 'acorde-token', token: tok }, location.origin); } catch (e) {}
    render(html`<div class="center"><h1>Listo</h1><p>Acceso autorizado. Cierra esta ventana.</p></div>`, root);
    setTimeout(() => window.close(), 800);
    return;
  }
  if (!framed || !window.TrelloPowerUp) {
    render(html`<div class="center"><h1>Ábrelo desde Trello</h1><p>El cronograma se abre con el botón «Cronograma» del tablero. Para ver la demo con datos de ejemplo, añade <code>?demo</code> a la URL.</p></div>`, root);
    return;
  }

  const t = window.TrelloPowerUp.iframe({ appKey: APP_KEY, appName: APP_NAME, appAuthor: APP_AUTHOR });
  const boardId = t.getContext().board;
  let token = await t.get('member', 'private', 'token').catch(() => null);
  if (token && !(await tokenWorks(token))) token = null;

  const start = (tok) => {
    const api = createApi(tok);
    const source = {
      load: () => api.loadBoard(boardId),
      api,
      close: () => t.closeModal()
    };
    render(html`<${App} source=${source} />`, root);
  };

  if (token) return start(token);
  render(html`<${AuthScreen} onAuthorize=${async () => {
    const tok = await authorizePopup();
    await t.set('member', 'private', 'token', tok).catch(() => {});
    start(tok);
  }} />`, root);
}

async function tokenWorks(token) {
  try {
    const r = await fetch('https://api.trello.com/1/members/me?fields=id&key=' + APP_KEY + '&token=' + encodeURIComponent(token));
    return r.ok;
  } catch (e) { return true; } // sin red: no lo descartamos
}

// Autorización propia: abre la pantalla de Trello y recibe el token desde auth.html (misma web).
function authorizePopup() {
  const returnUrl = new URL('./auth.html', location.href).href;
  const url = 'https://trello.com/1/authorize?' + new URLSearchParams({
    expiration: 'never', name: APP_NAME, scope: 'read,write', response_type: 'token',
    key: APP_KEY, callback_method: 'fragment', return_url: returnUrl
  });
  return new Promise((resolve, reject) => {
    const popup = window.open(url, 'acorde-auth', 'width=580,height=720');
    if (!popup) return reject(new Error('el navegador ha bloqueado la ventana emergente'));
    let done = false;
    const finish = (fn, v) => { if (done) return; done = true; window.removeEventListener('message', onMsg); clearInterval(timer); fn(v); };
    const onMsg = (ev) => {
      if (ev.origin !== location.origin || !ev.data || ev.data.type !== 'acorde-token') return;
      if (ev.data.token) finish(resolve, ev.data.token); else finish(reject, new Error('acceso denegado'));
    };
    window.addEventListener('message', onMsg);
    const timer = setInterval(() => {
      let closed = false;
      try { closed = popup.closed; } catch (e) { /* sin acceso */ }
      if (closed) setTimeout(() => finish(reject, new Error('se cerró la ventana sin completar la autorización')), 500);
    }, 500);
  });
}

// Modo demo (fuera de Trello): mismos datos, escrituras en memoria.
function demoSource(board) {
  let seq = 0;
  const findItem = (id) => {
    for (const c of board.cards) for (const cl of c.checklists || []) {
      const i = (cl.checkItems || []).findIndex((x) => x.id === id);
      if (i >= 0) return { card: c, cl, i };
    }
    return null;
  };
  const api = {
    async updateItem(cardId, itemId, f) {
      const r = findItem(itemId); if (!r) return;
      const it = r.cl.checkItems[r.i];
      if (f.name != null) it.name = f.name;
      if (f.state) it.state = f.state;
      if (f.idChecklist && f.idChecklist !== r.cl.id) {
        r.cl.checkItems.splice(r.i, 1);
        r.card.checklists.find((c) => c.id === f.idChecklist).checkItems.push(it);
      }
    },
    async addItem(checklistId, name) {
      const it = { id: 'demo' + (++seq), name, state: 'incomplete', pos: Date.now() };
      for (const c of board.cards) for (const cl of c.checklists || []) if (cl.id === checklistId) cl.checkItems.push(it);
      return it;
    },
    async deleteItem(cardId, itemId) { const r = findItem(itemId); if (r) r.cl.checkItems.splice(r.i, 1); },
    async createChecklist(cardId, name) {
      const cl = { id: 'demoCl' + (++seq), name, pos: Date.now(), checkItems: [] };
      board.cards.find((c) => c.id === cardId).checklists.push(cl);
      return cl;
    }
  };
  return { load: async () => JSON.parse(JSON.stringify(board)), api, demo: true };
}

function AuthScreen({ onAuthorize }) {
  const [err, setErr] = useState('');
  return html`<div class="center">
    <h1>Cronograma de Acorde</h1>
    <p>Para leer y modificar las fechas de los checklists, autoriza el acceso a tu cuenta de Trello. Solo hay que hacerlo una vez.</p>
    <button class="primary" onClick=${() => onAuthorize().catch((e) => setErr('No se pudo autorizar: ' + e.message))}>Autorizar acceso</button>
    ${err && html`<p class="error">${err}</p>`}
  </div>`;
}

// ---------------------------------------------------------------- app
function App({ source }) {
  const [model, setModel] = useState(null);
  const [error, setError] = useState('');
  const [toast, setToast] = useState(null);
  const [zoom, setZoom] = useState(ZDEF);
  const [zooming, setZooming] = useState(false);
  const [hidden, setHidden] = useState({});
  const [open, setOpen] = useState({});
  const [sel, setSel] = useState(null);
  const [editing, setEditing] = useState(null); // { pid, iid, isNew, snapshot }
  const [addMode, setAddMode] = useState(false);
  const [hover, setHover] = useState(null);
  const [panning, setPanning] = useState(false);

  const scroller = useRef(null);
  const drag = useRef(null);
  const pan = useRef(null);
  const zoomRef = useRef(zoom); zoomRef.current = zoom;
  const zt = useRef(null);
  const scrolledToday = useRef(false);

  const today = Date.now();
  const range = useMemo(() => model ? computeRange(model, today) : null, [model]);
  const rangeRef = useRef(range); rangeRef.current = range;

  const reload = useCallback(async () => {
    try {
      const board = await source.load();
      setModel(buildModel(board));
      setError('');
    } catch (e) { setError(e.message || String(e)); }
  }, [source]);

  useEffect(() => { reload(); }, [reload]);

  const notify = (text, kind) => {
    setToast({ text, kind: kind || 'ok' });
    clearTimeout(notify._t);
    notify._t = setTimeout(() => setToast(null), kind === 'error' ? 6000 : 1800);
  };
  const persist = async (fn, okText) => {
    try { await fn(); if (okText) notify(okText); }
    catch (e) { notify('No se pudo guardar en Trello. Recargando… (' + (e.message || e) + ')', 'error'); reload(); }
  };

  // ---------- modelo: helpers inmutables
  const findP = (m, pid) => { for (const g of m.groups) for (const p of g.projects) if (p.id === pid) return p; return null; };
  const findI = (m, pid, iid) => { const p = findP(m, pid); return p ? p.items.find((i) => i.id === iid) : null; };
  const patchItem = (pid, iid, patch) => setModel((m) => ({
    ...m, groups: m.groups.map((g) => ({ ...g, projects: g.projects.map((p) => p.id !== pid ? p : { ...p, items: p.items.map((i) => i.id !== iid ? i : { ...i, ...patch }) }) }))
  }));
  const mapProject = (pid, fn) => setModel((m) => ({ ...m, groups: m.groups.map((g) => ({ ...g, projects: g.projects.map((p) => p.id !== pid ? p : fn(p)) })) }));

  const r0 = range ? range.r0 : 0;
  const N = range ? range.weeks : 1;
  const toIdx = (ms) => Math.round((ms - r0) / WEEK);
  const toMs = (idx) => r0 + idx * WEEK;

  // Guarda en Trello el nombre (con fechas) de una tarea existente.
  const saveDates = (item) => persist(() => source.api.updateItem(item.cardId, item.id, { name: formatItemName(item.name, item.start, item.end) }), 'Fechas guardadas');

  // ---------- arrastre de barras y desplazamiento con ratón
  useEffect(() => {
    const mv = (ev) => {
      const pn = pan.current;
      if (pn && scroller.current) {
        scroller.current.scrollLeft = pn.sl - (ev.clientX - pn.x);
        scroller.current.scrollTop = pn.st - (ev.clientY - pn.y);
        return;
      }
      const d = drag.current;
      if (!d) return;
      const dw = Math.round((ev.clientX - d.x) / zoomRef.current);
      if (dw === d.last) return;
      d.last = dw;
      const n = rangeRef.current.weeks;
      let s = d.s, e = d.e;
      if (d.mode === 'move') { s += dw; e += dw; if (s < 0) { e -= s; s = 0; } if (e > n - 1) { const o = e - (n - 1); e -= o; s -= o; } }
      else if (d.mode === 'l') s = clamp(d.s + dw, 0, d.e);
      else e = clamp(d.e + dw, d.s, n - 1);
      d.moved = true;
      patchItem(d.pid, d.iid, { start: rangeRef.current.r0 + s * WEEK, end: rangeRef.current.r0 + e * WEEK });
    };
    const up = () => {
      if (pan.current) { pan.current = null; setPanning(false); }
      const d = drag.current;
      drag.current = null;
      if (d && d.moved) {
        setModel((m) => { const it = findI(m, d.pid, d.iid); if (it && !String(it.id).startsWith('tmp')) saveDates(it); return m; });
      }
    };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
    return () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
  }, []);

  // ---------- zoom (botones, pellizco, ctrl+rueda) y desplazamiento libre
  const zoomTo = useCallback((target, anchorX, continuous) => {
    const sc = scroller.current;
    const old = zoomRef.current;
    const z = clamp(target, ZMIN, ZMAX);
    if (Math.abs(z - old) < 0.01) return;
    let x = LABEL;
    if (sc) x = clamp(anchorX == null ? LABEL + (sc.clientWidth - LABEL) / 2 : anchorX, LABEL, sc.clientWidth);
    const at = sc ? (sc.scrollLeft + x - LABEL) / old : 0;
    if (continuous) { setZooming(true); clearTimeout(zt.current); zt.current = setTimeout(() => setZooming(false), 160); }
    zoomRef.current = z;
    setZoom(z);
    requestAnimationFrame(() => { if (sc) sc.scrollLeft = at * z + LABEL - x; });
  }, []);

  useEffect(() => {
    const sc = scroller.current;
    if (!sc) return;
    const wheel = (ev) => {
      const k = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? sc.clientHeight : 1;
      ev.preventDefault();
      if (ev.ctrlKey || ev.metaKey) {
        const rect = sc.getBoundingClientRect();
        zoomTo(zoomRef.current * Math.exp(-ev.deltaY * k * 0.01), ev.clientX - rect.left, true);
        return;
      }
      let dx = ev.deltaX * k, dy = ev.deltaY * k;
      if (ev.shiftKey && !dx) { dx = dy; dy = 0; }
      sc.scrollLeft += dx; sc.scrollTop += dy;
    };
    let gz = null;
    const gs = (ev) => { ev.preventDefault(); gz = zoomRef.current; };
    const gc = (ev) => { ev.preventDefault(); const rect = sc.getBoundingClientRect(); zoomTo((gz || zoomRef.current) * ev.scale, ev.clientX - rect.left, true); };
    sc.addEventListener('wheel', wheel, { passive: false });
    sc.addEventListener('gesturestart', gs, { passive: false });
    sc.addEventListener('gesturechange', gc, { passive: false });
    return () => { sc.removeEventListener('wheel', wheel); sc.removeEventListener('gesturestart', gs); sc.removeEventListener('gesturechange', gc); };
  }, [model != null]);

  useEffect(() => {
    if (range && scroller.current && !scrolledToday.current) {
      scrolledToday.current = true;
      scroller.current.scrollLeft = Math.max(0, (range.todayIdx - 6) * zoom);
    }
  }, [range]);

  if (error && !model) return html`<div class="center"><h1>No se pudo cargar el tablero</h1><p class="error">${error}</p><button onClick=${reload}>Reintentar</button></div>`;
  if (!model || !range) return html`<div class="center"><p>Cargando tablero…</p></div>`;

  // ---------- acciones
  const startDrag = (ev, p, it, mode, qIdx) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    ev.preventDefault(); ev.stopPropagation();
    let s = it.start == null ? qIdx : toIdx(it.start);
    let e = it.start == null ? qIdx : toIdx(it.end);
    drag.current = { pid: p.id, iid: it.id, mode: it.start == null ? 'move' : mode, x: ev.clientX, s, e, last: 0, moved: false };
    const same = sel && sel.pid === p.id && sel.iid === it.id;
    if (!same) { setSel({ pid: p.id, iid: it.id }); if (editing) closePanel(); }
    setHover(null);
  };
  const keyMove = (ev, p, it, qIdx) => {
    if (ev.key === 'Escape') { setSel(null); return; }
    if (ev.key === 'Enter') { openPanel(p.id, it.id); return; }
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    ev.preventDefault();
    const d = ev.key === 'ArrowLeft' ? -1 : 1;
    let s = it.start == null ? qIdx : toIdx(it.start), e = it.start == null ? qIdx : toIdx(it.end);
    if (ev.shiftKey) e = clamp(e + d, s, N - 1); else { s = clamp(s + d, 0, N - 1 - (e - s)); e = s + (toIdx(it.end ?? toMs(qIdx)) - toIdx(it.start ?? toMs(qIdx))); }
    const next = { ...it, start: toMs(s), end: toMs(e) };
    patchItem(p.id, it.id, { start: next.start, end: next.end });
    setSel({ pid: p.id, iid: it.id });
    if (!String(it.id).startsWith('tmp')) saveDates(next);
  };

  const openPanel = (pid, iid) => {
    const it = findI(model, pid, iid);
    if (!it) return;
    setSel({ pid, iid });
    setEditing({ pid, iid, isNew: false, snapshot: { ...it } });
  };
  const closePanel = () => {
    if (!editing) return;
    if (editing.isNew) mapProject(editing.pid, (p) => ({ ...p, items: p.items.filter((i) => i.id !== editing.iid) }));
    else if (editing.snapshot) patchItem(editing.pid, editing.iid, editing.snapshot);
    setEditing(null);
  };

  const ensureChecklist = async (p, phId) => {
    const existing = p.checklists.find((c) => c.ph === phId);
    if (existing) return existing.id;
    const cl = await source.api.createChecklist(p.id, phaseById(phId).name);
    mapProject(p.id, (pp) => ({ ...pp, checklists: pp.checklists.concat([{ id: cl.id, name: cl.name, ph: phId }]) }));
    return cl.id;
  };

  const savePanel = async () => {
    if (!editing) return;
    const p = findP(model, editing.pid);
    const it = findI(model, editing.pid, editing.iid);
    const { isNew, snapshot } = editing;
    setEditing(null);
    if (!p || !it) return;
    const name = formatItemName(it.name, it.start, it.end);
    await persist(async () => {
      if (isNew) {
        const clId = await ensureChecklist(p, it.ph);
        const created = await source.api.addItem(clId, name);
        patchItem(p.id, it.id, { id: created.id, checklistId: clId, cardId: p.id });
        setSel({ pid: p.id, iid: created.id });
      } else {
        const fields = { name };
        if (snapshot && snapshot.ph !== it.ph) {
          const clId = await ensureChecklist(p, it.ph);
          fields.idChecklist = clId;
          patchItem(p.id, it.id, { checklistId: clId });
        }
        await source.api.updateItem(p.id, it.id, fields);
      }
    }, isNew ? 'Tarea creada' : 'Guardado');
  };

  const toggleDone = (p, it) => {
    patchItem(p.id, it.id, { done: !it.done });
    if (editing && editing.snapshot) setEditing({ ...editing, snapshot: { ...editing.snapshot, done: !it.done } });
    if (!String(it.id).startsWith('tmp')) persist(() => source.api.updateItem(p.id, it.id, { state: it.done ? 'incomplete' : 'complete' }));
  };
  const deleteItem = (p, it) => {
    mapProject(p.id, (pp) => ({ ...pp, items: pp.items.filter((i) => i.id !== it.id) }));
    setEditing(null); setSel(null);
    if (!String(it.id).startsWith('tmp')) persist(() => source.api.deleteItem(p.id, it.id), 'Tarea eliminada');
  };
  const addItemAt = (p, w) => {
    const pending = p.items.filter((i) => !i.done && i.start != null);
    const ph = pending.length ? pending[pending.length - 1].ph : (p.items.length ? p.items[p.items.length - 1].ph : 'bas');
    const id = 'tmp' + Date.now();
    const it = { id, cardId: p.id, checklistId: null, ph, name: 'Nueva tarea', start: toMs(w), end: toMs(w), done: false };
    mapProject(p.id, (pp) => ({ ...pp, items: pp.items.concat([it]) }));
    setAddMode(false); setHover(null);
    setSel({ pid: p.id, iid: id });
    setEditing({ pid: p.id, iid: id, isNew: true, snapshot: null });
  };

  // ---------- render
  const colW = zoom;
  const gridW = N * colW;
  const todayW = Math.floor(range.todayIdx);
  const anim = !zooming;
  const trLW = anim ? `left 220ms ${EASE}, width 220ms ${EASE}` : 'none';
  const trBar = anim ? `left 180ms ${EASE}, width 180ms ${EASE}, top 220ms ${EASE}, opacity 180ms ease` : 'opacity 180ms ease';
  const dayEvery = colW < 22 ? 4 : colW < 30 ? 2 : 1;

  const weeks = [], months = [];
  for (let i = 0; i < N; i++) {
    const d = new Date(toMs(i));
    weeks.push({ i, day: d.getUTCDate(), cur: i === todayW, show: i === todayW || i % dayEvery === 0 });
    const mi = d.getUTCMonth(), last = months[months.length - 1];
    if (!last || last.mi !== mi) months.push({ mi, name: (colW < 32 ? MES[mi] : MESL[mi]) + (mi === 0 || months.length === 0 ? ' ' + d.getUTCFullYear() : ''), left: i * colW, width: colW });
    else last.width += colW;
  }

  const visibleGroups = model.groups.filter((g) => !HIDDEN_LISTS.some((re) => re.test(g.name)));
  const typeKey = (p) => p.type || '';
  const visProjects = visibleGroups.flatMap((g) => g.projects).filter((p) => !hidden[typeKey(p)]);

  const load = [];
  for (let i = 0; i < N; i++) {
    let n = 0;
    for (const p of visProjects) for (const it of p.items) if (!it.done && it.start != null && toIdx(it.start) <= i && i <= toIdx(it.end)) n++;
    load.push(n);
  }

  const layout = (p) => {
    const dated = p.items.filter((i) => i.start != null).map((i) => ({ it: i, a: toIdx(i.start), b: toIdx(i.end) })).sort((x, y) => x.a - y.a);
    const laneEnd = [], placed = [];
    for (const d of dated) {
      let ln = laneEnd.findIndex((le) => le < d.a);
      if (ln < 0) { ln = laneEnd.length; laneEnd.push(-1); }
      laneEnd[ln] = d.b; placed.push({ it: d.it, lane: ln, a: d.a, b: d.b });
    }
    const anchor = laneEnd.length ? Math.max(...laneEnd) + 1 : todayW;
    const qIdx = {};
    p.items.filter((i) => i.start == null).forEach((i, k) => { qIdx[i.id] = Math.min(N - 1, anchor + k); placed.push({ it: i, lane: 0, a: qIdx[i.id], b: qIdx[i.id] }); });
    return { placed, lanes: Math.max(1, laneEnd.length), qIdx, dated };
  };

  const trackHandlers = (key, p) => ({
    onMouseMove: (ev) => {
      if (drag.current || pan.current || !addMode) return;
      const rect = ev.currentTarget.getBoundingClientRect();
      const w = clamp(Math.floor((ev.clientX - rect.left) / zoomRef.current), 0, N - 1);
      if (!hover || hover.key !== key || hover.w !== w) setHover({ key, w });
    },
    onMouseLeave: () => { if (hover && hover.key === key) setHover(null); },
    onPointerDown: (ev) => {
      if (addMode || ev.pointerType !== 'mouse' || ev.button !== 0 || !scroller.current) return;
      if (ev.target.closest && ev.target.closest('button')) return;
      ev.preventDefault();
      pan.current = { x: ev.clientX, y: ev.clientY, sl: scroller.current.scrollLeft, st: scroller.current.scrollTop };
      setPanning(true);
    },
    style: `cursor:${addMode ? 'copy' : panning ? 'grabbing' : 'grab'}; background-size:${colW}px 100%; width:${gridW}px; transition:${anim ? `background-size 220ms ${EASE}, width 220ms ${EASE}` : 'none'}`
  });
  const ghost = (key, p, top) => (addMode && hover && hover.key === key)
    ? html`<button class="ghost" aria-label=${'Añadir tarea la semana del ' + fmt(toMs(hover.w))} onClick=${() => addItemAt(p, hover.w)}
        style=${`top:${top}px; left:${hover.w * colW + 2}px; width:${Math.max(16, colW - 4)}px`}>${Plus(12)}</button>`
    : null;

  const Bar = (p, it, top, qIdx) => {
    const ph = phaseById(it.ph);
    const isQ = it.start == null;
    const s = isQ ? qIdx : toIdx(it.start), e = isQ ? qIdx : toIdx(it.end);
    const isSel = !!sel && sel.pid === p.id && sel.iid === it.id;
    let bg = ph.color, fg = '#fff', border = 'none';
    if (isQ) { bg = 'transparent'; fg = 'var(--text)'; border = '1px dashed var(--q-border)'; }
    else if (it.done) { bg = 'var(--done-bg)'; fg = 'var(--done-fg)'; }
    else if (s > todayW) bg = stripes(ph.color);
    const left = s * colW + 2, width = Math.max(8, (e - s + 1) * colW - 4);
    const dates = isQ ? 'Sin fecha' : fmtY(it.start) + ' → ' + fmtY(it.end + 4 * DAY);
    return html`
      <button key=${it.id} class="bar" aria-label=${p.name + ' — ' + it.name + ' (' + ph.name + '). ' + dates}
        onPointerDown=${(ev) => startDrag(ev, p, it, 'move', qIdx)} onDblClick=${() => openPanel(p.id, it.id)} onKeyDown=${(ev) => keyMove(ev, p, it, qIdx)}
        style=${`top:${top}px; left:${left}px; width:${width}px; background:${bg}; color:${fg}; border:${border}; line-height:${isQ ? BAR_H - 2 : BAR_H}px; box-shadow:${isSel ? '0 0 0 2px var(--sel-ring)' : 'none'}; text-decoration:${it.done ? 'line-through' : 'none'}; transition:${trBar}`}>
        ${!isQ && html`<span class="handle l" onPointerDown=${(ev) => startDrag(ev, p, it, 'l', qIdx)}></span><span class="handle r" onPointerDown=${(ev) => startDrag(ev, p, it, 'r', qIdx)}></span>`}
        ${(isQ ? '? ' : '') + it.name}
      </button>
      ${isSel && html`<button key=${it.id + '-edit'} class="editbtn" aria-label="Editar tarea" onClick=${() => openPanel(p.id, it.id)}
        style=${`top:${top}px; left:${left + width + 4}px; transition:${trBar}`}>${Dots()}</button>`}`;
  };

  const Project = (p) => {
    const L = layout(p);
    const isOpen = !!open[p.id];
    const doneN = p.items.filter((i) => i.done).length;
    const qN = p.items.filter((i) => i.start == null).length;
    const collapsedH = Math.max(PROJ_H, 10 + L.lanes * LANE_H);
    const projH = isOpen ? PROJ_H : collapsedH;
    const off = L.lanes === 1 ? (collapsedH - 24) / 2 : 6;
    const idx = {}; p.items.forEach((it, k) => { idx[it.id] = k; });
    const keyP = 'p:' + p.id;
    let sum = null;
    if (L.dated.length) {
      const a = Math.min(...L.dated.map((d) => d.a)), b = Math.max(...L.dated.map((d) => d.b));
      sum = { left: a * colW + 2, width: (b - a + 1) * colW - 4 };
    }
    const th = trackHandlers(keyP, p);
    return html`<div class="project" key=${p.id}>
      <div class="row" style=${`height:${projH}px; border-top-width:1px`}>
        <button class="label proj" aria-expanded=${isOpen} onClick=${() => setOpen({ ...open, [p.id]: !isOpen })}>
          <svg class="chev" style=${`transform:rotate(${isOpen ? 90 : 0}deg)`} width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><polyline points="9 6 15 12 9 18"/></svg>
          <span class="pname">
            <span class="ptitle">${p.name}${p.review ? html` <span class="review">revisar</span>` : ''}</span>
            <span class="pmeta">
              <span>${p.type || 'Sin tipo'}</span>
              ${p.items.length > 0 && html`<span>${doneN}/${p.items.length}</span>`}
              ${qN > 0 && html`<span class="dashed">${qN} sin fecha</span>`}
            </span>
          </span>
        </button>
        <div class="track" ...${th}>
          ${ghost(keyP, p, isOpen ? 13 : off)}
          ${sum && html`<div class="sum" style=${`left:${sum.left}px; width:${sum.width}px; opacity:${isOpen ? 1 : 0}; transition:${trBar}`}></div>`}
        </div>
      </div>
      ${p.items.map((it) => {
        const keyI = 'i:' + it.id;
        const thi = trackHandlers(keyI, p);
        const isSel = !!sel && sel.pid === p.id && sel.iid === it.id;
        return html`<div class="row item" key=${it.id} style=${`height:${isOpen ? ITEM_H : 0}px; border-top-width:${isOpen ? 1 : 0}px; visibility:${isOpen ? 'visible' : 'hidden'}; transition:height 220ms ${EASE}${isOpen ? '' : ', visibility 0s linear 220ms'}`}>
          <button class="label itemlabel" style=${`background:${isSel ? 'var(--item-sel)' : 'var(--item-bg)'}`} onClick=${() => openPanel(p.id, it.id)}>
            ${it.done ? CheckOn() : CheckOff()}
            <span class="dot" style=${`background:${it.done ? 'var(--done-bg)' : phaseById(it.ph).color}`}></span>
            <span class="iname" style=${`color:${it.done ? 'var(--muted)' : 'var(--text)'}`}>${it.name}</span>
            <span class="idate">${it.start == null ? '?' : fmt(it.start) + ' – ' + fmt(it.end + 4 * DAY)}</span>
          </button>
          <div class="track" ...${thi}>${ghost(keyI, p, 7)}</div>
        </div>`;
      })}
      <div class="barlayer" style=${`width:${gridW}px`}>
        ${L.placed.map((pl) => Bar(p, pl.it, isOpen ? PROJ_H + 1 + idx[pl.it.id] * (ITEM_H + 1) + 8 : 1 + off + pl.lane * LANE_H, L.qIdx[pl.it.id]))}
      </div>
    </div>`;
  };

  const anyOpen = visProjects.some((p) => open[p.id]);
  const types = model.types.concat(['']);

  // panel
  let panel = null;
  if (editing) {
    const p = findP(model, editing.pid);
    const it = p && findI(model, editing.pid, editing.iid);
    if (p && it) {
      const ph = phaseById(it.ph);
      const onKey = (ev) => {
        if (ev.key === 'Enter' && (ev.metaKey || ev.ctrlKey)) { ev.preventDefault(); savePanel(); }
        else if (ev.key === 'Escape') { ev.preventDefault(); closePanel(); }
      };
      const setDate = (which, v) => {
        if (!v) return;
        const parts = v.split('-').map(Number);
        const w = clamp(toIdx(Date.UTC(parts[0], parts[1] - 1, parts[2]) - ((new Date(Date.UTC(parts[0], parts[1] - 1, parts[2])).getUTCDay() + 6) % 7) * DAY), 0, N - 1);
        if (it.start == null) patchItem(p.id, it.id, { start: toMs(w), end: toMs(w) });
        else if (which === 's') patchItem(p.id, it.id, { start: toMs(Math.min(w, toIdx(it.end))) });
        else patchItem(p.id, it.id, { end: toMs(Math.max(w, toIdx(it.start))) });
      };
      panel = html`<section class="panel" aria-label="Detalle de la tarea" onKeyDown=${onKey}>
        <div class="phead">
          <div class="pinfo"><span>${p.name}</span><span><i class="dot" style=${`background:${ph.color}`}></i>${ph.name}</span></div>
          <button class="icon" aria-label="Cerrar" onClick=${closePanel}>${Close()}</button>
        </div>
        <label>Tarea<input class="field big" type="text" value=${it.name} autoFocus=${editing.isNew} onInput=${(ev) => patchItem(p.id, it.id, { name: ev.target.value })} /></label>
        <div class="grid3">
          <label>Fase<select class="field" value=${it.ph} onChange=${(ev) => patchItem(p.id, it.id, { ph: ev.target.value })}>
            ${PHASES.map((o) => html`<option value=${o.id}>${o.name}</option>`)}
          </select></label>
          <label>Inicio<input class="field" type="date" value=${it.start == null ? '' : iso(it.start)} onChange=${(ev) => setDate('s', ev.target.value)} /></label>
          <label>Entrega<input class="field" type="date" value=${it.start == null ? '' : iso(it.end + 4 * DAY)} onChange=${(ev) => setDate('e', ev.target.value)} /></label>
        </div>
        ${it.start == null && html`<p class="hint">Sin fecha. Elige inicio o entrega, o arrastra el bloque «?» a su semana.</p>`}
        <div class="actions">
          ${!editing.isNew && html`<button class="secondary" onClick=${() => toggleDone(p, it)}>${it.done ? 'Marcar pendiente' : 'Marcar hecha'}</button>`}
          ${it.start != null && html`<button class="ghostbtn" onClick=${() => patchItem(p.id, it.id, { start: null, end: null })}>Quitar fechas</button>`}
          ${!editing.isNew && html`<button class="ghostbtn danger" onClick=${() => deleteItem(p, it)}>Eliminar</button>`}
          <span class="grow"></span>
          <button class="primary" onClick=${savePanel}>Guardar <kbd>${IS_MAC ? '⌘ Enter' : 'Ctrl Enter'}</kbd></button>
        </div>
      </section>`;
    }
  }

  return html`<div class="app">
    <div class="toolbar">
      ${source.demo && html`<span class="badge">Demo · cambios en memoria</span>`}
      <div class="filters" role="group" aria-label="Filtrar por tipo">
        ${types.map((k) => { const on = !hidden[k]; return html`<button class=${'chip' + (on ? ' on' : '')} aria-pressed=${on} onClick=${() => setHidden({ ...hidden, [k]: !hidden[k] })}>${on && Check()}${k || 'Sin tipo'}</button>`; })}
      </div>
      <span class="grow"></span>
      <button class=${addMode ? 'primary' : 'secondary'} aria-pressed=${addMode} onClick=${() => { setAddMode(!addMode); setHover(null); }}>${Plus(14)} ${addMode ? 'Elige semana… (cancelar)' : 'Añadir tarea'}</button>
      <button class="ghostbtn" onClick=${() => { const o = {}; if (!anyOpen) visProjects.forEach((p) => { o[p.id] = true; }); setOpen(o); }}>${anyOpen ? 'Contraer todo' : 'Expandir todo'}</button>
      <button class="ghostbtn" onClick=${reload} aria-label="Recargar del tablero">Recargar</button>
      <div class="zoom" role="group" aria-label="Zoom">
        <button class="icon" aria-label="Reducir" onClick=${() => zoomTo(zoom / 1.25)}>${Minus()}</button>
        <button class="icon pct" aria-label="Restablecer zoom" onClick=${() => zoomTo(ZDEF)}>${Math.round(zoom / ZDEF * 100)} %</button>
        <button class="icon" aria-label="Ampliar" onClick=${() => zoomTo(zoom * 1.25)}>${Plus(14)}</button>
      </div>
      ${source.close && html`<button class="icon" aria-label="Cerrar cronograma" onClick=${source.close}>${Close()}</button>`}
    </div>
    ${model.warnings.length > 0 && html`<div class="warn">${model.warnings.length} tarea(s) con fecha en formato no reconocido: ${model.warnings.slice(0, 3).map((w) => '«' + w.item + '»').join(', ')}${model.warnings.length > 3 ? '…' : ''}</div>`}
    <div class="scroller" ref=${scroller}>
      <div class="content" style=${`width:${LABEL + gridW}px; transition:${anim ? `width 220ms ${EASE}` : 'none'}`}>
        <div class="today" style=${`left:${LABEL + range.todayIdx * colW}px; transition:${anim ? `left 220ms ${EASE}` : 'none'}`}></div>
        <div class="head">
          <div class="headlabel"><span>Proyecto · tareas del checklist</span><span class="tiny">carga semanal</span></div>
          <div class="headgrid" style=${`width:${gridW}px`}>
            ${months.map((m) => html`<div class="month" style=${`left:${m.left}px; width:${m.width}px; transition:${trLW}`}>${m.name}</div>`)}
            ${weeks.map((w) => html`<div class="week" style=${`left:${w.i * colW}px; width:${colW}px; transition:${trLW}`}><span class=${w.cur ? 'cur' : ''} style=${`opacity:${w.show ? 1 : 0}`}>${w.day}</span></div>`)}
            ${load.map((n, i) => html`<div class="load" title=${n === 1 ? '1 tarea pendiente' : n + ' tareas pendientes'} style=${`left:${i * colW}px; width:${colW}px; transition:${trLW}`}><span style=${`height:${n ? Math.min(14, 2 + n * 2.5) : 0}px; background:${LADDER[Math.min(n, LADDER.length - 1)]}`}></span></div>`)}
          </div>
        </div>
        ${visibleGroups.map((g) => {
          const ps = g.projects.filter((p) => !hidden[typeKey(p)]);
          if (!ps.length) return null;
          return html`<div key=${g.id}>
            <div class="grouprow"><div class="grouplabel"><span>${g.name}</span><span class="muted">${ps.length}</span></div><div style=${`width:${gridW}px`}></div></div>
            ${ps.map(Project)}
          </div>`;
        })}
        <div style="height:220px"></div>
      </div>
    </div>
    <div class="legend">
      ${PHASES.map((p) => html`<span><i style=${`background:${p.color}`}></i>${p.name}</span>`)}
      <span class="sep"></span>
      <span><i style="background:repeating-linear-gradient(135deg,#738496 0 6px,#73849680 6px 12px)"></i>Prevista</span>
      <span><i style="background:var(--done-bg)"></i>Hecha</span>
      <span><i style="border:1px dashed var(--q-border)"></i>Sin fecha</span>
      <span><i class="todaymark"></i>Hoy</span>
    </div>
    ${panel}
    ${toast && html`<div class=${'toast ' + toast.kind} role="status">${toast.text}</div>`}
  </div>`;
}

// ---------------------------------------------------------------- iconos
const svg = (size, children, extra) => html`<svg aria-hidden="true" width=${size} height=${size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" ...${extra || {}}>${children}</svg>`;
const Plus = (s) => svg(s, html`<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>`);
const Minus = () => svg(14, html`<line x1="5" y1="12" x2="19" y2="12"/>`);
const Close = () => svg(16, html`<line x1="6" y1="6" x2="18" y2="18"/><line x1="18" y1="6" x2="6" y2="18"/>`);
const Check = () => svg(11, html`<polyline points="5 12 10 17 19 7"/>`, { 'stroke-width': 3 });
const Dots = () => html`<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="19" cy="12" r="2"/></svg>`;
const CheckOn = () => html`<svg role="img" aria-label="Hecha" width="14" height="14" viewBox="0 0 24 24"><rect x="2" y="2" width="20" height="20" rx="4" fill="var(--check-on)"/><polyline points="7 12 10.5 15.5 17 9" fill="none" stroke="var(--bg)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const CheckOff = () => html`<svg role="img" aria-label="Pendiente" width="14" height="14" viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4" fill="none" stroke="var(--check-off)" stroke-width="2.5"/></svg>`;

boot().catch((e) => {
  document.getElementById('app').innerHTML = '<div class="center"><h1>Error al iniciar</h1><p class="error"></p></div>';
  document.querySelector('.error').textContent = e.message || String(e);
});
