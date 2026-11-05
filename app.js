"use strict";
/* PC Build Tracker - website edition. Settings live in config.js. */


/* ==========================================================================
   Constants & tiny helpers
   ========================================================================== */
const DATA_FILENAME = "pc_builds_data.json";
const LS_KEY = "pcbt.web.cache";      // localStorage copy of the PUBLIC data only (fast first paint)
const LS_UI = "pcbt.ui";              // UI-only state (tab, collapsed cards, last search)
const POLL_MS = 4000;
const SAVE_DEBOUNCE_MS = 400;
const DEFAULT_EXCLUDES = ["broken", "for parts", "read description", "box only", "faulty", "spares", "not working", "untested", "empty box", "damaged"];
const COND_LABEL = { used: "Used", refurbished: "Refurb", new: "New" };
const EBAY_COND_IDS = { new: ["1000"], refurbished: ["2000", "2010", "2020", "2030", "2500"], used: ["3000"] };
const REDUCED_MOTION = matchMedia("(prefers-reduced-motion: reduce)").matches;

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const nowIso = () => new Date().toISOString();
const ts = (iso) => Date.parse(iso) || 0;
const uid = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
function safeJson(text, fallback) { try { return JSON.parse(text) ?? fallback; } catch { return fallback; } }

const ICON = {
  chev: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/></svg>',
  tag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/></svg>',
  edit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  image: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/></svg>',
  cpu: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><rect x="5" y="5" width="14" height="14" rx="2"/><rect x="9" y="9" width="6" height="6"/><path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3"/></svg>',
  up: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 17 17 7M8 7h9v9"/></svg>',
  down: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 7 7 17M16 17H7V8"/></svg>',
  pot: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/></svg>',
  bag: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18M16 10a4 4 0 0 1-8 0"/></svg>',
};


/* ==========================================================================
   App state
   ========================================================================== */
const UI = Object.assign({ tab: "builds", collapsed: [], finder: null }, safeJson(localStorage.getItem(LS_UI), {}));
const APP = {
  data: null,             // everything on screen (public + private parts merged)
  snap: null,             // what the database holds - used to send only changes
  channel: null, live: undefined, loadedAt: 0, userEmail: "", locking: false,
  saveTimer: null, saving: false, saveQueued: false,
  filter: "all", query: "",
  collapsed: new Set(UI.collapsed),
  seenCards: new Set(),   // cards already on screen (only new ones animate in)
  saleBuildId: null,
  finder: { loading: false, result: null, error: "", params: null },
};
function saveUi() {
  UI.collapsed = [...APP.collapsed];
  try { localStorage.setItem(LS_UI, JSON.stringify(UI)); } catch { /* ignore */ }
}


/* ==========================================================================
   Data model (same shape as the old pc_builds_data.json, so old files import)
   --------------------------------------------------------------------------
   {
     app, version, updatedAt,
     settings:   { currency:"£", ebayFeePct, ebayFixedFee, split:{ enabled, reinvestPct } },
     builds:     [{ id, name, status, createdAt, updatedAt, items:[{id,description,cost,url?}],
                    totalCost, ebayUrl, notes,
                    sale:{ price, suggestedPrice, channel, feePct, feeFixed, fee, netProfit,
                           soldAt, source, needsReview, split:{reinvest, allowance, pots:[{potId,amount}]} } }],
     finance:    { bankBalance, bankUpdatedAt, allowanceAvailable, allowanceEarned, capitalReinvested },
     ledger:     [{ id, at, account:"allowance"|"capital"|"pot", potId?, amount (+in/−out),
                    kind:"sale-split"|"withdrawal"|"deposit"|"pot-withdraw"|"pot-closed", buildId?, groupId?, note }],
     pots:       [{ id, name, target, image, auto:{pct, source:"allowance"|"profit"}, balance, createdAt, updatedAt }],
     partFinder: { excludeKeywords:[], savedSearches:[{ id, name, q, max, conds, bin, exact }] },
     worker:     { lastRun, intervalMin, checks }        // written by the background worker only
   }
   ========================================================================== */
function emptyData() { return normalize({}); }

function normalize(d) {
  d = d && typeof d === "object" ? d : {};
  const s = d.settings || {};
  let currency = typeof s.currency === "string" && s.currency.trim() ? s.currency : "£";
  if (!s.currencyGbp && currency === "$") currency = "£";   // one-time switch of the old $ default to £
  const split = s.split || {};
  const f = d.finance || {};
  const pf = d.partFinder || {};
  return {
    ...d,
    app: "pc-build-tracker",
    version: 2,
    updatedAt: d.updatedAt || nowIso(),
    settings: {
      ...s,
      currency,
      currencyGbp: true,
      ebayFeePct: Number.isFinite(parseFloat(s.ebayFeePct)) ? parseFloat(s.ebayFeePct) : 13,
      ebayFixedFee: round2(num(s.ebayFixedFee)),
      split: { enabled: split.enabled ?? true, reinvestPct: clamp(Number.isFinite(parseFloat(split.reinvestPct)) ? parseFloat(split.reinvestPct) : 50, 0, 100) },
    },
    builds: Array.isArray(d.builds) ? d.builds.map(normBuild) : [],
    finance: { ...f, bankBalance: f.bankBalance == null || f.bankBalance === "" ? null : round2(num(f.bankBalance)), bankUpdatedAt: f.bankUpdatedAt || null },
    ledger: Array.isArray(d.ledger) ? d.ledger.filter((e) => e && typeof e === "object").map((e) => ({ ...e, id: e.id || uid("t"), at: e.at || nowIso(), amount: round2(num(e.amount)) })) : [],
    pots: Array.isArray(d.pots) ? d.pots.filter((p) => p && typeof p === "object").map((p) => ({
      ...p, id: p.id || uid("p"), name: p.name || "Savings pot", target: round2(num(p.target)), image: p.image || "",
      auto: { pct: clamp(num(p.auto?.pct), 0, 100), source: p.auto?.source === "profit" ? "profit" : "allowance" },
      createdAt: p.createdAt || nowIso(),
    })) : [],
    partFinder: {
      ...pf,
      excludeKeywords: Array.isArray(pf.excludeKeywords) ? pf.excludeKeywords.filter(Boolean) : [...DEFAULT_EXCLUDES],
      savedSearches: Array.isArray(pf.savedSearches) ? pf.savedSearches : [],
    },
    worker: d.worker && typeof d.worker === "object" ? d.worker : {},
  };
}

function normBuild(b) {
  b = b && typeof b === "object" ? b : {};
  const created = b.createdAt || nowIso();
  return {
    ...b,
    id: b.id || uid("b"),
    name: b.name ?? "",
    status: b.status === "sold" ? "sold" : "active",
    createdAt: created,
    updatedAt: b.updatedAt || created,
    items: Array.isArray(b.items) ? b.items.map((i) => ({ ...i, id: i.id || uid("i"), description: i.description ?? "", cost: num(i.cost) })) : [],
    ebayUrl: b.ebayUrl || "",
    notes: b.notes || "",
    sale: b.sale && typeof b.sale === "object" ? b.sale : null,
  };
}

/* ---------- Build maths ---------- */
const totalCost = (b) => round2(b.items.reduce((s, i) => s + num(i.cost), 0));
const hasPrice = (b) => b.status === "sold" && b.sale && b.sale.price != null && Number.isFinite(+b.sale.price);
const feeFor = (price, channel, pct, fixed) => (channel === "ebay" && price > 0 ? round2(price * pct / 100 + fixed) : 0);
const netProfit = (b) => (hasPrice(b) ? round2(+b.sale.price - num(b.sale.fee) - totalCost(b)) : null);
const findBuild = (id) => APP.data.builds.find((b) => b.id === id);
const findPot = (id) => APP.data.pots.find((p) => p.id === id);
const touch = (b) => { b.updatedAt = nowIso(); };
const activeBuilds = () => APP.data.builds.filter((b) => b.status !== "sold");

/* ---------- Ledger maths ---------- */
const sumLedger = (pred) => round2(APP.data.ledger.filter(pred).reduce((s, e) => s + e.amount, 0));
const allowanceAvailable = () => sumLedger((e) => e.account === "allowance");
const allowanceEarned = () => sumLedger((e) => e.account === "allowance" && e.kind === "sale-split" && e.amount > 0);
const allowanceWithdrawn = () => -sumLedger((e) => e.account === "allowance" && e.kind === "withdrawal");
const allowanceToPots = () => -sumLedger((e) => e.account === "allowance" && e.amount < 0 && e.kind !== "withdrawal");
const capitalReinvested = () => sumLedger((e) => e.account === "capital");
const potBalance = (id) => sumLedger((e) => e.account === "pot" && e.potId === id);

/** Write convenience copies of computed numbers so other scripts can read them straight from the JSON. */
function prepareForSave(d) {
  for (const b of d.builds) {
    b.totalCost = totalCost(b);
    if (b.sale) b.sale.netProfit = netProfit(b);
  }
  for (const p of d.pots) p.balance = potBalance(p.id);
  Object.assign(d.finance, {
    allowanceAvailable: allowanceAvailable(),
    allowanceEarned: allowanceEarned(),
    capitalReinvested: capitalReinvested(),
  });
  d.updatedAt = nowIso();
}

/**
 * Merge two versions of the data file.
 *  - `incoming` (this page) decides which builds exist and owns settings, money, pots and searches.
 *  - Per build, the copy with the newer `updatedAt` wins (keeps the worker's "Sold").
 *  - The `worker` section always comes from `base` (disk) - only the worker writes it.
 */
function mergeData(base, incoming) {
  if (!base) return incoming;
  const baseMap = new Map(base.builds.map((b) => [b.id, b]));
  const builds = incoming.builds.map((b) => {
    const d = baseMap.get(b.id);
    return d && ts(d.updatedAt) > ts(b.updatedAt) ? d : b;
  });
  return { ...incoming, builds, worker: base.worker || incoming.worker || {} };
}


/* ==========================================================================
   Money formatting
   --------------------------------------------------------------------------
   money(n)          a balance:  £1,234.56   (negative → −£… in red via cls())
   flow(n)           a flow:     +£1,234.56 / −£1,234.56   (always green)
   ========================================================================== */
const cur = () => APP.data?.settings?.currency || "£";
const fmtAbs = (n) => Math.abs(+n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function money(n) {
  if (n == null || !Number.isFinite(+n)) return "—";
  return `${n < 0 ? "−" : ""}${cur()}${fmtAbs(n)}`;
}
function flow(n) {
  if (n == null || !Number.isFinite(+n)) return "—";
  if (Math.abs(+n) < 0.005) return `${cur()}0.00`;
  return `${n < 0 ? "−" : "+"}${cur()}${fmtAbs(n)}`;
}
/** Colour for a profit figure: green flow, red if it's a loss. */
const profitCls = (n) => (n < 0 ? "loss" : "flow");
const balanceCls = (n) => (n < 0 ? "loss" : "");

function rel(iso) {
  const t = ts(iso);
  if (!t) return "never";
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 45) return "just now";
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 36) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}
const niceDate = (iso) => (ts(iso) ? new Date(ts(iso)).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "");


/* ==========================================================================
   Supabase: loading, saving and live updates
   --------------------------------------------------------------------------
   Tables (created by supabase/1_setup.sql):
     site_settings  public   currency + eBay fee settings
     builds         public   one row per build: data, status, sale (no notes/split)
     build_private  editors  notes + profit split per build
     private_state  editors  finance, ledger, pots, Part Finder presets, split rule
     worker_status  public   results of the eBay sold-listing checker
   The DATABASE decides who may read or change what. This page only follows it:
   a visitor who isn't signed in physically can't read the private tables or
   write anything, whatever they do to this page.
   ========================================================================== */
const CFG = window.PCBT_CONFIG || {};
let sb = null;          // Supabase client
let EDIT = false;       // signed in as an editor?

const isConfigured = () =>
  /^https:\/\/[a-z0-9-]+\.supabase\.(co|in)\/?$/i.test(CFG.supabaseUrl || "") &&
  String(CFG.supabaseKey || "").length > 20 && !/YOUR/i.test(String(CFG.supabaseKey));

const iso = (t) => (t ? new Date(t).toISOString() : nowIso());
const PUBLIC_SETTING_KEYS = ["currency", "currencyGbp", "ebayFeePct", "ebayFixedFee"];

/** JSON with sorted keys, so rows compare equal whatever order the database returns keys in. */
function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}

/* ---------- build object  <->  database rows ---------- */
function buildRows(b) {
  const { id, status, notes, sale, updatedAt, ...rest } = b;
  let pubSale = null, split = null;
  if (sale) { const { split: sp, ...s } = sale; pubSale = { ...s, netProfit: netProfit(b) }; split = sp ?? null; }
  const updated_at = iso(updatedAt);
  return {
    pub: { id, status, data: { ...rest, totalCost: totalCost(b) }, sale: pubSale, updated_at },
    priv: { id, notes: notes || "", sale_split: split, updated_at },
  };
}
const pubRow = (r) => ({ id: r.id, status: r.status, data: r.data || {}, sale: r.sale ?? null, updated_at: iso(r.updated_at) });
const privRow = (r) => ({ id: r.id, notes: r.notes || "", sale_split: r.sale_split ?? null, updated_at: iso(r.updated_at) });
function rowsToBuild(pub, priv) {
  const sale = pub.sale ? { ...pub.sale } : null;
  if (sale && priv?.sale_split) sale.split = priv.sale_split;
  return normBuild({ ...(pub.data || {}), id: pub.id, status: pub.status, sale, notes: priv?.notes ?? "", updatedAt: iso(pub.updated_at) });
}
const privateDoc = (d) => ({ finance: d.finance, ledger: d.ledger, pots: d.pots, partFinder: d.partFinder, split: d.settings.split });
function publicSettings(d) { const s = {}; for (const k of PUBLIC_SETTING_KEYS) s[k] = d.settings[k]; return s; }
const workerFromRow = (r) => (r ? { lastRun: r.last_run, intervalMin: r.interval_min, checks: r.checks || {} } : {});

/** Remember what the database holds, so we only send what changed. */
function takeSnapshot() {
  const snap = { pub: new Map(), priv: new Map(), settings: stable(publicSettings(APP.data)), state: stable(privateDoc(APP.data)) };
  for (const b of APP.data.builds) { const r = buildRows(b); snap.pub.set(b.id, stable(r.pub)); snap.priv.set(b.id, stable(r.priv)); }
  APP.snap = snap;
}

async function loadAll() {
  const jobs = [
    sb.from("site_settings").select("data").eq("id", 1).maybeSingle(),
    sb.from("builds").select("*"),
    sb.from("worker_status").select("*").eq("id", 1).maybeSingle(),
  ];
  if (EDIT) jobs.push(sb.from("build_private").select("*"), sb.from("private_state").select("data").eq("id", 1).maybeSingle());
  const [st, bl, wk, bp, ps] = await Promise.all(jobs);
  for (const r of [st, bl, wk, bp, ps]) if (r?.error) throw r.error;
  const privs = new Map((bp?.data || []).map((r) => [r.id, privRow(r)]));
  const pd = ps?.data?.data || {};
  APP.data = normalize({
    settings: { ...(st.data?.data || {}), ...(pd.split ? { split: pd.split } : {}) },
    builds: (bl.data || []).map((r) => rowsToBuild(pubRow(r), privs.get(r.id))),
    finance: pd.finance, ledger: pd.ledger, pots: pd.pots, partFinder: pd.partFinder,
    worker: workerFromRow(wk.data),
  });
  // Saved data from the old $ default: switch to £ and save once.
  const needsGbp = EDIT && st.data?.data?.currency === "$" && !st.data?.data?.currencyGbp;
  takeSnapshot();
  if (needsGbp) APP.snap.settings = "";
  APP.loadedAt = Date.now();
  cacheLocal();
}

function cacheLocal() {
  // View mode keeps a copy so the page shows something instantly next time (public data only).
  try {
    const { finance, ledger, pots, partFinder, ...pub } = APP.data;
    const builds = pub.builds.map(({ notes, sale, ...b }) => ({ ...b, sale: sale ? (({ split, ...s }) => s)(sale) : null }));
    localStorage.setItem(LS_KEY, JSON.stringify({ ...pub, builds, settings: publicSettings(APP.data) }));
  } catch { /* storage full or blocked */ }
}

function scheduleSave() {
  if (!EDIT) return;
  clearTimeout(APP.saveTimer);
  APP.saveTimer = setTimeout(saveNow, SAVE_DEBOUNCE_MS);
  setSaveState("Saving…");
}

/** Send only what changed since the last save / load. */
async function saveNow() {
  APP.saveTimer = null;
  if (!EDIT || !sb) return;
  if (APP.saving) { APP.saveQueued = true; return; }
  APP.saving = true;
  try {
    prepareForSave(APP.data);
    const d = APP.data, pubUp = [], privUp = [], ids = new Set();
    for (const b of d.builds) {
      ids.add(b.id);
      const r = buildRows(b);
      if (APP.snap.pub.get(b.id) !== stable(r.pub)) pubUp.push(r.pub);
      if (APP.snap.priv.get(b.id) !== stable(r.priv)) privUp.push(r.priv);
    }
    const removed = [...APP.snap.pub.keys()].filter((id) => !ids.has(id));

    if (pubUp.length) {
      const { data, error } = await sb.from("builds").upsert(pubUp).select();
      if (error) throw error;
      for (const row of data || []) {
        const r = pubRow(row), sent = pubUp.find((x) => x.id === r.id);
        APP.snap.pub.set(r.id, stable(r));
        if (sent && stable(sent) !== stable(r)) adoptRemoteBuild(r, true);   // someone else's newer change won
      }
    }
    if (privUp.length) {
      const { data, error } = await sb.from("build_private").upsert(privUp).select();
      if (error) throw error;
      for (const row of data || []) APP.snap.priv.set(row.id, stable(privRow(row)));
    }
    if (removed.length) {
      const { error } = await sb.from("builds").delete().in("id", removed);
      if (error) throw error;
      removed.forEach((id) => { APP.snap.pub.delete(id); APP.snap.priv.delete(id); });
    }
    const settings = publicSettings(d);
    if (APP.snap.settings !== stable(settings)) {
      const { error } = await sb.from("site_settings").upsert({ id: 1, data: settings, updated_at: nowIso() });
      if (error) throw error;
      APP.snap.settings = stable(settings);
    }
    const state = privateDoc(d);
    if (APP.snap.state !== stable(state)) {
      const { error } = await sb.from("private_state").upsert({ id: 1, data: state, updated_at: nowIso() });
      if (error) throw error;
      APP.snap.state = stable(state);
    }
    cacheLocal();
    setSaveState("Saved");
  } catch (e) {
    setSaveState("Save failed");
    const msg = /row-level security|permission|JWT|401|403/i.test(e.message || "") ? "You're no longer signed in with edit access. Sign in again — your unsaved change is still on screen." : e.message;
    toast(`Couldn't save: ${msg}`, "err", 7000);
  } finally {
    APP.saving = false;
    if (APP.saveQueued) { APP.saveQueued = false; saveNow(); }
  }
}

/* ---------- Live updates from the database ---------- */
function adoptRemoteBuild(row, quiet = false) {
  const i = APP.data.builds.findIndex((b) => b.id === row.id);
  const old = i >= 0 ? APP.data.builds[i] : null;
  const priv = old ? buildRows(old).priv : null;
  const b = rowsToBuild(row, priv);
  if (i >= 0) APP.data.builds[i] = b; else APP.data.builds.push(b);
  if (!quiet && old && old.status !== "sold" && b.status === "sold" && b.sale?.source === "worker") announceSold(b);
}

function onBuildChange(p) {
  if (p.eventType === "DELETE") {
    const id = p.old?.id;
    if (id && findBuild(id) && APP.snap.pub.has(id)) {
      APP.data.builds = APP.data.builds.filter((b) => b.id !== id);
      APP.snap.pub.delete(id); APP.snap.priv.delete(id);
      liveRender();
    }
    return;
  }
  const r = pubRow(p.new), key = stable(r);
  if (APP.snap.pub.get(r.id) === key) return;                        // our own save coming back
  const local = findBuild(r.id);
  if (local) {
    const dirty = stable(buildRows(local).pub) !== APP.snap.pub.get(r.id);
    if (dirty && ts(local.updatedAt) >= ts(r.updated_at)) return;     // our newer unsaved edit wins
  }
  adoptRemoteBuild(r);
  APP.snap.pub.set(r.id, key);
  liveRender();
}

function onBuildPrivateChange(p) {
  if (p.eventType === "DELETE") return;
  const r = privRow(p.new), key = stable(r);
  if (APP.snap.priv.get(r.id) === key) return;
  const b = findBuild(r.id);
  if (!b) return;
  if (stable(buildRows(b).priv) !== APP.snap.priv.get(r.id) && ts(b.updatedAt) >= ts(r.updated_at)) return;
  b.notes = r.notes;
  if (b.sale) { if (r.sale_split) b.sale.split = r.sale_split; else delete b.sale.split; }
  APP.snap.priv.set(r.id, key);
  liveRender();
}

function onPrivateStateChange(p) {
  const doc = p.new?.data;
  if (!doc || APP.snap.state === stable(doc)) return;
  if (stable(privateDoc(APP.data)) !== APP.snap.state) return;       // unsaved local money edits win
  const n = normalize({ ...APP.data, finance: doc.finance, ledger: doc.ledger, pots: doc.pots, partFinder: doc.partFinder, settings: { ...APP.data.settings, ...(doc.split ? { split: doc.split } : {}) } });
  Object.assign(APP.data, { finance: n.finance, ledger: n.ledger, pots: n.pots, partFinder: n.partFinder, settings: n.settings });
  APP.snap.state = stable(privateDoc(APP.data));
  liveRender();
}

function onSettingsChange(p) {
  const s = p.new?.data;
  if (!s || APP.snap.settings === stable(s)) return;
  Object.assign(APP.data.settings, s);
  APP.snap.settings = stable(publicSettings(APP.data));
  liveRender();
}

function onWorkerChange(p) {
  if (!p.new) return;
  APP.data.worker = workerFromRow(p.new);
  renderWorkerPill();
  if (UI.tab === "builds") liveRender();
}

let liveTimer = null;
function liveRender() { clearTimeout(liveTimer); liveTimer = setTimeout(() => { cacheLocal(); renderPreservingFocus(); }, 60); }

function subscribe() {
  if (APP.channel) sb.removeChannel(APP.channel);
  const on = (ch, table, fn) => ch.on("postgres_changes", { event: "*", schema: "public", table }, fn);
  let ch = sb.channel(`pcbt-${EDIT ? "edit" : "view"}-${Math.random().toString(36).slice(2, 8)}`);
  ch = on(ch, "builds", onBuildChange);
  ch = on(ch, "site_settings", onSettingsChange);
  ch = on(ch, "worker_status", onWorkerChange);
  if (EDIT) { ch = on(ch, "build_private", onBuildPrivateChange); ch = on(ch, "private_state", onPrivateStateChange); }
  APP.channel = ch.subscribe((status) => { APP.live = status === "SUBSCRIBED"; setStoragePill(); });
}

/** Safety net: re-read everything when the tab comes back, if nothing is waiting to save. */
async function refreshIfIdle() {
  if (!sb || APP.saving || APP.saveTimer || Date.now() - (APP.loadedAt || 0) < 20000) return;
  try { await loadAll(); renderPreservingFocus(); } catch { setStoragePill(true); }
}

/* ---------- "Item sold" alerts ---------- */
function announceSold(b) {
  const msg = `“${b.name || "Untitled build"}” sold on eBay${EDIT ? " — confirm the final price." : "."}`;
  toast(`🎉 ${msg}`, "ok", 8000);
  if (EDIT && "Notification" in window && Notification.permission === "granted") {
    try { new Notification("🎉 Item Sold on eBay!", { body: msg, icon: "favicon.ico", tag: `sold-${b.id}` }); } catch { /* ignore */ }
  }
}

/* ==========================================================================
   View / Edit gate and secure sign-in
   --------------------------------------------------------------------------
   • First visit: choose View (no login, read-only) or Edit (sign in).
   • Sign-in is Supabase Auth: email + password (hashed and rate-limited by
     Supabase), optional two-step verification (authenticator app codes), and
     the database only gives edit rights to logins listed in public.editors.
   • Edit mode locks itself after 30 minutes without activity.
   ========================================================================== */
const MODE_KEY = "pcbt.mode";
const IDLE_LOCK_MS = 30 * 60 * 1000;
let lastActivity = Date.now();
let failedLogins = 0, loginBlockedUntil = 0;

function showGate() {
  $("#gate").hidden = false;
  document.body.classList.add("gated");
  requestAnimationFrame(() => $("#gate").classList.add("show"));
  setTimeout(() => $("#gateView").focus(), 50);
}
function hideGate() {
  const g = $("#gate");
  g.classList.remove("show");
  document.body.classList.remove("gated");
  setTimeout(() => (g.hidden = true), REDUCED_MOTION ? 0 : 250);
}
function showSetupNeeded() {
  $("#gate").hidden = false;
  $("#gateOptions").hidden = true;
  $("#gateSetup").hidden = false;
  document.body.classList.add("gated");
  requestAnimationFrame(() => $("#gate").classList.add("show"));
}

async function enterView({ remember = true } = {}) {
  EDIT = false;
  document.body.classList.remove("edit");
  document.body.classList.add("view");
  if (remember) localStorage.setItem(MODE_KEY, "view");
  if (UI.tab !== "builds") UI.tab = "builds";
  await loadAndShow();
}

async function enterEdit() {
  EDIT = true;
  document.body.classList.remove("view");
  document.body.classList.add("edit");
  localStorage.setItem(MODE_KEY, "edit");
  lastActivity = Date.now();
  await loadAndShow();
  const { data } = await sb.auth.getUser();
  APP.userEmail = data?.user?.email || "";
}

async function loadAndShow() {
  hideGate();
  try { await loadAll(); }
  catch (e) {
    toast(`Couldn't load data: ${e.message}`, "err", 8000);
    APP.data = APP.data || normalize(safeJson(localStorage.getItem(LS_KEY), null) || {});
  }
  APP.seenCards.clear();
  subscribe();
  render();
  setTab(EDIT && ["builds", "finder", "money"].includes(UI.tab) ? UI.tab : "builds", { animate: false });
  requestAnimationFrame(moveIndicator);
}

/** After a password (and 2FA if needed): only editors get edit mode. */
async function finishSignIn() {
  const { data, error } = await sb.rpc("is_editor");
  if (error || data !== true) {
    await sb.auth.signOut();
    toast("This account doesn't have edit access. Ask the owner to add it as an editor.", "err", 7000);
    if (!APP.data) showGate();
    return false;
  }
  closeDialog($("#loginDialog"), "ok");
  closeDialog($("#mfaDialog"), "ok");
  await enterEdit();
  toast(`Signed in — full edit access`, "ok");
  return true;
}

/** Does this session still need its two-step code? */
async function needsSecondStep() {
  const { data } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
  return data?.nextLevel === "aal2" && data?.currentLevel !== "aal2";
}

function openLogin() {
  $("#loginError").textContent = "";
  $("#loginPassword").value = "";
  openDialog($("#loginDialog"));
  ($("#loginEmail").value ? $("#loginPassword") : $("#loginEmail")).focus();
}

async function doLogin() {
  const err = $("#loginError");
  if (Date.now() < loginBlockedUntil) { err.textContent = `Too many attempts. Try again in ${Math.ceil((loginBlockedUntil - Date.now()) / 1000)}s.`; return false; }
  const email = $("#loginEmail").value.trim(), password = $("#loginPassword").value;
  $("#loginBtn").disabled = true;
  err.textContent = "";
  try {
    const { error } = await sb.auth.signInWithPassword({ email, password });
    if (error) {
      failedLogins++;
      if (failedLogins >= 5) { loginBlockedUntil = Date.now() + 30000 * (failedLogins - 4); }
      err.textContent = /invalid login|invalid credentials/i.test(error.message) ? "Wrong email or password." : error.message;
      return false;
    }
    failedLogins = 0;
    if (await needsSecondStep()) { closeDialog($("#loginDialog"), "ok"); openMfa(); return true; }
    await finishSignIn();
    return true;
  } finally { $("#loginBtn").disabled = false; }
}

async function sendReset() {
  const email = $("#loginEmail").value.trim();
  if (!email) { $("#loginError").textContent = "Type your email first, then press “Forgot password?”."; $("#loginEmail").focus(); return; }
  await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
  $("#loginError").textContent = "";
  toast("If that email has an account, a reset link is on its way.", "ok", 6000);
}

/* ---------- Two-step verification ---------- */
function openMfa() {
  $("#mfaCode").value = "";
  $("#mfaError").textContent = "";
  openDialog($("#mfaDialog"));
  $("#mfaCode").focus();
}
async function verifyMfa() {
  const code = $("#mfaCode").value.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) { $("#mfaError").textContent = "Enter the 6-digit code from your authenticator app."; return false; }
  const { data } = await sb.auth.mfa.listFactors();
  const factor = data?.totp?.find((f) => f.status === "verified");
  if (!factor) { $("#mfaError").textContent = "No authenticator is set up for this account."; return false; }
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: factor.id, code });
  if (error) { $("#mfaError").textContent = "That code didn't work. Codes change every 30 seconds — try the new one."; return false; }
  return finishSignIn();
}

const ENROLL = { factorId: null };
async function startEnroll() {
  const { data: list } = await sb.auth.mfa.listFactors();
  for (const f of (list?.all || []).filter((f) => f.status !== "verified")) await sb.auth.mfa.unenroll({ factorId: f.id });
  const { data, error } = await sb.auth.mfa.enroll({ factorType: "totp", friendlyName: `PC Build Tracker ${new Date().toISOString().slice(0, 16)}` });
  if (error) return toast(`Couldn't start two-step setup: ${error.message}`, "err");
  ENROLL.factorId = data.id;
  $("#enrollQr").src = data.totp.qr_code;
  $("#enrollSecret").textContent = data.totp.secret;
  $("#enrollCode").value = "";
  $("#enrollError").textContent = "";
  openDialog($("#enrollDialog"));
  $("#enrollCode").focus();
}
async function finishEnroll() {
  const code = $("#enrollCode").value.replace(/\s/g, "");
  if (!/^\d{6}$/.test(code)) { $("#enrollError").textContent = "Enter the 6-digit code your app shows."; return false; }
  const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: ENROLL.factorId, code });
  if (error) { $("#enrollError").textContent = "That code didn't match. Check your phone's clock and try the newest code."; return false; }
  toast("Two-step verification is on. You'll need a code each time you sign in.", "ok", 6000);
  renderAccountBlock();
  return true;
}
async function disableMfa() {
  if (!(await confirmBox("Turn off two-step verification?", "Signing in will only need your password.", "Turn off"))) return;
  const { data } = await sb.auth.mfa.listFactors();
  for (const f of data?.all || []) await sb.auth.mfa.unenroll({ factorId: f.id });
  await sb.auth.refreshSession();
  toast("Two-step verification turned off.", "ok");
  renderAccountBlock();
}

/* ---------- Passwords ---------- */
function openNewPassword(title = "Choose a new password") {
  $("#pwTitle").textContent = title;
  $("#pw1").value = ""; $("#pw2").value = ""; $("#pwError").textContent = "";
  openDialog($("#pwDialog"));
  $("#pw1").focus();
}
async function saveNewPassword() {
  const a = $("#pw1").value, b = $("#pw2").value;
  if (a.length < 10) { $("#pwError").textContent = "Use at least 10 characters."; return false; }
  if (a !== b) { $("#pwError").textContent = "The two passwords don't match."; return false; }
  const { error } = await sb.auth.updateUser({ password: a });
  if (error) { $("#pwError").textContent = error.message; return false; }
  toast("Password changed.", "ok");
  if (!EDIT) { if (await needsSecondStep()) openMfa(); else await finishSignIn(); }
  return true;
}

async function lock(reason) {
  APP.locking = true;
  try { await sb.auth.signOut(); } catch { /* ignore */ } finally { APP.locking = false; }
  APP.userEmail = "";
  await enterView({ remember: false });
  if (reason) toast(reason, "", 6000);
}

function trackActivity() {
  const mark = () => (lastActivity = Date.now());
  ["pointerdown", "keydown", "wheel", "touchstart"].forEach((t) => addEventListener(t, mark, { passive: true }));
  setInterval(() => { if (EDIT && Date.now() - lastActivity > IDLE_LOCK_MS) lock("Locked after 30 minutes without activity. Sign in again to keep editing."); }, 30000);
}

/* ==========================================================================
   Rendering - shared
   ========================================================================== */
function render() {
  renderStats();
  renderGrid();
  renderFinder();
  renderMoney();
  setStoragePill();
  renderWorkerPill();
  $$("[data-cur]").forEach((el) => (el.textContent = cur()));
}

/** Set text and play a small "bump" if the value changed. */
function setNum(el, text, cls) {
  if (cls !== undefined) el.className = cls;
  if (el.textContent === text) return;
  el.textContent = text;
  if (!REDUCED_MOTION && el.dataset.ready) { el.classList.remove("bump"); void el.offsetWidth; el.classList.add("bump"); }
  el.dataset.ready = "1";
}

function renderStats() {
  const builds = APP.data.builds;
  const active = activeBuilds();
  const sold = builds.filter((b) => b.status === "sold");
  const priced = sold.filter(hasPrice);
  const capital = round2(builds.reduce((s, b) => s + totalCost(b), 0));
  const tiedUp = round2(active.reduce((s, b) => s + totalCost(b), 0));
  const profit = round2(priced.reduce((s, b) => s + netProfit(b), 0));
  const revenue = round2(priced.reduce((s, b) => s + +b.sale.price, 0));
  const review = sold.length - priced.length;

  setNum($("#statActive"), String(active.length));
  $("#statActiveSub").innerHTML = active.length ? `<span class="flow">${flow(-tiedUp)}</span> tied up in parts` : "Nothing in progress";
  setNum($("#statSold"), String(sold.length));
  $("#statSoldSub").innerHTML = review ? `${review} awaiting final price` : sold.length ? `<span class="flow">${flow(revenue)}</span> total revenue` : "No sales yet";
  setNum($("#statCapital"), flow(-capital), "v money flow");
  $("#statCapitalSub").textContent = `Spent on parts across ${builds.length} build${builds.length === 1 ? "" : "s"}`;
  setNum($("#statProfit"), flow(profit), `v money ${profitCls(profit)}`);
  $("#statProfitSub").innerHTML = priced.length ? `Avg <span class="${profitCls(profit)}">${flow(round2(profit / priced.length))}</span> per sale` : "Sell a build to see profit";

  $("#nAll").textContent = builds.length;
  $("#nActive").textContent = active.length;
  $("#nSold").textContent = sold.length;
  $("#tabCountBuilds").textContent = builds.length || "";
}

function setSaveState(text) {
  const el = $("#saveState");
  el.textContent = text;
  clearTimeout(setSaveState.t);
  if (text === "Saved" || text === "Saved locally") setSaveState.t = setTimeout(() => (el.textContent = ""), 2500);
}
function setStoragePill(offline = false) {
  const pill = $("#storagePill");
  let cls = "ok", text = EDIT ? "Live · editing" : "Live · view only";
  if (!sb) { cls = "warn"; text = "Not connected"; }
  else if (offline) { cls = "err"; text = "Can't reach the database"; }
  else if (APP.live === false) { cls = "warn"; text = EDIT ? "Editing · live updates paused" : "View only · live updates paused"; }
  pill.className = `pill ${cls}`;
  $(".t", pill).textContent = text;
  pill.title = EDIT ? "Signed in with full edit access. Changes save automatically." : "View-only mode. Sign in to edit.";
}
function renderWorkerPill() {
  const pill = $("#workerPill");
  const w = APP.data.worker || {};
  let cls = "", text = "eBay checker · not run yet";
  if (w.lastRun) {
    const ageMin = (Date.now() - ts(w.lastRun)) / 60000;
    const iv = num(w.intervalMin) || 15;
    cls = ageMin < iv * 2 + 2 ? "ok" : "warn";
    text = `eBay checker · ${rel(w.lastRun)}`;
  }
  pill.className = `pill ${cls}`;
  $(".t", pill).textContent = text;
  pill.title = w.lastRun
    ? `The cloud eBay checker last looked at active listings ${rel(w.lastRun)} (every ${num(w.intervalMin) || 15} min).`
    : "The cloud eBay checker hasn't run yet. See step 6 of the setup guide.";
}


/* ==========================================================================
   Tabs
   ========================================================================== */
function setTab(name, { animate = true } = {}) {
  if (!EDIT) name = "builds";   // Part Finder and Money are editor-only
  UI.tab = name;
  saveUi();
  $$(".tab").forEach((t) => t.setAttribute("aria-selected", String(t.dataset.tab === name)));
  $$(".panel").forEach((p) => {
    const on = p.id === `panel-${name}`;
    if (on && !p.classList.contains("active")) {
      p.classList.add("active");
      if (!animate) p.style.animation = "none", requestAnimationFrame(() => (p.style.animation = ""));
    } else if (!on) p.classList.remove("active");
  });
  moveIndicator();
  if (name === "builds") { APP.seenCards.clear(); renderGrid(); }
  if (name === "money") renderMoney(true);
}
function moveIndicator() {
  const active = $(".tab[aria-selected=true]");
  const ind = $("#tabs .indicator");
  if (!active) return;
  ind.style.width = `${active.offsetWidth}px`;
  ind.style.transform = `translateX(${active.offsetLeft}px)`;
}


/* ==========================================================================
   Builds
   ========================================================================== */
function visibleBuilds() {
  const q = APP.query.trim().toLowerCase();
  const rank = (b) => (b.status === "sold" && (b.sale?.needsReview || !hasPrice(b)) ? 0 : b.status === "sold" ? 2 : 1);
  return APP.data.builds
    .filter((b) => APP.filter === "all" || (APP.filter === "sold" ? b.status === "sold" : b.status !== "sold"))
    .filter((b) => !q || b.name.toLowerCase().includes(q) || b.notes.toLowerCase().includes(q) || b.items.some((i) => i.description.toLowerCase().includes(q)))
    .sort((a, b) => rank(a) - rank(b) || ts(b.createdAt) - ts(a.createdAt));
}

function renderGrid() {
  const grid = $("#grid");
  const list = visibleBuilds();
  if (!APP.data.builds.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>No builds yet</h3><p>Create your first build to start tracking parts, costs and profit.</p><button class="btn primary" type="button" data-act="new-build" data-edit-only>${ICON.plus} New build</button></div>`;
    return;
  }
  if (!list.length) {
    grid.innerHTML = `<div class="empty" style="grid-column:1/-1"><h3>Nothing matches</h3><p>Try a different filter or search.</p></div>`;
    return;
  }
  let i = 0;
  grid.innerHTML = list.map((b) => {
    const isNew = !APP.seenCards.has(b.id);
    APP.seenCards.add(b.id);
    return cardHtml(b, isNew ? i++ : -1);
  }).join("");
  fitCosts(grid);
}

function headNumHtml(b) {
  const net = netProfit(b);
  if (b.status === "sold" && net != null) return `<span class="k">Net profit</span><span class="v money ${profitCls(net)}">${flow(net)}</span>`;
  return `<span class="k">Build cost</span><span class="v money flow">${flow(-totalCost(b))}</span>`;
}

function checkLineHtml(b) {
  const c = APP.data.worker?.checks?.[b.id];
  if (b.status === "sold" || !b.ebayUrl) return "";
  if (!c) return `<div class="check-line"><span class="dot"></span>Not checked by the worker yet</div>`;
  const label = { live: "Listing still live", blocked: "eBay blocked the check — will retry", error: "Check failed — will retry", not_found: "Listing page not found", skipped: "Not an eBay URL — skipped" }[c.result] || c.result;
  return `<div class="check-line ${c.result === "live" ? "live" : "problem"}"><span class="dot"></span>${esc(label)} · checked ${rel(c.checkedAt)}</div>`;
}

function itemRowHtml(i, animate = false) {
  return `<tr data-item="${esc(i.id)}" class="${animate ? "enter" : ""}">
    <td><input class="cell" data-ifield="description" value="${esc(i.description)}" placeholder="e.g. RTX 4070 Super" aria-label="Item description"></td>
    <td class="cost"><div class="cost-wrap"><span class="sign">−${esc(cur())}</span><input class="cell cost-in" data-ifield="cost" type="number" inputmode="decimal" step="0.01" min="0" value="${i.cost ? i.cost.toFixed(2) : ""}" placeholder="0.00" aria-label="Item cost"></div></td>
    <td class="del">${i.url ? `<a class="icon-btn link" href="${esc(i.url)}" target="_blank" rel="noopener noreferrer" title="Open listing" aria-label="Open listing">${ICON.ext}</a>` : ""}<button class="icon-btn" type="button" data-act="del-item" aria-label="Remove item">${ICON.x}</button></td>
  </tr>`;
}

function splitSummaryHtml(sale) {
  const sp = sale.split;
  if (!sp) return "";
  const pots = (sp.pots || []).map((p) => `<b class="flow">${flow(p.amount)}</b> → ${esc(findPot(p.potId)?.name || "pot")}`);
  return `<span>Split: <b class="flow">${flow(sp.reinvest)}</b> business · <b class="flow">${flow(sp.allowance)}</b> allowance${pots.length ? " · " + pots.join(" · ") : ""}</span>`;
}

/** Read-only card for View mode: no inputs, no buttons that change anything, no private notes. */
function viewCardHtml(b, enterIndex = -1) {
  const sold = b.status === "sold", sale = b.sale || {};
  const pending = sold && !hasPrice(b);
  const collapsed = APP.collapsed.has(b.id);
  const net = netProfit(b), cost = totalCost(b);
  const rows = b.items.length
    ? b.items.map((i) => `<tr><td class="desc">${esc(i.description || "—")}</td><td class="cost-v money flow">${flow(-num(i.cost))}</td></tr>`).join("")
    : `<tr><td colspan="2" class="empty-items">No parts listed.</td></tr>`;
  const saleHtml = sold && hasPrice(b) ? `
    <div class="sale">
      <div class="sale-grid">
        <div><span class="k">Sale price</span><span class="v money flow">${flow(sale.price)}</span></div>
        <div><span class="k">${sale.channel === "ebay" ? "eBay fees" : "Fees"}</span><span class="v money flow">${flow(-num(sale.fee))}</span></div>
        <div><span class="k">Build cost</span><span class="v money flow">${flow(-cost)}</span></div>
        <div class="${net < 0 ? "is-loss" : ""}"><span class="k">Net profit</span><span class="v money ${profitCls(net)}">${flow(net)}</span></div>
      </div>
      <div class="sale-meta"><span>Sold via ${sale.channel === "ebay" ? "eBay" : "Local / Cash"}${sale.soldAt ? ` · ${niceDate(sale.soldAt)}` : ""}</span></div>
    </div>` : pending ? `<div class="review-banner" role="status"><div><p style="margin:0"><strong>Sold on eBay.</strong> Final price not confirmed yet.</p></div></div>` : "";
  return `
  <article class="card view-card ${sold ? "is-sold" : "is-active"} ${pending ? "needs-review" : ""} ${collapsed ? "collapsed" : ""} ${enterIndex >= 0 ? "enter" : ""}" data-id="${esc(b.id)}" style="--i:${Math.max(enterIndex, 0)}">
    <header class="card-head">
      <button class="icon-btn chev" type="button" data-act="toggle" aria-expanded="${!collapsed}" aria-label="${collapsed ? "Expand" : "Collapse"} build">${ICON.chev}</button>
      <h3 class="name-text">${esc(b.name || "Untitled build")}</h3>
      <span class="badge ${pending ? "review" : sold ? "sold" : "active"}">${pending ? "Sold · price pending" : sold ? "Sold" : "Active"}</span>
      <div class="head-num">${headNumHtml(b)}</div>
    </header>
    <div class="collapse"><div class="inner"><div class="card-body">
      <div>
        <div class="label">Parts &amp; expenses <span>${b.items.length} item${b.items.length === 1 ? "" : "s"}</span></div>
        <table class="items view"><tbody>${rows}</tbody></table>
        <div class="items-foot"><span></span><div class="total-pill"><span class="k">Total cost</span><span class="v money flow">${flow(-cost)}</span></div></div>
      </div>
      ${b.ebayUrl.trim() ? `<div><button class="btn" type="button" data-act="view">View eBay listing ${ICON.ext}</button>${checkLineHtml(b)}</div>` : ""}
      ${saleHtml}
    </div></div></div>
  </article>`;
}

function cardHtml(b, enterIndex = -1) {
  if (!EDIT) return viewCardHtml(b, enterIndex);
  const sold = b.status === "sold";
  const sale = b.sale || {};
  const review = sold && (sale.needsReview || !hasPrice(b));
  const collapsed = APP.collapsed.has(b.id);
  const net = netProfit(b);
  const cost = totalCost(b);

  const reviewHtml = review ? `
    <div class="review-banner" role="status"><div>
      <p><strong>eBay listing ended.</strong> ${sale.source === "worker" ? "The background worker spotted it" : "Marked sold"}${sale.detectedPhrase ? ` (“${esc(sale.detectedPhrase)}”)` : ""} ${sale.soldAt ? rel(sale.soldAt) : ""}. Confirm the final sale price to count the profit and run your profit split.</p>
      <div class="actions">
        <button class="btn primary sm" type="button" data-act="mark-sold">Confirm sale price</button>
        <button class="btn ghost sm" type="button" data-act="revert">Not sold — back to active</button>
      </div>
    </div></div>` : "";

  const saleHtml = sold && !review ? `
    <div class="sale">
      <div class="sale-grid">
        <div><span class="k">Sale price</span><span class="v money flow">${flow(sale.price)}</span></div>
        <div><span class="k">${sale.channel === "ebay" ? `eBay fee (${esc(sale.feePct)}%${num(sale.feeFixed) ? ` + ${money(sale.feeFixed)}` : ""})` : "Fees"}</span><span class="v money flow">${flow(-num(sale.fee))}</span></div>
        <div><span class="k">Build cost</span><span class="v money flow" data-role="sale-cost">${flow(-cost)}</span></div>
        <div class="${net < 0 ? "is-loss" : ""}" data-role="sale-net-box"><span class="k">Net profit</span><span class="v money ${profitCls(net)}" data-role="sale-net">${flow(net)}</span></div>
      </div>
      <div class="sale-meta"><span>Sold via ${sale.channel === "ebay" ? "eBay" : "Local / Cash"}${sale.soldAt ? ` · ${niceDate(sale.soldAt)}` : ""}</span>${splitSummaryHtml(sale)}</div>
    </div>` : "";

  const footHtml = sold
    ? `${review ? "" : `<button class="btn sm" type="button" data-act="mark-sold">Edit sale</button><button class="btn ghost sm" type="button" data-act="revert">Revert to active</button>`}
       <span class="spacer"></span><button class="btn danger sm" type="button" data-act="delete">Delete build</button>`
    : `<button class="btn primary" type="button" data-act="mark-sold">${ICON.tag} Mark as sold</button>
       <span class="spacer"></span><button class="btn danger sm" type="button" data-act="delete">Delete build</button>`;

  return `
  <article class="card ${sold ? "is-sold" : "is-active"} ${review ? "needs-review" : ""} ${collapsed ? "collapsed" : ""} ${enterIndex >= 0 ? "enter" : ""}" data-id="${esc(b.id)}" style="--i:${Math.max(enterIndex, 0)}">
    <header class="card-head">
      <button class="icon-btn chev" type="button" data-act="toggle" aria-expanded="${!collapsed}" aria-label="${collapsed ? "Expand" : "Collapse"} build">${ICON.chev}</button>
      <input class="name-input" data-field="name" value="${esc(b.name)}" placeholder="Untitled build" aria-label="Build name" spellcheck="false">
      <span class="badge ${review ? "review" : sold ? "sold" : "active"}">${review ? "Confirm price" : sold ? "Sold" : "Active"}</span>
      <div class="head-num" data-role="head-num">${headNumHtml(b)}</div>
    </header>
    <div class="collapse"><div class="inner"><div class="card-body">
      ${reviewHtml}
      <div>
        <div class="label">Parts &amp; expenses <span data-role="count">${b.items.length} item${b.items.length === 1 ? "" : "s"}</span></div>
        <table class="items">
          <thead><tr><th>Description</th><th class="cost" style="text-align:right">Cost</th><th class="del"></th></tr></thead>
          <tbody>${b.items.length ? b.items.map((i) => itemRowHtml(i)).join("") : `<tr><td colspan="3" class="empty-items">No items yet.</td></tr>`}</tbody>
        </table>
        <div class="items-foot">
          <button class="btn ghost sm" type="button" data-act="add-item">${ICON.plus} Add item</button>
          <div class="total-pill"><span class="k">Total cost</span><span class="v money flow" data-role="total">${flow(-cost)}</span></div>
        </div>
      </div>
      <div class="field">
        <label for="url-${esc(b.id)}">eBay listing URL</label>
        <div class="url-row">
          <input id="url-${esc(b.id)}" type="url" data-field="ebayUrl" value="${esc(b.ebayUrl)}" placeholder="https://www.ebay.co.uk/itm/…" spellcheck="false">
          <button class="btn" type="button" data-act="view" ${b.ebayUrl.trim() ? "" : "disabled"}>View listing ${ICON.ext}</button>
        </div>
        ${checkLineHtml(b)}
      </div>
      <div class="field">
        <label for="notes-${esc(b.id)}">Notes</label>
        <textarea id="notes-${esc(b.id)}" data-field="notes" rows="2" placeholder="Specs, buyer details, condition…">${esc(b.notes)}</textarea>
      </div>
      ${saleHtml}
      <footer class="card-foot">${footHtml}</footer>
    </div></div></div>
  </article>`;
}

/** Size a cost box to its number so the "−£" sits right next to it. */
function fitCost(el) { el.style.width = `calc(${Math.max(4, (el.value || el.placeholder).length + 0.5)}ch + 10px)`; }
const fitCosts = (root = document) => $$(".cost-in", root).forEach(fitCost);

function refreshCardNumbers(card, b) {
  $('[data-role="total"]', card).textContent = flow(-totalCost(b));
  $('[data-role="head-num"]', card).innerHTML = headNumHtml(b);
  const n = b.items.length;
  $('[data-role="count"]', card).textContent = `${n} item${n === 1 ? "" : "s"}`;
  const netEl = $('[data-role="sale-net"]', card);
  if (netEl) {
    const net = netProfit(b);
    netEl.textContent = flow(net);
    netEl.className = `v money ${profitCls(net)}`;
    $('[data-role="sale-net-box"]', card).classList.toggle("is-loss", net < 0);
    $('[data-role="sale-cost"]', card).textContent = flow(-totalCost(b));
  }
}

function renderPreservingFocus() {
  const a = document.activeElement;
  let key = null;
  if (a && a.closest && a.closest(".card")) {
    const row = a.closest("[data-item]");
    key = { id: a.closest(".card").dataset.id, field: a.dataset.field, ifield: a.dataset.ifield, item: row?.dataset.item, value: a.value, sel: null };
    try { key.sel = [a.selectionStart, a.selectionEnd]; } catch { /* number inputs */ }
  }
  const bankFocused = a?.id === "bankBalance" ? a.value : null;
  render();
  if (bankFocused !== null) { const el = $("#bankBalance"); el.focus(); el.value = bankFocused; }
  if (!key) return;
  const sel = `.card[data-id="${CSS.escape(key.id)}"] ` + (key.item ? `[data-item="${CSS.escape(key.item)}"] [data-ifield="${key.ifield}"]` : `[data-field="${key.field}"]`);
  const el = $(sel);
  if (!el) return;
  el.focus();
  if (el.value !== key.value && findBuild(key.id)) el.value = key.value;
  try { if (key.sel) el.setSelectionRange(...key.sel); } catch { /* ignore */ }
}

function newBuild(firstItem) {
  if (!EDIT) return null;
  const b = normBuild({
    id: uid("b"),
    name: `Build #${APP.data.builds.length + 1}`,
    items: [firstItem || { id: uid("i"), description: "", cost: 0 }],
  });
  APP.data.builds.push(b);
  if (APP.filter === "sold") setFilter("all");
  APP.query = ""; $("#search").value = "";
  if (UI.tab !== "builds") setTab("builds");
  render();
  scheduleSave();
  const input = $(`.card[data-id="${CSS.escape(b.id)}"] .name-input`);
  input?.focus(); input?.select();
  input?.scrollIntoView({ block: "center", behavior: REDUCED_MOTION ? "auto" : "smooth" });
  return b;
}

function addItem(b, item) {
  if (!EDIT) return null;
  item = item || { id: uid("i"), description: "", cost: 0 };
  b.items.push(item);
  touch(b);
  APP.collapsed.delete(b.id);
  const card = $(`.card[data-id="${CSS.escape(b.id)}"]`);
  if (card) {
    const tbody = $("tbody", card);
    if (b.items.length === 1) tbody.innerHTML = "";
    tbody.insertAdjacentHTML("beforeend", itemRowHtml(item, true));
    fitCosts(tbody.lastElementChild);
    refreshCardNumbers(card, b);
    card.classList.remove("collapsed");
  }
  renderStats();
  renderMoney();
  scheduleSave();
  return item;
}

function openListing(b) {
  let url = b.ebayUrl.trim();
  if (!url) return;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try { new URL(url); } catch { return toast("That doesn't look like a valid URL.", "err"); }
  window.open(url, "_blank", "noopener,noreferrer");
}

function setFilter(f) {
  APP.filter = f;
  $$(".seg button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.filter === f)));
}


/* ==========================================================================
   Sale + profit split
   ========================================================================== */
/**
 * Work out how a sale's net profit is shared out:
 *  1. pots set to "net profit" take their % off the top,
 *  2. the rest is split business capital / personal allowance by the split rule,
 *  3. pots set to "my allowance" take their % of the allowance share.
 */
function computeSplit(net) {
  const st = APP.data.settings.split;
  if (!st.enabled || !(net > 0)) return null;
  const profitPots = [], allowancePots = [];
  let left = net;
  for (const p of APP.data.pots.filter((p) => p.auto.pct > 0 && p.auto.source === "profit")) {
    const amt = round2(Math.min(left, net * p.auto.pct / 100));
    if (amt > 0) { profitPots.push({ potId: p.id, amount: amt, from: "profit" }); left = round2(left - amt); }
  }
  const reinvest = round2(left * st.reinvestPct / 100);
  const allowance = round2(left - reinvest);
  let allowLeft = allowance;
  for (const p of APP.data.pots.filter((p) => p.auto.pct > 0 && p.auto.source === "allowance")) {
    const amt = round2(Math.min(allowLeft, allowance * p.auto.pct / 100));
    if (amt > 0) { allowancePots.push({ potId: p.id, amount: amt, from: "allowance" }); allowLeft = round2(allowLeft - amt); }
  }
  return { net, reinvest, allowance, keep: allowLeft, pots: [...profitPots, ...allowancePots] };
}

/** Replace a build's split entries in the ledger (re-running is safe: old ones are removed first). */
function applySaleSplit(b) {
  const name = b.name || "Untitled build";
  APP.data.ledger = APP.data.ledger.filter((e) => !(e.kind === "sale-split" && e.buildId === b.id));
  const sp = computeSplit(netProfit(b));
  if (!sp) { b.sale.split = null; return null; }
  const at = nowIso(), groupId = uid("g");
  const add = (e) => APP.data.ledger.push({ id: uid("t"), at, kind: "sale-split", buildId: b.id, groupId, ...e });
  if (sp.reinvest) add({ account: "capital", amount: sp.reinvest, note: `Reinvested from ${name}` });
  if (sp.allowance) add({ account: "allowance", amount: sp.allowance, note: `Allowance from ${name}` });
  for (const p of sp.pots) {
    const pot = findPot(p.potId);
    add({ account: "pot", potId: p.potId, amount: p.amount, note: `Auto-save from ${name}` });
    if (p.from === "allowance") add({ account: "allowance", potId: p.potId, amount: -p.amount, note: `Auto-saved to ${pot?.name || "pot"}` });
  }
  b.sale.split = { reinvest: sp.reinvest, allowance: sp.allowance, pots: sp.pots.map(({ potId, amount }) => ({ potId, amount })) };
  return sp;
}
const removeSaleSplit = (b) => { APP.data.ledger = APP.data.ledger.filter((e) => !(e.kind === "sale-split" && e.buildId === b.id)); };

function openSoldDialog(b) {
  APP.saleBuildId = b.id;
  const s = b.sale || {};
  const st = APP.data.settings;
  $("#soldTitle").textContent = b.status === "sold" && hasPrice(b) ? "Edit sale" : "Mark as sold";
  $("#soldBuildName").textContent = `${b.name || "Untitled build"} · build cost ${money(totalCost(b))}`;
  $("#ebayFeeLabel").textContent = `${st.ebayFeePct}% fee${st.ebayFixedFee ? ` + ${money(st.ebayFixedFee)}` : ""}`;
  $("#salePrice").value = s.price ?? s.suggestedPrice ?? "";
  $(`#soldForm input[name="channel"][value="${s.channel === "local" ? "local" : "ebay"}"]`).checked = true;
  updateBreakdown();
  openDialog($("#soldDialog"));
  $("#salePrice").focus();
  $("#salePrice").select();
}

function saleFormValues() {
  const b = findBuild(APP.saleBuildId);
  const st = APP.data.settings;
  const channel = $('#soldForm input[name="channel"]:checked').value;
  const price = round2(num($("#salePrice").value));
  const keepOld = b?.sale?.channel === "ebay" && hasPrice(b) && b.sale.feePct != null;
  const pct = channel === "ebay" ? (keepOld ? num(b.sale.feePct) : st.ebayFeePct) : 0;
  const fixed = channel === "ebay" ? (keepOld ? num(b.sale.feeFixed) : st.ebayFixedFee) : 0;
  const fee = feeFor(price, channel, pct, fixed);
  const cost = b ? totalCost(b) : 0;
  return { b, channel, price, pct, fixed, fee, cost, net: round2(price - fee - cost) };
}

function updateBreakdown() {
  const v = saleFormValues();
  $("#bdPrice").textContent = flow(v.price);
  $("#bdFeeLabel").textContent = v.channel === "ebay" ? `eBay fee (${v.pct}%${v.fixed ? ` + ${money(v.fixed)}` : ""})` : "Fees";
  $("#bdFee").textContent = flow(-v.fee);
  $("#bdCost").textContent = flow(-v.cost);
  const net = $("#bdNet");
  net.textContent = flow(v.net);
  net.className = profitCls(v.net);

  const st = APP.data.settings.split;
  const box = $("#splitPreview");
  if (!st.enabled) { box.innerHTML = `<div class="row"><span>Profit split is off</span><span class="muted">Settings → Profit split</span></div>`; return; }
  const sp = computeSplit(v.net);
  if (!sp) { box.innerHTML = `<div class="row"><span>No profit to split on this sale</span><span></span></div>`; return; }
  const rows = [`<div class="head">Profit split</div>`,
    `<div class="row"><span>Business capital (${st.reinvestPct}%)</span><span class="flow">${flow(sp.reinvest)}</span></div>`,
    `<div class="row"><span>Personal allowance (${100 - st.reinvestPct}%)</span><span class="flow">${flow(sp.allowance)}</span></div>`];
  for (const p of sp.pots) rows.push(`<div class="row"><span>→ ${esc(findPot(p.potId)?.name)} pot <small class="muted">(${p.from === "profit" ? "from profit" : "from allowance"})</small></span><span class="flow">${flow(p.amount)}</span></div>`);
  box.innerHTML = rows.join("");
}

function confirmSale() {
  const v = saleFormValues();
  if (!v.b) return;
  const prev = v.b.sale || {};
  v.b.status = "sold";
  v.b.sale = {
    ...prev, price: v.price, channel: v.channel, feePct: v.pct, feeFixed: v.fixed, fee: v.fee, netProfit: v.net,
    soldAt: prev.soldAt || nowIso(), source: prev.source || "manual", needsReview: false,
  };
  touch(v.b);
  const sp = applySaleSplit(v.b);
  render();
  scheduleSave();
  toast(sp ? `${v.b.name || "Build"} sold — net ${flow(v.net)} · ${flow(sp.keep)} to your allowance` : `${v.b.name || "Build"} sold — net ${flow(v.net)}`, v.net >= 0 ? "ok" : "err", 5000);
}


/* ==========================================================================
   Part Finder
   ========================================================================== */
function finderParams() {
  return {
    q: $("#fQuery").value.trim(),
    max: $("#fMax").value === "" ? null : round2(num($("#fMax").value)),
    conds: $$("#fConditions .chip").filter((c) => c.getAttribute("aria-pressed") === "true").map((c) => c.dataset.cond),
    bin: $("#fBin").checked,
    exact: $("#fExact").checked,
  };
}
function setFinderParams(p) {
  $("#fQuery").value = p.q || "";
  $("#fMax").value = p.max ?? "";
  $$("#fConditions .chip").forEach((c) => c.setAttribute("aria-pressed", String((p.conds || ["used", "refurbished"]).includes(c.dataset.cond))));
  $("#fBin").checked = p.bin !== false;
  $("#fExact").checked = p.exact !== false;
  updateEbayLink();
}

/** Same search on ebay.co.uk - works in every mode, even without the app. */
function ebaySearchUrl(p) {
  const words = [p.q];
  for (const w of APP.data.partFinder.excludeKeywords) words.push(w.includes(" ") ? `-"${w}"` : `-${w}`);
  const params = new URLSearchParams({ _nkw: words.join(" "), _sacat: "0", _sop: "15", LH_PrefLoc: "1", rt: "nc" });
  if (p.bin) params.set("LH_BIN", "1");
  if (p.max) params.set("_udhi", String(p.max));
  const ids = (p.conds || []).flatMap((c) => EBAY_COND_IDS[c] || []);
  if (ids.length) params.set("LH_ItemCondition", ids.join("|"));
  return `https://www.ebay.co.uk/sch/i.html?${params}`;
}
function updateEbayLink() {
  const p = finderParams();
  const a = $("#fOpenEbay");
  a.href = p.q ? ebaySearchUrl(p) : "https://www.ebay.co.uk/";
  UI.finder = p;
  saveUi();
}

function describeSearch(s) {
  const bits = [];
  if (s.max) bits.push(`≤${money(s.max)}`);
  if (s.conds?.length && s.conds.length < 3) bits.push(s.conds.map((c) => COND_LABEL[c]).join("/"));
  if (s.bin) bits.push("BIN");
  return bits.join(" · ") || "Any price";
}

function renderFinder() {
  const pf = APP.data.partFinder;
  // excluded words
  $("#excludeCount").textContent = `(${pf.excludeKeywords.length})`;
  $("#excludeTags").innerHTML = pf.excludeKeywords.map((w, i) => `<span class="tag">${esc(w)}<button type="button" data-ex-del="${i}" aria-label="Remove ${esc(w)}">${ICON.x}</button></span>`).join("") || `<span class="muted" style="font-size:12.5px">No excluded words.</span>`;
  // saved searches
  $("#savedSearches").innerHTML = pf.savedSearches.length
    ? pf.savedSearches.map((s) => `<span class="saved-chip" data-saved="${esc(s.id)}"><button type="button" class="run" data-saved-run title="Run this search"><b>${esc(s.name)}</b><small>${esc(describeSearch(s))}</small></button><button type="button" class="x" data-saved-del aria-label="Delete saved search">${ICON.x}</button></span>`).join("")
    : `<span class="muted" style="font-size:12.5px">None yet — set up a search and press <b>Save</b>.</span>`;
  $("#savedHint").textContent = pf.savedSearches.length ? "Click to re-run" : "";
  renderResults();
}

function renderResults() {
  const box = $("#finderResults");
  const F = APP.finder;
  if (F.loading) {
    box.innerHTML = `<div class="results">${Array.from({ length: 4 }, () => `<div class="result"><div class="thumb skel"></div><div style="display:grid;gap:8px"><div class="skel" style="height:12px;width:40%"></div><div class="skel" style="height:14px;width:85%"></div><div class="skel" style="height:12px;width:55%"></div></div><div class="skel" style="height:34px;width:110px"></div></div>`).join("")}</div>`;
    return;
  }
  if (F.error) {
    box.innerHTML = `<div class="notice err"><p>${esc(F.error)}</p><a class="btn sm" href="${esc(ebaySearchUrl(F.params || finderParams()))}" target="_blank" rel="noopener noreferrer">Open this search on eBay ↗</a></div>`;
    return;
  }
  const r = F.result;
  if (!r) {
    box.innerHTML = `<div class="empty"><h3>Find the cheapest exact part</h3><p>Type a part like “Ryzen 5 3600”, set a max price and hit <b>Find cheapest</b>.<br>Listings mentioning your excluded words are hidden automatically.</p></div>`;
    return;
  }
  const meta = `<div class="results-meta"><span><b style="color:var(--text)">${r.results.length}</b> cheapest of ${r.matches} matching listing${r.matches === 1 ? "" : "s"}</span>${r.hiddenExcluded ? `<span>${r.hiddenExcluded} hidden by excluded words</span>` : ""}${r.hiddenOther ? `<span>${r.hiddenOther} didn't match your filters</span>` : ""}<span>via ${esc(r.source)}${r.cached ? " (cached)" : ""}</span><a href="${esc(r.searchUrl)}" target="_blank" rel="noopener noreferrer" style="color:var(--green);margin-left:auto">See all on eBay ↗</a></div>`;
  if (!r.results.length) {
    box.innerHTML = meta + `<div class="empty"><h3>No listings match</h3><p>Try a higher max price, more conditions, or turn off exact match.</p></div>`;
    return;
  }
  box.innerHTML = meta + `<div class="results">${r.results.map((it, i) => `
    <div class="result ${i === 0 ? "best" : ""} enter" style="--i:${i}" data-result="${i}">
      <div class="thumb">${it.image ? `<img src="${esc(it.image)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : ICON.cpu}</div>
      <div style="min-width:0">
        <span class="rank">${i === 0 ? "CHEAPEST" : `#${i + 1}`}</span>
        <a class="title" href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" title="${esc(it.title)}">${esc(it.title)}</a>
        <div class="meta">${it.condition ? `<span>${esc(it.condition)}</span>` : ""}<span>${it.buyItNow ? "Buy It Now" : "Auction"}</span><span>${money(it.price)} + ${it.postage == null ? "postage not shown" : it.postage === 0 ? "free postage" : `${money(it.postage)} postage`}</span></div>
      </div>
      <div class="price">
        <div class="total money">${money(it.total)}</div>
        <button class="btn soft sm" type="button" data-add-result="${i}">${ICON.plus} Add to active build</button>
      </div>
    </div>`).join("")}</div>`;
}

async function runFinderSearch(p = finderParams()) {
  if (!p.q || p.q.length < 2) { $("#fQuery").focus(); return toast("Type a part to search for, e.g. Ryzen 5 3600.", "err"); }
  updateEbayLink();
  APP.finder.params = p;
  if (!EDIT || !sb) return;
  Object.assign(APP.finder, { loading: true, error: "", result: null });
  renderResults();
  try {
    const { data, error } = await sb.functions.invoke("part-finder", {
      body: { q: p.q, max: p.max, conds: p.conds, bin: p.bin, exact: p.exact, exclude: APP.data.partFinder.excludeKeywords, limit: 5 },
    });
    if (error) throw new Error(await fnError(error));
    APP.finder.result = data;
  } catch (e) {
    APP.finder.error = e.message;
  }
  APP.finder.loading = false;
  renderResults();
}

async function saveCurrentSearch() {
  const p = finderParams();
  if (!p.q) { $("#fQuery").focus(); return toast("Type a part first, then save it.", "err"); }
  const name = await promptBox("Save search", "Name for this preset", p.q);
  if (!name) return;
  APP.data.partFinder.savedSearches.push({ id: uid("s"), name, ...p });
  renderFinder();
  scheduleSave();
  toast(`Saved “${name}”`, "ok");
}

function addResultToBuild(result, anchor) {
  const item = () => ({ id: uid("i"), description: result.title, cost: result.total, url: result.url, source: "part-finder" });
  const done = (b) => {
    anchor.classList.add("done");
    anchor.innerHTML = `✓ Added to ${esc(b.name || "build")}`;
    toast(`Added to “${b.name || "Untitled build"}” — ${flow(-result.total)}`, "ok");
  };
  const active = activeBuilds().sort((a, b) => ts(b.updatedAt) - ts(a.updatedAt));
  const items = active.map((b) => ({ html: `<span>${esc(b.name || "Untitled build")}</span><small>${flow(-totalCost(b))}</small>`, run: () => { const it = item(); addItem(b, it); done(b); } }));
  items.push({ sep: true });
  items.push({ html: `<span>+ New build with this part</span>`, run: () => { const b = newBuild(item()); toast(`Started “${b.name}” with this part`, "ok"); } });
  openMenu(anchor, active.length ? "Add to active build" : "No active builds yet", items);
}


/* ==========================================================================
   Money tab: bank, allowance, pots, ledger
   ========================================================================== */
function renderMoney(animate = false) {
  const st = APP.data.settings.split;
  const f = APP.data.finance;
  // Bank tracker
  const pending = round2(activeBuilds().reduce((s, b) => s + totalCost(b), 0));
  const bankEl = $("#bankBalance");
  if (document.activeElement !== bankEl) bankEl.value = f.bankBalance == null ? "" : f.bankBalance.toFixed(2);
  $("#bankUpdated").textContent = f.bankUpdatedAt ? `Updated ${rel(f.bankUpdatedAt)}` : "Type your current balance";
  setNum($("#pendingExp"), flow(-pending), "v money flow");
  $("#pendingSub").textContent = `${activeBuilds().length} active build${activeBuilds().length === 1 ? "" : "s"}`;
  const free = round2(num(f.bankBalance) - pending);
  setNum($("#freeCash"), f.bankBalance == null ? "—" : money(free), `v money ${balanceCls(free)}`);

  // Allowance
  const avail = allowanceAvailable();
  setNum($("#allowAvail"), money(avail), `v money ${balanceCls(avail)}`);
  setNum($("#allowEarned"), flow(allowanceEarned()), "v money flow");
  setNum($("#allowWithdrawn"), flow(-allowanceWithdrawn()), "v money flow");
  setNum($("#allowToPots"), flow(-allowanceToPots()), "v money flow");
  setNum($("#capitalReinvested"), flow(capitalReinvested()), "v money flow");
  $("#splitChip").innerHTML = st.enabled ? `Split <b style="color:var(--blue)">${st.reinvestPct}%</b> business · <b style="color:var(--green)">${100 - st.reinvestPct}%</b> you` : "Profit split: off";
  $("#splitBiz").style.width = `${st.enabled ? st.reinvestPct : 0}%`;
  $("#splitYou").style.width = `${st.enabled ? 100 - st.reinvestPct : 0}%`;

  renderPots(animate);
  renderLedger(animate);
}

function renderPots(animate) {
  const pots = APP.data.pots;
  $("#pots").innerHTML = pots.map((p, i) => {
    const bal = potBalance(p.id);
    const pct = p.target > 0 ? clamp(Math.round((bal / p.target) * 100), 0, 100) : 0;
    const reached = p.target > 0 && bal >= p.target;
    const auto = p.auto.pct > 0 ? `Auto-saves ${p.auto.pct}% of ${p.auto.source === "profit" ? "net profit" : "your allowance"} on each sale` : "No auto-contribution";
    return `<article class="pot ${reached ? "reached" : ""} ${animate ? "enter" : ""}" data-pot="${esc(p.id)}" style="--i:${i}">
      <div class="pot-img">${p.image ? `<img src="${esc(p.image)}" alt="${esc(p.name)}" loading="lazy" referrerpolicy="no-referrer">` : ""}
        <div class="ph"><div>${ICON.image}${p.image ? "Picture couldn't load — edit to replace it" : "Add a picture of your goal"}</div></div>
        ${reached ? `<span class="badge sold goal">🎉 Goal reached</span>` : ""}
      </div>
      <div class="pot-body">
        <div class="pot-head"><h4 title="${esc(p.name)}">${esc(p.name)}</h4><button class="icon-btn" type="button" data-pot-act="edit" aria-label="Edit pot">${ICON.edit}</button></div>
        <div class="pot-amounts"><span class="bal money ${balanceCls(bal)}">${money(bal)}</span><span class="of">of ${money(p.target)}</span><span class="pct">${pct}%</span></div>
        <div class="bar" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100" aria-label="${esc(p.name)} progress"><span style="width:${pct}%;${animate ? "" : "animation:none"}"></span></div>
        <div class="pot-meta">${p.auto.pct > 0 ? ICON.pot.replace("<svg", '<svg style="width:13px;height:13px;color:var(--green)"') : ""}${esc(auto)}</div>
        <div class="pot-actions">
          <button class="btn soft sm" type="button" data-pot-act="deposit">${ICON.plus} Deposit</button>
          <button class="btn sm" type="button" data-pot-act="withdraw" ${bal > 0 ? "" : "disabled"}>${ICON.minus} Withdraw</button>
        </div>
      </div>
    </article>`;
  }).join("") + `<button class="pot new-pot ${animate ? "enter" : ""}" type="button" id="newPotTile" style="--i:${pots.length}"><div>${ICON.plus}<b>New savings pot</b><br><small>Name it, set a target, add a picture</small></div></button>`;
}

function ledgerRows() {
  const rows = [];
  // Sales come from the builds themselves (+ money in).
  for (const b of APP.data.builds.filter(hasPrice)) {
    rows.push({ at: b.sale.soldAt, icon: ICON.bag, title: `Sold ${b.name || "Untitled build"}`, sub: `${b.sale.channel === "ebay" ? "eBay" : "Local / Cash"} · net ${flow(netProfit(b))}`, amount: +b.sale.price, del: null });
  }
  // Ledger entries, grouped so a transfer shows once.
  const groups = new Map();
  for (const e of APP.data.ledger) {
    const k = e.groupId && e.kind !== "sale-split" ? e.groupId : e.id;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(e);
  }
  for (const [key, es] of groups) {
    const e = es.find((x) => x.account === "pot") || es[0];
    const pot = e.potId ? findPot(e.potId) : null;
    const potName = pot?.name || "deleted pot";
    let title = e.note || "", sub = "", icon = e.amount >= 0 ? ICON.down : ICON.up;
    if (e.kind === "sale-split" && e.account === "capital") { title = "Reinvested into business"; sub = e.note; }
    else if (e.kind === "sale-split" && e.account === "allowance" && e.amount > 0) { title = "Personal allowance"; sub = e.note; }
    else if (e.kind === "sale-split" && e.account === "allowance") { title = `From allowance to ${potName}`; sub = "Auto-contribution"; }
    else if (e.kind === "sale-split" && e.account === "pot") { title = `Auto-saved into ${potName}`; sub = e.note; icon = ICON.pot; }
    else if (e.kind === "withdrawal") { title = "Personal withdrawal"; sub = e.note || "From personal allowance"; }
    else if (e.kind === "deposit") { title = `Deposit into ${potName}`; sub = [e.note, es.length > 1 ? "from personal allowance" : ""].filter(Boolean).join(" · ") || "Manual deposit"; icon = ICON.pot; }
    else if (e.kind === "pot-withdraw") { title = `Withdrawal from ${potName}`; sub = [e.note, es.length > 1 ? "back to personal allowance" : ""].filter(Boolean).join(" · ") || "Manual withdrawal"; icon = ICON.pot; }
    else if (e.kind === "pot-closed") { title = `Closed pot ${e.potName || potName}`; sub = "Balance returned to personal allowance"; icon = ICON.pot; }
    const manual = ["withdrawal", "deposit", "pot-withdraw"].includes(e.kind);
    rows.push({ at: e.at, icon, title, sub, amount: e.amount, del: manual ? key : null });
  }
  return rows.sort((a, b) => ts(b.at) - ts(a.at));
}

function renderLedger(animate = false) {
  const rows = ledgerRows().slice(0, 60);
  $("#ledger").innerHTML = rows.length ? rows.map((r, i) => `
    <div class="ledger-row ${animate ? "enter" : ""}" style="animation-delay:${Math.min(i, 10) * 25}ms">
      <div class="ic">${r.icon}</div>
      <div class="what"><b>${esc(r.title)}</b><small>${esc(r.sub || "")}${r.sub ? " · " : ""}${niceDate(r.at)}</small></div>
      <div class="amt money flow">${flow(r.amount)}</div>
      ${r.del ? `<button class="icon-btn" type="button" data-ledger-del="${esc(r.del)}" aria-label="Undo this entry" title="Undo this entry">${ICON.x}</button>` : "<span></span>"}
    </div>`).join("") : `<div class="empty" style="border:0;padding:36px 12px"><h3>No money moves yet</h3><p style="margin:0">Mark a build as sold and your profit split appears here.</p></div>`;
}

/* ---------- Withdrawals & deposits ---------- */
function logPersonalWithdrawal() {
  const avail = allowanceAvailable();
  moneyBox({
    title: "Log personal withdrawal", sub: `Available personal balance: ${money(avail)}`, sign: "−", ok: "Log withdrawal",
    onOk: ({ amount, note }) => {
      if (amount > avail + 0.001) return `That's more than your available balance (${money(avail)}).`;
      APP.data.ledger.push({ id: uid("t"), at: nowIso(), account: "allowance", amount: -amount, kind: "withdrawal", note });
      afterMoneyChange(`Withdrawal logged — ${flow(-amount)}`);
    },
  });
}

function potDeposit(pot) {
  const avail = allowanceAvailable();
  moneyBox({
    title: `Deposit into ${pot.name}`, sub: `Pot balance: ${money(potBalance(pot.id))} of ${money(pot.target)}`, sign: "+", ok: "Deposit",
    check: { label: `Take it from my personal allowance (${money(avail)} available)`, checked: avail > 0 },
    onOk: ({ amount, note, checked }) => {
      if (checked && amount > avail + 0.001) return `Your allowance only has ${money(avail)}. Untick the box to deposit money from elsewhere.`;
      const groupId = uid("g"), at = nowIso();
      APP.data.ledger.push({ id: uid("t"), at, groupId, account: "pot", potId: pot.id, amount, kind: "deposit", note });
      if (checked) APP.data.ledger.push({ id: uid("t"), at, groupId, account: "allowance", amount: -amount, kind: "deposit", note: `Moved to ${pot.name}` });
      afterMoneyChange(`${flow(amount)} into ${pot.name}`);
    },
  });
}

function potWithdraw(pot) {
  const bal = potBalance(pot.id);
  moneyBox({
    title: `Withdraw from ${pot.name}`, sub: `Pot balance: ${money(bal)}`, sign: "−", ok: "Withdraw",
    check: { label: "Put it back into my personal allowance", checked: false },
    onOk: ({ amount, note, checked }) => {
      if (amount > bal + 0.001) return `The pot only has ${money(bal)}.`;
      const groupId = uid("g"), at = nowIso();
      APP.data.ledger.push({ id: uid("t"), at, groupId, account: "pot", potId: pot.id, amount: -amount, kind: "pot-withdraw", note });
      if (checked) APP.data.ledger.push({ id: uid("t"), at, groupId, account: "allowance", amount, kind: "pot-withdraw", note: `Back from ${pot.name}` });
      afterMoneyChange(`${flow(-amount)} from ${pot.name}`);
    },
  });
}

function afterMoneyChange(msg) {
  renderMoney();
  scheduleSave();
  if (msg) toast(msg, "ok");
}

/* ---------- Savings pot dialog ---------- */
const POT_FORM = { id: null, image: "" };
function openPotDialog(pot) {
  POT_FORM.id = pot?.id || null;
  POT_FORM.image = pot?.image || "";
  $("#potTitle").textContent = pot ? "Edit savings pot" : "New savings pot";
  $("#potSave").textContent = pot ? "Save pot" : "Create pot";
  $("#potDelete").hidden = !pot;
  $("#potName").value = pot?.name || "";
  $("#potTarget").value = pot?.target || "";
  $("#potUrl").value = pot?.image && !pot.image.startsWith("data:") ? pot.image : "";
  $("#potAutoPct").value = pot?.auto?.pct || "";
  $("#potAutoSource").value = pot?.auto?.source || "allowance";
  $("#potError").textContent = "";
  renderPotImage();
  openDialog($("#potDialog"));
  $("#potName").focus();
}
function renderPotImage() {
  const drop = $("#potDrop");
  $$("img, .clear", drop).forEach((el) => el.remove());
  $("#potDropText").hidden = !!POT_FORM.image;
  if (POT_FORM.image) {
    drop.insertAdjacentHTML("beforeend", `<img src="${esc(POT_FORM.image)}" alt="" referrerpolicy="no-referrer"><button class="icon-btn clear" type="button" id="potImgClear" aria-label="Remove picture">${ICON.x}</button>`);
    $("img", drop).addEventListener("error", () => { $("#potError").textContent = "That image couldn't be loaded. Check the URL or choose a file."; });
  }
}
/** Shrink an image file to ≤720px wide JPEG so the JSON file stays small. */
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith("image/")) return reject(new Error("That file isn't an image."));
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, 720 / img.naturalWidth);
      const c = document.createElement("canvas");
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.82));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image.")); };
    img.src = url;
  });
}
async function setPotImageFile(file) {
  try { POT_FORM.image = await fileToDataUrl(file); $("#potUrl").value = ""; $("#potError").textContent = ""; renderPotImage(); }
  catch (e) { $("#potError").textContent = e.message; }
}
function savePot() {
  const name = $("#potName").value.trim();
  const target = round2(num($("#potTarget").value));
  if (!name || target <= 0) { $("#potError").textContent = "Give the pot a name and a target above £0."; return false; }
  const pct = clamp(num($("#potAutoPct").value), 0, 100);
  const source = $("#potAutoSource").value;
  let pot = POT_FORM.id && findPot(POT_FORM.id);
  if (!pot) { pot = { id: uid("p"), createdAt: nowIso() }; APP.data.pots.push(pot); }
  Object.assign(pot, { name, target, image: POT_FORM.image, auto: { pct, source }, updatedAt: nowIso() });
  afterMoneyChange(POT_FORM.id ? "Pot saved" : `Created “${name}” pot`);
  renderPots(false);
  return true;
}
async function deletePot() {
  const pot = findPot(POT_FORM.id);
  if (!pot) return;
  const bal = potBalance(pot.id);
  const ok = await confirmBox("Delete pot?", bal > 0 ? `“${pot.name}” has ${money(bal)} in it. That money goes back into your personal allowance.` : `“${pot.name}” will be removed.`, "Delete pot");
  if (!ok) return;
  if (bal > 0) {
    const groupId = uid("g"), at = nowIso();
    APP.data.ledger.push({ id: uid("t"), at, groupId, account: "pot", potId: pot.id, potName: pot.name, amount: -bal, kind: "pot-closed", note: "" });
    APP.data.ledger.push({ id: uid("t"), at, groupId, account: "allowance", amount: bal, kind: "pot-closed", potName: pot.name, note: `Back from ${pot.name}` });
  }
  APP.data.pots = APP.data.pots.filter((p) => p.id !== pot.id);
  closeDialog($("#potDialog"), "deleted");
  afterMoneyChange(`Deleted “${pot.name}”`);
}


/* ==========================================================================
   Settings
   ========================================================================== */
async function openSettings() {
  if (!EDIT) return openLogin();
  const st = APP.data.settings;
  $("#setCurrency").value = st.currency;
  $("#setFee").value = st.ebayFeePct;
  $("#setFixed").value = st.ebayFixedFee || "";
  $("#setSplitOn").checked = st.split.enabled;
  $("#setSplit").value = st.split.reinvestPct;
  updateSplitLegend();
  renderCheckerBlock();
  openDialog($("#settingsDialog"));
  await renderAccountBlock();
}
function updateSplitLegend() {
  const v = num($("#setSplit").value);
  $("#setSplitBiz").textContent = `${v}%`;
  $("#setSplitYou").textContent = `${100 - v}%`;
  $("#splitControls").style.opacity = $("#setSplitOn").checked ? "1" : ".45";
}
async function renderAccountBlock() {
  const el = $("#accountBlock");
  let mfaOn = false;
  try { const { data } = await sb.auth.mfa.listFactors(); mfaOn = !!data?.totp?.some((f) => f.status === "verified"); } catch { /* ignore */ }
  el.innerHTML = `<h3>Account &amp; security</h3>
    <p>Signed in as <b style="color:var(--text)">${esc(APP.userEmail || "editor")}</b>. Edit mode locks itself after 30 minutes without activity.</p>
    <div class="btn-row">
      ${mfaOn ? `<span class="badge sold">✓ Two-step verification on</span><button class="btn sm" type="button" data-acc="mfa-off">Turn off</button>`
              : `<button class="btn soft sm" type="button" data-acc="mfa-on">Set up two-step verification</button>`}
      <button class="btn sm" type="button" data-acc="password">Change password</button>
      <button class="btn sm" type="button" data-acc="lock">Lock (sign out)</button>
    </div>`;
}
function renderCheckerBlock() {
  const w = APP.data.worker || {};
  const notif = "Notification" in window ? Notification.permission : "unsupported";
  $("#checkerBlock").innerHTML = `<h3>eBay sold-listing checker</h3>
    <p>Runs in the cloud every ${num(w.intervalMin) || 15} minutes${w.lastRun ? ` · last run ${rel(w.lastRun)}` : " · hasn't run yet"}. Sold listings are flagged on the Builds tab for you to confirm the price.</p>
    <div class="btn-row">
      <button class="btn sm" type="button" data-chk="now">Check listings now</button>
      ${notif === "granted" ? `<span class="badge sold">✓ Desktop alerts on (while the site is open)</span>`
        : notif === "denied" ? `<span class="muted" style="font-size:12px">Desktop alerts are blocked in this browser's site settings.</span>`
        : notif === "default" ? `<button class="btn sm" type="button" data-chk="notify">Turn on desktop alerts</button>` : ""}
    </div>
    <p style="font-size:12px">Part Finder eBay API keys and email alerts are set as secrets on the cloud functions — see the setup guide.</p>`;
}
async function checkListingsNow(btn) {
  if (btn) { btn.disabled = true; btn.textContent = "Checking…"; }
  try {
    const { data, error } = await sb.functions.invoke("ebay-check", { body: { source: "manual" } });
    if (error) throw new Error(await fnError(error));
    toast(`Checked ${data.checked} listing${data.checked === 1 ? "" : "s"}${data.soldNow?.length ? ` · 🎉 ${data.soldNow.length} sold` : " · nothing new"}`, "ok", 6000);
  } catch (e) { toast(`Check failed: ${e.message}`, "err", 7000); }
  finally { if (btn) { btn.disabled = false; btn.textContent = "Check listings now"; } renderCheckerBlock(); }
}
/** Pull a readable message out of a cloud-function error. */
async function fnError(error) {
  try { const body = await error.context?.json?.(); if (body?.error) return body.error; } catch { /* not JSON */ }
  return error.message || "The cloud function didn't answer.";
}
function saveSettings() {
  const st = APP.data.settings;
  st.currency = $("#setCurrency").value.trim() || "£";
  const fee = parseFloat($("#setFee").value);
  st.ebayFeePct = Number.isFinite(fee) ? clamp(fee, 0, 100) : 13;
  st.ebayFixedFee = round2(clamp(num($("#setFixed").value), 0, 100));
  st.split = { enabled: $("#setSplitOn").checked, reinvestPct: clamp(num($("#setSplit").value), 0, 100) };
  render();
  scheduleSave();
}

function exportJson() {
  prepareForSave(APP.data);
  const blob = new Blob([JSON.stringify(APP.data, null, 2)], { type: "application/json" });
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: DATA_FILENAME });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
async function importJson(file) {
  try {
    const data = normalize(JSON.parse(await file.text()));
    const ok = await confirmBox("Import data?", `This replaces your current ${APP.data.builds.length} build(s), money records and pots with the contents of “${file.name}” (${data.builds.length} build(s)).`, "Replace");
    if (!ok) return;
    const now = nowIso();
    data.builds.forEach((b) => (b.updatedAt = now)); // newest copy wins the merge
    data.worker = APP.data.worker;
    APP.data = data;
    APP.seenCards.clear();
    render();
    scheduleSave();
    toast(`Imported ${data.builds.length} build(s).`, "ok");
  } catch (e) { toast(`Import failed: ${e.message}`, "err"); }
}



/* ==========================================================================
   Dialog, menu & toast helpers (animated open/close)
   ========================================================================== */
function openDialog(dlg) {
  dlg.classList.remove("closing");
  dlg.returnValue = "";
  if (!dlg.open) dlg.showModal();
}
function closeDialog(dlg, value = "cancel") {
  if (!dlg.open || dlg.classList.contains("closing")) return;
  const done = () => { dlg.classList.remove("closing"); dlg.close(value); };
  if (REDUCED_MOTION) return done();
  dlg.classList.add("closing");
  setTimeout(done, 165);
}
/** Wire a dialog: submit → handler (return false to stay open), Esc / backdrop click → animated close. */
function setupDialog(dlg, onSubmit) {
  const form = $("form", dlg);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const v = e.submitter?.value || "ok";
    if (v === "cancel") return closeDialog(dlg, "cancel");
    const keepOpen = onSubmit ? (await onSubmit(v)) === false : false;
    if (!keepOpen) closeDialog(dlg, v);
  });
  dlg.addEventListener("cancel", (e) => { e.preventDefault(); closeDialog(dlg, "cancel"); });
  dlg.addEventListener("mousedown", (e) => { if (e.target === dlg) closeDialog(dlg, "cancel"); });
}

function confirmBox(title, text, okLabel = "Confirm") {
  const dlg = $("#confirmDialog");
  $("#confirmTitle").textContent = title;
  $("#confirmText").textContent = text;
  $("#confirmOk").textContent = okLabel;
  openDialog(dlg);
  return new Promise((resolve) => dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok"), { once: true }));
}
function promptBox(title, label, value = "") {
  const dlg = $("#promptDialog");
  $("#promptTitle").textContent = title;
  $("#promptLabel").textContent = label;
  $("#promptInput").value = value;
  openDialog(dlg);
  $("#promptInput").select();
  return new Promise((resolve) => dlg.addEventListener("close", () => resolve(dlg.returnValue === "ok" ? $("#promptInput").value.trim() : null), { once: true }));
}

let MONEY_CB = null;
function moneyBox({ title, sub, sign, ok, check, onOk }) {
  $("#moneyTitle").textContent = title;
  $("#moneySub").textContent = sub || "";
  $("#moneySign").textContent = `${sign}${cur()}`;
  $("#moneyOk").textContent = ok;
  $("#moneyAmount").value = "";
  $("#moneyNote").value = "";
  $("#moneyError").textContent = "";
  $("#moneyCheckWrap").hidden = !check;
  if (check) { $("#moneyCheckLabel").textContent = check.label; $("#moneyCheck").checked = !!check.checked; }
  MONEY_CB = onOk;
  openDialog($("#moneyDialog"));
  $("#moneyAmount").focus();
}

let MENU_ITEMS = [];
function openMenu(anchor, heading, items) {
  const menu = $("#menu");
  MENU_ITEMS = items;
  menu.innerHTML = `<div class="mh">${esc(heading)}</div>` + items.map((it, i) => (it.sep ? "<hr>" : `<button type="button" role="menuitem" data-menu="${i}">${it.html}</button>`)).join("");
  const r = anchor.getBoundingClientRect();
  menu.style.visibility = "hidden";
  menu.classList.add("open");
  const mw = menu.offsetWidth, mh = menu.offsetHeight;
  const left = clamp(r.right - mw, 8, innerWidth - mw - 8);
  const below = r.bottom + 6 + mh < innerHeight;
  menu.style.left = `${left}px`;
  menu.style.top = `${below ? r.bottom + 6 : r.top - mh - 6}px`;
  menu.style.transformOrigin = below ? "top right" : "bottom right";
  menu.classList.remove("open");
  menu.style.visibility = "";
  requestAnimationFrame(() => { menu.classList.add("open"); $("button", menu)?.focus({ preventScroll: true }); });
}
const closeMenu = () => $("#menu").classList.remove("open");

function toast(msg, kind = "", ms = 3500) {
  const el = Object.assign(document.createElement("div"), { className: `toast ${kind}`, textContent: msg });
  $("#toasts").appendChild(el);
  setTimeout(() => { el.classList.add("leaving"); setTimeout(() => el.remove(), 230); }, ms);
}


/* ==========================================================================
   Events
   ========================================================================== */
function bindEvents() {
  const grid = $("#grid");

  /* ---- Builds ---- */
  grid.addEventListener("input", (e) => {
    if (!EDIT) return;
    const card = e.target.closest(".card");
    const b = card && findBuild(card.dataset.id);
    if (!b) return;
    const field = e.target.dataset.field, ifield = e.target.dataset.ifield;
    if (field) {
      b[field] = e.target.value;
      if (field === "ebayUrl") $('[data-act="view"]', card).disabled = !e.target.value.trim();
    } else if (ifield) {
      const item = b.items.find((i) => i.id === e.target.closest("[data-item]").dataset.item);
      if (!item) return;
      item[ifield] = ifield === "cost" ? round2(num(e.target.value)) : e.target.value;
      if (ifield === "cost") fitCost(e.target);
    } else return;
    touch(b);
    refreshCardNumbers(card, b);
    renderStats();
    scheduleSave();
  });
  grid.addEventListener("focusout", (e) => {
    if (e.target.dataset.ifield === "cost" && e.target.value !== "") { e.target.value = num(e.target.value).toFixed(2); fitCost(e.target); }
  });
  grid.addEventListener("keydown", (e) => {
    if (!EDIT || e.key !== "Enter" || !e.target.dataset.ifield) return;
    e.preventDefault();
    const card = e.target.closest(".card"), row = e.target.closest("[data-item]");
    const b = findBuild(card.dataset.id);
    if (e.target.dataset.ifield === "description") { $('[data-ifield="cost"]', row).focus(); return; }
    if (!row.nextElementSibling) { const it = addItem(b); $(`[data-item="${CSS.escape(it.id)}"] [data-ifield="description"]`)?.focus(); }
    else $('[data-ifield="description"]', row.nextElementSibling).focus();
  });
  grid.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-act]");
    if (!btn) return;
    if (btn.dataset.act === "new-build") return newBuild();
    const card = btn.closest(".card");
    const b = card && findBuild(card.dataset.id);
    if (!b) return;
    if (!EDIT && !["toggle", "view"].includes(btn.dataset.act)) return;   // view mode: look, don't touch
    switch (btn.dataset.act) {
      case "toggle":
        APP.collapsed.has(b.id) ? APP.collapsed.delete(b.id) : APP.collapsed.add(b.id);
        saveUi();
        card.classList.toggle("collapsed");
        btn.setAttribute("aria-expanded", String(!APP.collapsed.has(b.id)));
        break;
      case "add-item": {
        const it = addItem(b);
        $(`[data-item="${CSS.escape(it.id)}"] [data-ifield="description"]`)?.focus();
        break;
      }
      case "del-item": {
        const row = btn.closest("[data-item]");
        b.items = b.items.filter((i) => i.id !== row.dataset.item);
        touch(b);
        if (!REDUCED_MOTION) { row.style.transition = "opacity .18s, transform .18s"; row.style.opacity = "0"; row.style.transform = "translateX(8px)"; await new Promise((r) => setTimeout(r, 170)); }
        row.remove();
        if (!b.items.length) $("tbody", card).innerHTML = `<tr><td colspan="3" class="empty-items">No items yet.</td></tr>`;
        refreshCardNumbers(card, b);
        renderStats();
        scheduleSave();
        break;
      }
      case "view": openListing(b); break;
      case "mark-sold": openSoldDialog(b); break;
      case "revert":
        if (await confirmBox("Revert to active?", `“${b.name || "Untitled build"}” goes back to active. Its sale details and profit split (allowance, capital and pot contributions) are removed.`, "Revert")) {
          b.status = "active"; b.sale = null; touch(b);
          removeSaleSplit(b);
          render(); scheduleSave();
        }
        break;
      case "delete":
        if (await confirmBox("Delete build?", `“${b.name || "Untitled build"}” and its ${b.items.length} item(s) will be removed. Money already split from it stays in your records.`, "Delete")) {
          if (!REDUCED_MOTION) { card.style.transition = "opacity .2s, transform .2s"; card.style.opacity = "0"; card.style.transform = "scale(.97)"; await new Promise((r) => setTimeout(r, 190)); }
          APP.data.builds = APP.data.builds.filter((x) => x.id !== b.id);
          render(); scheduleSave();
        }
        break;
    }
  });

  $("#newBuildBtn").addEventListener("click", () => newBuild());
  addEventListener("focus", refreshIfIdle);
  $("#settingsBtn").addEventListener("click", openSettings);
  $("#storagePill").addEventListener("click", () => (EDIT ? openSettings() : openLogin()));
  $("#workerPill").addEventListener("click", () => toast($("#workerPill").title, "", 6000));
  $$(".seg button").forEach((b) => b.addEventListener("click", () => { setFilter(b.dataset.filter); APP.seenCards.clear(); renderGrid(); }));
  $("#search").addEventListener("input", (e) => { APP.query = e.target.value; renderGrid(); });

  /* ---- Tabs ---- */
  $$(".tab").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));
  $("#tabs").addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight"].includes(e.key)) return;
    const tabs = $$(".tab"), i = tabs.findIndex((t) => t.getAttribute("aria-selected") === "true");
    const next = tabs[(i + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
    setTab(next.dataset.tab); next.focus();
  });
  addEventListener("resize", moveIndicator);

  /* ---- Sold dialog ---- */
  setupDialog($("#soldDialog"), (v) => { if (v === "confirm") confirmSale(); });
  $("#soldForm").addEventListener("input", updateBreakdown);

  /* ---- Settings dialog ---- */
  setupDialog($("#settingsDialog"), (v) => { if (v === "save") saveSettings(); });
  $("#setSplit").addEventListener("input", updateSplitLegend);
  $("#setSplitOn").addEventListener("change", updateSplitLegend);
  $("#exportBtn").addEventListener("click", exportJson);
  $("#importBtn").addEventListener("click", () => $("#importFile").click());
  $("#importFile").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) importJson(f); e.target.value = ""; });

  /* ---- Confirm / prompt / money dialogs ---- */
  setupDialog($("#confirmDialog"));
  setupDialog($("#promptDialog"));
  setupDialog($("#moneyDialog"), (v) => {
    if (v !== "ok" || !MONEY_CB) return;
    const amount = round2(num($("#moneyAmount").value));
    if (!(amount > 0)) { $("#moneyError").textContent = "Enter an amount above £0."; return false; }
    const err = MONEY_CB({ amount, note: $("#moneyNote").value.trim(), checked: $("#moneyCheck").checked });
    if (err) { $("#moneyError").textContent = err; return false; }
  });

  /* ---- Part Finder ---- */
  $("#finderForm").addEventListener("submit", (e) => { e.preventDefault(); runFinderSearch(); });
  $("#finderForm").addEventListener("input", updateEbayLink);
  $("#fConditions").addEventListener("click", (e) => {
    const c = e.target.closest(".chip");
    if (!c) return;
    c.setAttribute("aria-pressed", String(c.getAttribute("aria-pressed") !== "true"));
    updateEbayLink();
  });
  $("#fSave").addEventListener("click", saveCurrentSearch);
  $("#excludeToggle").addEventListener("click", (e) => {
    const open = e.currentTarget.getAttribute("aria-expanded") !== "true";
    e.currentTarget.setAttribute("aria-expanded", String(open));
    $("#excludeCollapse").classList.toggle("closed", !open);
    if (open) setTimeout(() => $("#excludeInput").focus(), 200);
  });
  const addExclude = () => {
    const words = $("#excludeInput").value.split(",").map((w) => w.trim().toLowerCase()).filter(Boolean);
    const list = APP.data.partFinder.excludeKeywords;
    for (const w of words) if (!list.includes(w)) list.push(w);
    $("#excludeInput").value = "";
    renderFinder(); updateEbayLink(); scheduleSave();
  };
  $("#excludeAdd").addEventListener("click", addExclude);
  $("#excludeInput").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addExclude(); } });
  $("#excludeTags").addEventListener("click", (e) => {
    const i = e.target.closest("[data-ex-del]")?.dataset.exDel;
    if (i == null) return;
    APP.data.partFinder.excludeKeywords.splice(+i, 1);
    renderFinder(); updateEbayLink(); scheduleSave();
  });
  $("#savedSearches").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-saved]");
    if (!chip) return;
    const s = APP.data.partFinder.savedSearches.find((x) => x.id === chip.dataset.saved);
    if (!s) return;
    if (e.target.closest("[data-saved-del]")) {
      APP.data.partFinder.savedSearches = APP.data.partFinder.savedSearches.filter((x) => x.id !== s.id);
      renderFinder(); scheduleSave();
      toast(`Removed “${s.name}”`);
      return;
    }
    setFinderParams(s);
    runFinderSearch(finderParams());
  });
  $("#finderResults").addEventListener("error", (e) => { if (e.target.tagName === "IMG") e.target.replaceWith(Object.assign(document.createElement("span"), { innerHTML: ICON.cpu })); }, true);
  $("#finderResults").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-add-result]");
    if (!btn || btn.classList.contains("done")) return;
    const r = APP.finder.result?.results?.[+btn.dataset.addResult];
    if (r) addResultToBuild(r, btn);
  });

  /* ---- Money ---- */
  $("#bankBalance").addEventListener("input", (e) => {
    const f = APP.data.finance;
    f.bankBalance = e.target.value === "" ? null : round2(num(e.target.value));
    f.bankUpdatedAt = nowIso();
    renderMoney();
    scheduleSave();
  });
  $("#bankBalance").addEventListener("blur", (e) => { if (e.target.value !== "") e.target.value = num(e.target.value).toFixed(2); });
  $("#withdrawBtn").addEventListener("click", logPersonalWithdrawal);
  $("#splitChip").addEventListener("click", openSettings);
  $("#newPotBtn").addEventListener("click", () => openPotDialog());
  $("#pots").addEventListener("click", (e) => {
    if (e.target.closest("#newPotTile")) return openPotDialog();
    const btn = e.target.closest("[data-pot-act]");
    const pot = btn && findPot(btn.closest("[data-pot]").dataset.pot);
    if (!pot) return;
    ({ edit: openPotDialog, deposit: potDeposit, withdraw: potWithdraw })[btn.dataset.potAct](pot);
  });
  $("#pots").addEventListener("error", (e) => { if (e.target.tagName === "IMG") e.target.closest(".pot-img")?.classList.add("broken"); }, true);
  $("#ledger").addEventListener("click", async (e) => {
    const key = e.target.closest("[data-ledger-del]")?.dataset.ledgerDel;
    if (!key) return;
    if (!(await confirmBox("Undo this entry?", "The money goes back where it came from.", "Undo"))) return;
    APP.data.ledger = APP.data.ledger.filter((x) => x.id !== key && x.groupId !== key);
    afterMoneyChange("Entry removed");
  });

  /* ---- Pot dialog ---- */
  setupDialog($("#potDialog"), (v) => (v === "save" ? savePot() : undefined));
  $("#potDelete").addEventListener("click", deletePot);
  $("#potFileBtn").addEventListener("click", () => $("#potFile").click());
  $("#potFile").addEventListener("change", (e) => { const f = e.target.files[0]; if (f) setPotImageFile(f); e.target.value = ""; });
  $("#potUrl").addEventListener("change", (e) => {
    const url = e.target.value.trim();
    if (url && !/^https?:\/\//i.test(url)) { $("#potError").textContent = "Image URLs should start with https://"; return; }
    POT_FORM.image = url; $("#potError").textContent = ""; renderPotImage();
  });
  $("#potDrop").addEventListener("click", (e) => {
    if (e.target.closest("#potImgClear")) { POT_FORM.image = ""; $("#potUrl").value = ""; renderPotImage(); return; }
    if (!POT_FORM.image) $("#potFile").click();
  });
  ["dragenter", "dragover"].forEach((t) => $("#potDrop").addEventListener(t, (e) => { e.preventDefault(); $("#potDrop").classList.add("drag"); }));
  ["dragleave", "drop"].forEach((t) => $("#potDrop").addEventListener(t, () => $("#potDrop").classList.remove("drag")));
  $("#potDrop").addEventListener("drop", (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) return setPotImageFile(f);
    const url = e.dataTransfer.getData("text/uri-list") || e.dataTransfer.getData("text/plain");
    if (/^https?:\/\//i.test(url)) { POT_FORM.image = url.trim(); $("#potUrl").value = url.trim(); renderPotImage(); }
  });
  $("#potDialog").addEventListener("paste", (e) => {
    const file = [...(e.clipboardData?.files || [])].find((f) => f.type.startsWith("image/"));
    if (file) { e.preventDefault(); setPotImageFile(file); }
  });

  /* ---- Menu ---- */
  $("#menu").addEventListener("click", (e) => {
    const i = e.target.closest("[data-menu]")?.dataset.menu;
    if (i == null) return;
    closeMenu();
    MENU_ITEMS[+i]?.run();
  });
  document.addEventListener("mousedown", (e) => { if (!e.target.closest("#menu") && !e.target.closest("[data-add-result]")) closeMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  addEventListener("scroll", closeMenu, { passive: true });
}


/* ==========================================================================
   Start-up
   ========================================================================== */
function bindAuthEvents() {
  $("#gateView").addEventListener("click", () => {
    const remember = $("#gateRemember").checked;
    if (!remember) localStorage.removeItem(MODE_KEY);
    enterView({ remember });
  });
  $("#gateEdit").addEventListener("click", openLogin);
  $("#editBtn").addEventListener("click", openLogin);
  $("#lockBtn").addEventListener("click", () => lock("Locked — you're in view-only mode."));

  setupDialog($("#loginDialog"), (v) => (v === "ok" ? doLogin() : undefined));
  $("#forgotBtn").addEventListener("click", sendReset);
  setupDialog($("#mfaDialog"), (v) => (v === "ok" ? verifyMfa() : undefined));
  $("#mfaDialog").addEventListener("close", async () => {
    if ($("#mfaDialog").returnValue !== "cancel") return;
    await sb.auth.signOut();
    if (!document.body.classList.contains("view")) showGate();
  });
  setupDialog($("#enrollDialog"), (v) => (v === "ok" ? finishEnroll() : undefined));
  $("#enrollDialog").addEventListener("close", () => {
    if ($("#enrollDialog").returnValue === "cancel" && ENROLL.factorId) sb.auth.mfa.unenroll({ factorId: ENROLL.factorId }).catch(() => {});
    ENROLL.factorId = null;
  });
  setupDialog($("#pwDialog"), (v) => (v === "ok" ? saveNewPassword() : undefined));

  $("#accountBlock").addEventListener("click", (e) => {
    const a = e.target.closest("[data-acc]")?.dataset.acc;
    if (a === "mfa-on") startEnroll();
    if (a === "mfa-off") disableMfa();
    if (a === "password") openNewPassword("Change password");
    if (a === "lock") { closeDialog($("#settingsDialog")); lock("Locked — you're in view-only mode."); }
  });
  $("#checkerBlock").addEventListener("click", async (e) => {
    const a = e.target.closest("[data-chk]");
    if (!a) return;
    if (a.dataset.chk === "now") checkListingsNow(a);
    if (a.dataset.chk === "notify") { await Notification.requestPermission(); renderCheckerBlock(); }
  });
}

async function init() {
  APP.data = normalize(safeJson(localStorage.getItem(LS_KEY), null) || {});
  bindEvents();
  bindAuthEvents();
  if (UI.finder) setFinderParams(UI.finder); else updateEbayLink();

  // Refuse to run with the SECRET key - it would bypass every database rule.
  const key = String(CFG.supabaseKey || "");
  let role = "";
  try { role = JSON.parse(atob(key.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).role || ""; } catch { /* not a JWT */ }
  if (/^sb_secret_/i.test(key) || role === "service_role") {
    render();
    showSetupNeeded();
    $("#gateSetup").innerHTML = `<p style="color:var(--red)"><b>Stop: config.js contains your SECRET key.</b></p><p>That key bypasses every security rule and must never be on a website. Replace it with the <b>publishable</b> key (sb_publishable_…) or the <b>anon</b> key, then go to Supabase → Project Settings → API Keys and <b>rotate/regenerate the secret key</b>, because it has been exposed.</p>`;
    return;
  }

  if (!isConfigured() || !window.supabase?.createClient) {
    render();
    showSetupNeeded();
    if (isConfigured()) $("#gateSetup p").textContent = "Couldn't load the Supabase library. Check your internet connection and refresh.";
    return;
  }
  sb = window.supabase.createClient(CFG.supabaseUrl, CFG.supabaseKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });

  let recovering = location.hash.includes("type=recovery");
  sb.auth.onAuthStateChange((event) => {
    if (event === "PASSWORD_RECOVERY") { recovering = true; hideGate(); openNewPassword("Set a new password"); }
    if (event === "SIGNED_OUT" && EDIT && !APP.locking) enterView({ remember: false });
  });
  trackActivity();
  addEventListener("visibilitychange", () => { if (!document.hidden) refreshIfIdle(); });
  setInterval(renderWorkerPill, 30000);
  setInterval(refreshIfIdle, 120000);

  render();
  const { data: { session } } = await sb.auth.getSession();
  if (recovering) return;
  if (session) {
    if (await needsSecondStep()) { showGate(); openMfa(); return; }
    const { data: ok } = await sb.rpc("is_editor");
    if (ok === true) { await enterEdit(); return; }
    await sb.auth.signOut();
  }
  if (localStorage.getItem(MODE_KEY) === "view") { await enterView(); return; }
  showGate();
}

init();
