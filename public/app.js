/* Garagenverwaltung – Frontend */
(() => {
  "use strict";

  /* ================= Daten & Speichern ================= */
  const LOCAL_KEY = "garagenverwaltung-db";
  const emptyDb = () => ({
    settings: {
      name: "Florian Simon Dubiel",
      strasse: "Nordstr. 5 a",
      plzOrt: "06711 Theißen",
      telefon: "",
      email: "",
      kontoinhaber: "Florian Dubiel",
      bank: "DKB",
      iban: "",
      bic: "",
      ort: "Theißen",
      sigVermieter: null,
    },
    vermieter: [],
    standorte: [],
    garagen: [],
    mieter: [],
    vertraege: [],
    zahlungen: {},
    warteliste: [],
    seq: 0,
  });

  let db = emptyDb();
  let version = 0;
  let mode = "server";
  let saveTimer = null;

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
  const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const eur = (n) => Number(n || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR" });
  const dfmt = (iso) => (iso ? Docs.d(iso) : "");
  const isoDate = (dt) => `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
  const today = () => isoDate(new Date());
  const addDays = (iso, n) => { const dt = new Date(iso + "T12:00"); dt.setDate(dt.getDate() + n); return isoDate(dt); };
  const monthKey = (iso) => iso.slice(0, 7);
  const monthName = (key) => {
    const [y, m] = key.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  };
  const addMonths = (key, n) => {
    const [y, m] = key.split("-").map(Number);
    const dt = new Date(y, m - 1 + n, 1);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}`;
  };
  const num = (v) => { const n = parseFloat(String(v ?? "").replace(",", ".")); return isNaN(n) ? 0 : n; };
  // Monatliche Gesamtzahlung des Mieters (Miete + Nebenkostenpauschale)
  const gesamt = (v) => num(v.miete) + num(v.nebenkosten);
  const mKurz = (k) => { const [y, m] = k.split("-"); return `${m}.${y}`; };
  const fmtPct = (x) => (x * 100).toLocaleString("de-DE", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + " %";

  function setSync(text, err = false) {
    const el = $("#syncState");
    el.textContent = text;
    el.classList.toggle("err", err);
  }

  async function load() {
    try {
      const r = await fetch("/api/db", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status);
      const doc = await r.json();
      version = doc.version || 0;
      db = Object.assign(emptyDb(), doc.data || {});
      db.settings = Object.assign(emptyDb().settings, db.settings || {});
      mode = "server";
      setSync(doc.savedAt ? `Gespeichert ${new Date(doc.savedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}` : "Online");
    } catch (e) {
      mode = "local";
      try {
        const raw = localStorage.getItem(LOCAL_KEY);
        if (raw) db = Object.assign(emptyDb(), JSON.parse(raw));
      } catch (_) { /* */ }
      setSync("Lokaler Modus (nur dieser Browser)", true);
    }
  }

  let pending = false, saving = false, konflikt = false;
  function save() {
    clearTimeout(saveTimer);
    pending = true;
    setSync("Speichert …");
    saveTimer = setTimeout(doSave, 400);
  }
  // Vor dem Schließen warnen, falls noch nicht gespeichert
  window.addEventListener("beforeunload", (e) => { if (pending || saving) { e.preventDefault(); e.returnValue = ""; } });
  // Beim Zurückkehren zur App neuesten Stand vom Server holen (z. B. Änderungen vom Handy)
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState !== "visible" || mode !== "server" || pending || saving || konflikt) return;
    try {
      const r = await fetch("/api/db", { cache: "no-store" });
      const doc = await r.json();
      if (doc.version > version && doc.data) {
        version = doc.version;
        db = Object.assign(emptyDb(), doc.data);
        db.settings = Object.assign(emptyDb().settings, db.settings || {});
        if (!modal.open) rerender();
        toast("Neuester Stand geladen");
      }
    } catch (_) { /* offline */ }
  });

  async function doSave() {
    if (saving) { saveTimer = setTimeout(doSave, 300); return; }
    pending = false;
    if (mode === "local") {
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(db)); setSync("Lokal gespeichert"); }
      catch (e) { setSync("Speichern fehlgeschlagen", true); }
      return;
    }
    saving = true;
    try {
      const body = JSON.stringify({ version, data: db });
      const r = await fetch("/api/db", { method: "PUT", headers: { "Content-Type": "application/json" }, body });
      if (r.status === 409) {
        const res = await r.json().catch(() => ({}));
        saving = false;
        return konfliktLoesen(res.current);
      }
      if (r.status === 413) throw new Error("zu groß");
      if (!r.ok) throw new Error(r.status);
      const res = await r.json();
      version = res.version;
      konflikt = false;
      setSync("Gespeichert " + new Date(res.savedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }));
    } catch (e) {
      pending = true;
      setSync("NICHT gespeichert – bitte Verbindung prüfen", true);
      toast(e.message === "zu groß" ? "Speichern fehlgeschlagen: Datenmenge zu groß" : "Speichern fehlgeschlagen – nächster Versuch in 10 Sekunden");
      clearTimeout(saveTimer);
      saveTimer = setTimeout(doSave, 10000);
    }
    saving = false;
  }

  // Anderes Gerät/Tab hat zwischenzeitlich gespeichert
  function konfliktLoesen(current) {
    if (konflikt) return;
    konflikt = true;
    setSync("Konflikt – bitte entscheiden", true);
    const zeit = current?.savedAt ? new Date(current.savedAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" }) : "kürzlich";
    openModal("Auf einem anderen Gerät wurde gespeichert", `
      <p>Die Daten wurden am <b>${esc(zeit)}</b> auf einem anderen Gerät oder in einem anderen Browser-Tab geändert. Deine letzte Änderung hier ist deshalb <b>noch nicht gespeichert</b>.</p>
      <p><b>Meinen Stand speichern</b> – übernimmt alles so, wie du es hier gerade siehst (inkl. deiner letzten Änderung). Änderungen vom anderen Gerät seit dem letzten Laden gehen dabei verloren.</p>
      <p><b>Anderen Stand laden</b> – zeigt den Stand vom anderen Gerät. Deine letzte Änderung hier musst du dann noch einmal machen.</p>
      <p class="hint">Tipp: Die App nur auf einem Gerät gleichzeitig bearbeiten, oder vorher neu laden.</p>`,
      [{ label: "Anderen Stand laden", onClick: () => {
          konflikt = false; pending = false;
          if (current?.data) { version = current.version; db = Object.assign(emptyDb(), current.data); db.settings = Object.assign(emptyDb().settings, db.settings || {}); }
          setSync("Stand vom anderen Gerät geladen"); rerender();
        } },
       { label: "Meinen Stand speichern", cls: "primary", onClick: () => {
          konflikt = false;
          if (current) version = current.version;
          save();
        } }]);
  }

  /* ================= Abgeleitete Werte ================= */
  const standortById = (id) => db.standorte.find((s) => s.id === id) || { name: "?", adresse: "" };
  const garageById = (id) => db.garagen.find((g) => g.id === id);
  const mieterById = (id) => db.mieter.find((m) => m.id === id);
  // Vermieter einer Garage: eigenes Profil (Einstellungen) oder anderer Eigentümer
  function vermieterFuer(g) {
    const fremd = g && g.vermieterId && (db.vermieter || []).find((x) => x.id === g.vermieterId);
    if (fremd) return Object.assign({ kleinunternehmer: true, sigVermieter: null, ort: db.settings.ort }, fremd);
    return Object.assign({ kleinunternehmer: true }, db.settings);
  }
  const istEigen = (g) => !g?.vermieterId;
  const vermieterName = (g) => (istEigen(g) ? "Ich" : vermieterFuer(g).name);
  function kostenJahr(g) {
    return num(g.pachtJahr) + num(g.grundsteuerJahr) + num(g.beitragJahr) + num(g.sonstigeJahr) + 12 * num(g.hausgeldMonat);
  }
  const hatKosten = (g) => ["pachtJahr", "grundsteuerJahr", "beitragJahr", "sonstigeJahr", "hausgeldMonat"].some((k) => g[k] !== undefined && g[k] !== "");
  const mieterName = (m) => (m ? `${m.vorname || ""} ${m.nachname || ""}`.trim() : "–");
  const laufenderVertrag = (gid) => db.vertraege.find((v) => v.garageId === gid && (v.status === "aktiv" || v.status === "gekuendigt"));
  function garageStatus(g) {
    const v = laufenderVertrag(g.id);
    if (!v) return "frei";
    return v.status === "gekuendigt" ? "gekuendigt" : "vermietet";
  }
  const statusLabel = { frei: "frei", vermietet: "vermietet", gekuendigt: "gekündigt", aktiv: "aktiv", beendet: "beendet" };
  const sortGaragen = (a, b) =>
    standortById(a.standortId).name.localeCompare(standortById(b.standortId).name, "de") ||
    String(a.nummer).localeCompare(String(b.nummer), "de", { numeric: true });

  // Monate, für die Miete fällig ist (ab "Zahlungen erfasst ab" bzw. Beginn bis heute bzw. Vertragsende)
  function faelligeMonate(v) {
    const start = v.zahlungenAb || monthKey(v.beginn || today());
    let end = monthKey(today());
    if (new Date().getDate() <= 5) end = addMonths(end, -1); // laufender Monat erst nach dem 3. Werktag fällig
    if (v.status !== "aktiv" && v.endeZum) {
      const e = monthKey(v.endeZum);
      if (e < end) end = e;
    }
    const out = [];
    for (let k = start; k <= end; k = addMonths(k, 1)) out.push(k);
    return out;
  }
  const bezahlt = (vid, key) => !!db.zahlungen[vid]?.[key];
  const offeneMonate = (v) => faelligeMonate(v).filter((k) => !bezahlt(v.id, k));

  // Kündigungstermin: Zugang bis 3. Werktag eines Monats -> Ende des übernächsten Monats
  function feiertag(dt) {
    const md = `${dt.getMonth() + 1}-${dt.getDate()}`;
    return ["1-1", "5-1", "10-3", "12-25", "12-26"].includes(md);
  }
  function kuendigungZum(zugangIso) {
    const z = new Date(zugangIso + "T12:00");
    let werktage = 0, dritter = null;
    for (let day = 1; day <= 10; day++) {
      const dt = new Date(z.getFullYear(), z.getMonth(), day, 12);
      if (dt.getDay() !== 0 && !feiertag(dt)) { werktage++; if (werktage === 3) { dritter = day; break; } }
    }
    const plus = z.getDate() <= dritter ? 3 : 4;
    return isoDate(new Date(z.getFullYear(), z.getMonth() + plus, 0, 12));
  }

  /* ================= UI-Helfer ================= */
  function toast(msg) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove("show"), 2400);
  }

  const modal = $("#modal");
  function openModal(title, body, actions, onOpen) {
    $("#modalTitle").textContent = title;
    $("#modalBody").innerHTML = body;
    const box = $("#modalActions");
    box.innerHTML = "";
    actions.forEach((a) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn " + (a.cls || "");
      b.textContent = a.label;
      b.onclick = async () => {
        if (a.onClick) {
          const keepOpen = await a.onClick();
          if (keepOpen === false) return;
        }
        modal.close();
      };
      box.appendChild(b);
    });
    if (!modal.open) modal.showModal();
    if (onOpen) onOpen($("#modalBody"));
    const first = $("#modalBody input, #modalBody select, #modalBody textarea");
    if (first && !first.readOnly) first.focus();
  }
  function alertModal(title, text) {
    openModal(title, `<p>${esc(text)}</p>`, [{ label: "OK", cls: "primary" }]);
  }
  function confirmModal(title, text, onYes, yesLabel = "Löschen") {
    openModal(title, `<p>${esc(text)}</p>`, [
      { label: "Abbrechen" },
      { label: yesLabel, cls: "primary", onClick: onYes },
    ]);
  }
  // Formularwerte lesen
  function formValues(root) {
    const o = {};
    $$("[name]", root).forEach((el) => {
      o[el.name] = el.type === "checkbox" ? el.checked : el.value.trim();
    });
    return o;
  }
  const field = (name, label, value = "", { type = "text", full = false, attrs = "", hint = "" } = {}) =>
    `<label class="f${full ? " full" : ""}">${esc(label)}<input name="${name}" type="${type}" value="${esc(value)}" ${attrs}>${hint ? `<span class="hint">${esc(hint)}</span>` : ""}</label>`;
  const area = (name, label, value = "", { full = true, rows = 3 } = {}) =>
    `<label class="f${full ? " full" : ""}">${esc(label)}<textarea name="${name}" rows="${rows}">${esc(value)}</textarea></label>`;
  const select = (name, label, options, value, { full = false } = {}) =>
    `<label class="f${full ? " full" : ""}">${esc(label)}<select name="${name}">${options
      .map(([v, l]) => `<option value="${esc(v)}" ${String(v) === String(value) ? "selected" : ""}>${esc(l)}</option>`)
      .join("")}</select></label>`;
  const check = (name, label, checked) =>
    `<label class="f check full"><input type="checkbox" name="${name}" ${checked ? "checked" : ""}> ${esc(label)}</label>`;

  function downloadPdf(doc, filename) {
    doc.save(filename.replace(/[^\wäöüÄÖÜß .\-]/g, "_"));
  }
  function downloadText(text, filename, type) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  /* ================= Unterschriftenfeld ================= */
  function signaturePad(canvas, initial) {
    const ctx = canvas.getContext("2d");
    let drawing = false, dirty = false, last = null;
    function resize() {
      const r = canvas.getBoundingClientRect();
      canvas.width = Math.round(r.width * 2);
      canvas.height = Math.round(r.height * 2);
      ctx.lineWidth = 4.2;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.strokeStyle = "#13235b";
      if (initial) {
        const img = new Image();
        img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        img.src = initial;
        dirty = true;
      }
    }
    const pos = (e) => {
      const r = canvas.getBoundingClientRect();
      return { x: (e.clientX - r.left) * (canvas.width / r.width), y: (e.clientY - r.top) * (canvas.height / r.height) };
    };
    canvas.addEventListener("pointerdown", (e) => { drawing = true; dirty = true; last = pos(e); canvas.setPointerCapture(e.pointerId); ctx.beginPath(); ctx.arc(last.x, last.y, 1.5, 0, 7); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); });
    canvas.addEventListener("pointermove", (e) => {
      if (!drawing) return;
      const p = pos(e);
      ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke();
      last = p;
    });
    ["pointerup", "pointercancel", "pointerleave"].forEach((t) => canvas.addEventListener(t, () => (drawing = false)));
    requestAnimationFrame(resize);
    return {
      clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); dirty = false; initial = null; },
      load(src) { this.clear(); if (!src) return; const img = new Image(); img.onload = () => ctx.drawImage(img, 0, 0, canvas.width, canvas.height); img.src = src; dirty = true; },
      value() {
        if (!dirty) return null;
        const c = document.createElement("canvas");
        c.width = 600; c.height = 200;
        c.getContext("2d").drawImage(canvas, 0, 0, 600, 200);
        return c.toDataURL("image/png");
      },
    };
  }

  /* ================= Router ================= */
  let current = "uebersicht";
  const views = {};
  function show(view) {
    current = view;
    $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
    views[view]();
    try { localStorage.setItem("gv-tab", view); } catch (_) { /* */ }
  }
  const rerender = () => views[current]();
  function commit() { save(); rerender(); }

  /* ================= Übersicht / Dashboard ================= */
  const kurzMonat = (k) => { const [y, m] = k.split("-").map(Number); return new Date(y, m - 1, 1).toLocaleDateString("de-DE", { month: "short" }).replace(".", "") + (m === 1 ? " " + String(y).slice(2) : ""); };
  const eur0 = (n) => Number(n || 0).toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
  function niceMax(v) {
    if (v <= 0) return 100;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    for (const f of [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (f * p >= v) return f * p;
    return 10 * p;
  }
  // Fällige Miete eines Vertrags in Monat k (0, wenn noch nicht/nicht mehr laufend)
  function sollImMonat(v, k) {
    const start = v.zahlungenAb || monthKey(v.beginn || "2000-01-01");
    if (k < start) return 0;
    if (v.beginn && monthKey(v.beginn) > k) return 0;
    if (v.status !== "aktiv" && v.endeZum && monthKey(v.endeZum) < k) return 0;
    return gesamt(v);
  }

  function saeulen(daten) {
    const klein = window.innerWidth < 640;
    const W = klein ? 360 : 640, H = klein ? 220 : 230, ml = 46, mr = 8, mt = 12, mb = 28;
    const iw = W - ml - mr, ih = H - mt - mb;
    const max = niceMax(Math.max(...daten.map((d) => Math.max(d.soll, d.ist))));
    const y = (v) => mt + ih - (v / max) * ih;
    const band = iw / daten.length;
    const bw = Math.min(24, band * 0.5);
    let svg = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Mieteingänge pro Monat">`;
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, yy = y(v);
      svg += `<line x1="${ml}" x2="${W - mr}" y1="${yy}" y2="${yy}" class="grid"/><text x="${ml - 8}" y="${yy + 4}" class="tick" text-anchor="end">${eur0(v).replace(/\s?€/, "")}</text>`;
    }
    daten.forEach((d, i) => {
      const cx = ml + band * i + band / 2;
      const top = y(d.ist), h = mt + ih - top;
      if (h > 0.5) {
        const r = Math.min(4, h, bw / 2);
        svg += `<path class="bar" d="M${cx - bw / 2},${mt + ih} V${top + r} Q${cx - bw / 2},${top} ${cx - bw / 2 + r},${top} H${cx + bw / 2 - r} Q${cx + bw / 2},${top} ${cx + bw / 2},${top + r} V${mt + ih} Z"/>`;
      }
      if (d.soll > 0) svg += `<line x1="${cx - bw / 2 - 6}" x2="${cx + bw / 2 + 6}" y1="${y(d.soll)}" y2="${y(d.soll)}" class="soll"/>`;
      svg += `<text x="${cx}" y="${H - 8}" class="tick" text-anchor="middle">${esc(kurzMonat(d.k))}</text>`;
      const quote = d.soll ? Math.round((d.ist / d.soll) * 100) : 0;
      svg += `<rect x="${ml + band * i}" y="${mt}" width="${band}" height="${ih}" class="hit" data-tip="${esc(`<b>${monthName(d.k)}</b><br>Eingegangen: ${eur(d.ist)}<br>Soll: ${eur(d.soll)}${d.soll ? ` (${quote} %)` : ""}${d.laufend ? "<br><i>Monat läuft noch</i>" : ""}`)}"/>`;
    });
    return svg + "</svg>";
  }

  function hbalken(rows) {
    const max = Math.max(...rows.map((r) => r.wert), 1);
    return `<div class="hbars">${rows.map((r) => `
      <div class="hrow" data-tip="${esc(`<b>${esc(r.label)}</b><br>${r.tip}`)}">
        <div class="hlabel" title="${esc(r.label)}">${esc(r.label)}</div>
        <div class="htrack"><div class="hfill" style="width:${Math.max(1, (r.wert / max) * 100)}%"></div><span class="hval">${eur0(r.wert)}</span></div>
      </div>`).join("")}</div>`;
  }

  function meter(anteil, art = "") {
    return `<div class="meter ${art}"><div style="width:${Math.max(0, Math.min(100, anteil * 100))}%"></div></div>`;
  }

  views.uebersicht = () => {
    const gs = db.garagen;
    if (!gs.length) {
      $("#view").innerHTML = `<h1>Übersicht</h1><div class="panel empty">Noch keine Garagen angelegt.<br><br><button class="btn primary" id="goGaragen">Standort &amp; Garagen anlegen</button></div>`;
      $("#goGaragen").onclick = () => show("garagen");
      return;
    }
    const km = monthKey(today());
    const eigen = gs.filter(istEigen);
    const laufend = db.vertraege.filter((v) => v.status === "aktiv" || v.status === "gekuendigt");
    const laufEigen = laufend.filter((v) => istEigen(garageById(v.garageId)));
    const sollEigen = laufEigen.reduce((s, v) => s + gesamt(v), 0);
    const sollFremd = laufend.reduce((s, v) => s + gesamt(v), 0) - sollEigen;
    const kostenMonat = eigen.reduce((s, g) => s + kostenJahr(g), 0) / 12;
    const ueberschuss = sollEigen - kostenMonat;
    const st = { frei: 0, vermietet: 0, gekuendigt: 0 };
    gs.forEach((g) => st[garageStatus(g)]++);
    const belegt = st.vermietet + st.gekuendigt;
    // offene Mieten
    const offen = laufend.concat(db.vertraege.filter((v) => v.status === "beendet" && v.endeZum && v.endeZum >= addDays(today(), -180)))
      .map((v) => ({ v, ks: offeneMonate(v) })).filter((x) => x.ks.length)
      .map((x) => ({ ...x, betrag: x.ks.length * gesamt(x.v) })).sort((a, b) => b.betrag - a.betrag);
    const offenSumme = offen.reduce((s, x) => s + x.betrag, 0);
    // laufender Monat
    const sollJetzt = db.vertraege.reduce((s, v) => s + sollImMonat(v, km), 0);
    const istJetzt = db.vertraege.reduce((s, v) => s + (bezahlt(v.id, km) ? gesamt(v) : 0), 0);
    // Rendite
    const mitKp = eigen.filter((g) => num(g.kaufpreis) > 0);
    const kpSumme = mitKp.reduce((s, g) => s + num(g.kaufpreis), 0);
    const rendite = kpSumme ? mitKp.reduce((s, g) => { const v = laufenderVertrag(g.id); return s + (v ? gesamt(v) * 12 : 0) - kostenJahr(g); }, 0) / kpSumme : null;
    // Verlauf: ab erstem erfassten Monat, max. 12 Monate
    const startK = db.vertraege.map((v) => v.zahlungenAb).filter(Boolean).sort()[0] || km;
    let von = addMonths(km, -11);
    if (von < startK) von = startK;
    const verlauf = [];
    for (let k = von; k <= km; k = addMonths(k, 1)) {
      verlauf.push({ k, laufend: k === km, soll: db.vertraege.reduce((s, v) => s + sollImMonat(v, k), 0), ist: db.vertraege.reduce((s, v) => s + (bezahlt(v.id, k) ? gesamt(v) : 0), 0) });
    }
    // Einnahmen je Standort
    const proStandort = db.standorte.map((s) => {
      const vs = laufend.filter((v) => garageById(v.garageId)?.standortId === s.id);
      const n = gs.filter((g) => g.standortId === s.id).length;
      return { label: s.name, wert: vs.reduce((a, v) => a + gesamt(v), 0), tip: `${vs.length} von ${n} Garagen vermietet<br>${eur(vs.reduce((a, v) => a + gesamt(v), 0))} pro Monat` };
    }).filter((r) => r.wert > 0).sort((a, b) => b.wert - a.wert);
    const standortRows = proStandort.slice(0, 10);
    const standortRest = proStandort.slice(10);
    const auszuege = db.vertraege.filter((v) => v.status === "gekuendigt").sort((a, b) => (a.endeZum || "").localeCompare(b.endeZum || ""));
    const offenePunkte = gs.filter((g) => /OFFEN:/.test(g.notiz || "")).length;
    const leerVerlust = gs.filter((g) => garageStatus(g) === "frei").reduce((s, g) => s + num(g.miete) + num(g.nebenkosten), 0);
    const pct = (a) => Math.round(a * 100) + " %";
    const gName = (v) => { const g = garageById(v.garageId) || {}; return `${standortById(g.standortId).name}${g.nummer && !/^o\./.test(g.nummer) ? " · " + g.nummer : ""}`; };

    $("#view").innerHTML = `
    <div class="dash-head">
      <div><h1>Übersicht</h1><p class="sub">${new Date().toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p></div>
      <div class="toolbar" style="margin:0"><button class="btn" id="dImport">Kontoauszug einlesen</button><button class="btn primary" id="quickV">+ Neuer Mietvertrag</button></div>
    </div>
    <div class="dash">
      <section class="card hero span-5">
        <div class="lbl">Überschuss pro Monat</div>
        <div class="hero-val">${eur0(ueberschuss)}</div>
        <div class="hero-sub">${eur0(sollEigen)} Mieteinnahmen − ${eur0(kostenMonat)} Kosten · ${eigen.length} eigene Garagen</div>
        <div class="hero-sub muted">${eur0(ueberschuss * 12)} im Jahr${sollFremd ? ` · zusätzlich ${eur0(sollFremd)}/Monat für andere Eigentümer` : ""}</div>
      </section>
      <section class="card kpi span-7">
        <div class="kpis">
          <div><div class="lbl">Auslastung</div><div class="kval">${pct(belegt / gs.length)}</div>${meter(belegt / gs.length)}<div class="ksub">${belegt} von ${gs.length} vermietet</div></div>
          <div><div class="lbl">Eingang ${monthName(km).split(" ")[0]}</div><div class="kval">${eur0(istJetzt)}</div>${meter(sollJetzt ? istJetzt / sollJetzt : 0)}<div class="ksub">von ${eur0(sollJetzt)} Soll</div></div>
          <div><div class="lbl">Offene Mieten</div><div class="kval">${eur0(offenSumme)}</div><div class="status ${offenSumme ? "bad" : "good"}">${offenSumme ? `⚠ ${offen.length} Mieter im Rückstand` : "✓ alles bezahlt"}</div></div>
          <div><div class="lbl">Rendite</div><div class="kval">${rendite === null ? "–" : pct(rendite)}</div><div class="ksub">${mitKp.length ? `auf Kaufpreis (${mitKp.length} Garagen)` : "Kaufpreise fehlen"}</div></div>
        </div>
      </section>

      <section class="card span-8">
        <div class="card-head"><h2>Mieteingänge</h2><div class="legend2"><span class="k-bar"></span>Eingegangen <span class="k-soll"></span>Soll</div></div>
        ${verlauf.length >= 1 ? saeulen(verlauf) : ""}
        ${verlauf.length < 3 ? `<p class="hint">Zahlungen werden seit ${monthName(startK)} erfasst. Mit jedem eingelesenen Kontoauszug wächst der Verlauf.</p>` : ""}
      </section>
      <section class="card span-4">
        <div class="card-head"><h2>Belegung</h2></div>
        <div class="stack">${[["vermietet", st.vermietet], ["gekuendigt", st.gekuendigt], ["frei", st.frei]].filter(([, n]) => n).map(([k, n]) => `<div class="seg ${k}" style="flex:${n}" data-tip="${esc(`<b>${statusLabel[k]}</b>: ${n} Garagen`)}"></div>`).join("")}</div>
        <ul class="leg">
          <li><span class="sw vermietet"></span>Vermietet<b>${st.vermietet}</b></li>
          <li><span class="sw gekuendigt"></span>Gekündigt<b>${st.gekuendigt}</b></li>
          <li><span class="sw frei"></span>Frei<b>${st.frei}</b></li>
        </ul>
        <div class="mini">
          <div><span>Leerstand kostet</span><b>${eur0(leerVerlust)}/Monat</b></div>
          <div><span>Warteliste</span><b>${db.warteliste.length}</b></div>
          <div><span>Offene Punkte in Notizen</span><b>${offenePunkte}</b></div>
        </div>
      </section>

      <section class="card span-6">
        <div class="card-head"><h2>Einnahmen je Standort</h2><span class="meta">pro Monat</span></div>
        ${standortRows.length ? hbalken(standortRows) : '<p class="hint">Noch keine laufenden Verträge.</p>'}
        ${standortRest.length ? `<p class="hint" data-tip="${esc(standortRest.map((r) => `${esc(r.label)}: ${eur(r.wert)}`).join("<br>"))}">+ ${standortRest.length} weitere Standorte mit zusammen ${eur0(standortRest.reduce((a, r) => a + r.wert, 0))} pro Monat</p>` : ""}
      </section>
      <section class="card span-6">
        <div class="card-head"><h2>Rückstände</h2>${offen.length ? `<button class="btn small" id="toPay">Zu den Mieteingängen</button>` : ""}</div>
        ${offen.length ? `<table class="compact"><tbody>${offen.slice(0, 8).map((x) => `<tr data-brief="${x.v.id}" style="cursor:pointer"><td><b>${esc(mieterName(mieterById(x.v.mieterId)))}</b><div class="hint" style="margin:0">${esc(gName(x.v))}</div></td><td>${x.ks.map(mKurz).join(", ")}</td><td class="num"><b>${eur(x.betrag)}</b></td></tr>`).join("")}</tbody></table>${offen.length > 8 ? `<p class="hint">+ ${offen.length - 8} weitere</p>` : ""}`
          : '<p class="good-note">✓ Keine Rückstände.</p>'}
        ${auszuege.length ? `<h3>Anstehende Auszüge</h3><table class="compact"><tbody>${auszuege.map((v) => `<tr><td><b>${esc(mieterName(mieterById(v.mieterId)))}</b><div class="hint" style="margin:0">${esc(gName(v))}</div></td><td class="num">zum ${dfmt(v.endeZum)}</td><td class="act"><button class="btn small" data-end="${v.id}">Rückgabe erledigt</button></td></tr>`).join("")}</tbody></table>` : ""}
      </section>
    </div>`;
    $("#quickV").onclick = () => schnellVertrag();
    $("#dImport").onclick = () => show("zahlungen");
    if ($("#toPay")) $("#toPay").onclick = () => show("zahlungen");
    $$("[data-end]").forEach((b) => (b.onclick = () => vertragBeenden(b.dataset.end)));
    $$("tr[data-brief]").forEach((tr) => (tr.onclick = () => briefForm(tr.dataset.brief)));
  };

  // Tooltip für Diagramme (Maus und Touch)
  (() => {
    const tip = document.createElement("div");
    tip.id = "tip";
    document.body.appendChild(tip);
    const hide = () => (tip.style.opacity = 0);
    const showTip = (e) => {
      const el = e.target.closest && e.target.closest("[data-tip]");
      if (!el) return hide();
      tip.innerHTML = el.dataset.tip;
      tip.style.opacity = 1;
      const x = Math.min(e.clientX + 14, window.innerWidth - tip.offsetWidth - 8);
      const y = e.clientY - tip.offsetHeight - 12 < 4 ? e.clientY + 16 : e.clientY - tip.offsetHeight - 12;
      tip.style.left = x + "px"; tip.style.top = y + "px";
      $$(".hit.on, .hrow.on").forEach((n) => n.classList.remove("on"));
      el.classList.add("on");
    };
    document.addEventListener("pointermove", showTip);
    document.addEventListener("pointerdown", showTip);
    document.addEventListener("scroll", hide, true);
  })();

  /* ================= Löschen (mit allem, was dazugehört) ================= */
  function loeschDialog({ titel, garagen = [], mieterIds = [], hinweis = "", onDone }) {
    const gids = new Set(garagen.map((g) => g.id));
    const vs = db.vertraege.filter((v) => gids.has(v.garageId) || mieterIds.includes(v.mieterId));
    const vids = new Set(vs.map((v) => v.id));
    const laufend = vs.filter((v) => v.status !== "beendet");
    const zahlungen = vs.reduce((n, v) => n + Object.keys(db.zahlungen[v.id] || {}).length, 0);
    const dateien = garagen.reduce((n, g) => n + (g.dateien || []).length, 0);
    const betroffen = [...new Set(vs.map((v) => v.mieterId))].filter((mid) => !mieterIds.includes(mid));
    const verwaist = betroffen.filter((mid) => !db.vertraege.some((v) => v.mieterId === mid && !vids.has(v.id)));
    const leer = [...new Set(garagen.map((g) => g.standortId))].filter((sid) => !db.garagen.some((g) => g.standortId === sid && !gids.has(g.id)));
    const leerNamen = leer.map((sid) => standortById(sid).name);
    const zeilen = [
      garagen.length ? `${garagen.length} Garage(n)` : "",
      mieterIds.length ? `${mieterIds.length} Mieter` : "",
      vs.length ? `${vs.length} Vertrag/Verträge${laufend.length ? ` – davon <b>${laufend.length} laufend</b>` : ""}` : "",
      zahlungen ? `${zahlungen} erfasste Mietzahlung(en)` : "",
      dateien ? `${dateien} Datei(en) aus der Akte` : "",
    ].filter(Boolean);
    openModal(titel, `
      ${hinweis ? `<p>${hinweis}</p>` : ""}
      <p>Folgendes wird <b>endgültig gelöscht</b>:</p>
      <ul>${zeilen.map((z) => `<li>${z}</li>`).join("")}</ul>
      ${leer.length && !onDone ? check("mitStandort", `Danach leeren Standort ebenfalls entfernen (${leerNamen.join(", ")})`, true) : ""}
      ${verwaist.length ? check("mitMieter", `Mieter ohne weitere Garage ebenfalls löschen (${verwaist.map((id) => mieterName(mieterById(id))).join(", ")})`, true) : ""}
      ${laufend.length ? `<div class="warnbox">${check("sicher", `Ja, ich will auch ${laufend.length === 1 ? "den laufenden Vertrag" : `die ${laufend.length} laufenden Verträge`} löschen`, false)}<p class="hint" style="margin:4px 0 0">Wenn der Mieter nur ausgezogen ist, setz den Vertrag besser auf „beendet“ – dann bleibt er dokumentiert.</p></div>` : ""}
      <p class="hint">Tipp: Unter Einstellungen vorher eine Komplett-Sicherung herunterladen. Online legt die App außerdem täglich ein Backup an.</p>`,
      [{ label: "Abbrechen" }, { label: "Endgültig löschen", cls: "primary danger-btn", onClick: () => {
        const f = formValues($("#modalBody"));
        if (laufend.length && !f.sicher) { toast("Bitte bestätigen, dass laufende Verträge gelöscht werden sollen"); return false; }
        // Dateien im Speicher entfernen (im Hintergrund)
        garagen.forEach((g) => (g.dateien || []).forEach((d) => {
          const k = dateiKey(g, d);
          (mode === "server" ? fetch(`/api/files/${k}`, { method: "DELETE" }) : IDB.del(k)).catch(() => {});
        }));
        vs.forEach((v) => delete db.zahlungen[v.id]);
        db.vertraege = db.vertraege.filter((v) => !vids.has(v.id));
        db.garagen = db.garagen.filter((g) => !gids.has(g.id));
        const weg = new Set(mieterIds.concat(f.mitMieter ? verwaist : []));
        db.mieter = db.mieter.filter((m) => !weg.has(m.id));
        if (f.mitStandort) {
          db.standorte = db.standorte.filter((st) => !leer.includes(st.id));
          if (leer.includes(garagenFilter.standort)) garagenFilter.standort = "";
        }
        if (onDone) onDone();
        commit();
        toast("Gelöscht");
      } }]);
  }

  /* ================= Garagen & Standorte ================= */
  let garagenFilter = { standort: "", q: "" };
  views.garagen = () => {
    const list = db.garagen
      .filter((g) => !garagenFilter.standort || g.standortId === garagenFilter.standort)
      .filter((g) => {
        if (!garagenFilter.q) return true;
        const v = laufenderVertrag(g.id), m = v && mieterById(v.mieterId);
        return `${g.nummer} ${standortById(g.standortId).name} ${mieterName(m)} ${g.notiz || ""}`.toLowerCase().includes(garagenFilter.q.toLowerCase());
      })
      .sort(sortGaragen);
    const unklar = db.standorte.filter((s) => !s.adresse || /adresse fehlt/i.test(s.adresse) || /^(eigentumsgarage|pachtgarage)/i.test(s.name));
    $("#view").innerHTML = `<h1>Garagen</h1><p class="sub">Standorte und einzelne Garagen bzw. Stellplätze verwalten</p>
    ${unklar.length ? `<div class="panel warnpanel"><div class="panel-head"><h2>${unklar.length} Standort(e) ohne richtige Adresse</h2><span class="meta">Einfach umbenennen und Adresse eintragen – oder die Garage einem vorhandenen Standort zuordnen.</span></div>
      ${unklar.map((s) => { const gs = db.garagen.filter((g) => g.standortId === s.id); return `<div class="fixrow"><div><b>${esc(s.name)}</b><div class="hint" style="margin:0">${gs.map((g) => { const v = laufenderVertrag(g.id); return `Garage ${esc(g.nummer)}${v ? " · " + esc(mieterName(mieterById(v.mieterId))) : ""}`; }).join(", ") || "keine Garagen"}</div></div>
        <div class="actions"><button class="btn small primary" data-es="${s.id}">Name &amp; Adresse ändern</button>${gs.length === 1 ? ` <button class="btn small" data-eg="${gs[0].id}">Anderem Standort zuordnen</button>` : ""}</div></div>`; }).join("")}
    </div>` : ""}
    <div class="panel"><div class="panel-head"><h2>Standorte</h2><div class="actions"><button class="btn primary small" id="addStandort">+ Standort</button></div></div>
      ${db.standorte.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Adresse</th><th class="num">Garagen</th><th></th></tr></thead><tbody>
      ${db.standorte.slice().sort((a, b) => a.name.localeCompare(b.name, "de")).map((s) => `<tr><td><b>${esc(s.name)}</b></td><td>${esc(s.adresse)}</td><td class="num">${db.garagen.filter((g) => g.standortId === s.id).length}</td>
      <td class="act"><button class="btn small" data-es="${s.id}">Bearbeiten</button> <button class="btn small danger" data-ds="${s.id}">Löschen</button></td></tr>`).join("")}
      </tbody></table></div>` : `<p class="empty">Lege zuerst einen Standort an, z. B. „Gera, Zusener Straße“.</p>`}
    </div>
    <div class="toolbar">
      <select id="fStandort" style="max-width:240px"><option value="">Alle Standorte</option>${db.standorte.map((s) => `<option value="${s.id}" ${garagenFilter.standort === s.id ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select>
      <input id="fQ" class="search" placeholder="Suchen (Nr., Mieter …)" value="${esc(garagenFilter.q)}">
      <span class="grow"></span>
      <button class="btn" id="bulkGaragen" ${db.standorte.length ? "" : "disabled"}>Mehrere anlegen</button>
      <button class="btn primary" id="addGarage" ${db.standorte.length ? "" : "disabled"}>+ Garage</button>
    </div>
    <div class="panel table-wrap">${list.length ? `<table><thead><tr><th>Standort</th><th>Nr.</th><th>Typ</th><th class="num">m²</th><th class="num">Miete</th><th>Status</th><th>Mieter</th><th></th></tr></thead><tbody>
      ${list.map((g) => {
        const v = laufenderVertrag(g.id), m = v && mieterById(v.mieterId), stt = garageStatus(g);
        return `<tr><td>${esc(standortById(g.standortId).name)}</td><td><b>${esc(g.nummer)}</b></td><td>${esc(g.typ || "Garage")}</td><td class="num">${esc(g.groesse || "")}</td><td class="num">${eur(v ? gesamt(v) : num(g.miete) + num(g.nebenkosten))}</td>
        <td><span class="badge ${stt}">${statusLabel[stt]}</span></td><td>${esc(m ? mieterName(m) : "")}</td>
        <td class="act">${geoFuer(g) ? `<a class="btn small" href="${navUrl(geoFuer(g))}" target="_blank" rel="noopener" title="Navigation">🧭</a> ` : ""}<button class="btn small" data-dg="${g.id}">Akte</button> <button class="btn small" data-eg="${g.id}">Bearbeiten</button> <button class="btn small danger" data-xg="${g.id}">Löschen</button></td></tr>`;
      }).join("")}</tbody></table>` : `<p class="empty">Keine Garagen gefunden.</p>`}</div>`;

    $("#addStandort").onclick = () => standortForm();
    $$("[data-es]").forEach((b) => (b.onclick = () => standortForm(db.standorte.find((s) => s.id === b.dataset.es))));
    $$("[data-ds]").forEach((b) => (b.onclick = () => {
      const s = db.standorte.find((x) => x.id === b.dataset.ds);
      const gs = db.garagen.filter((g) => g.standortId === s.id);
      if (!gs.length) return confirmModal("Standort löschen?", `„${s.name}“ wird gelöscht.`, () => { db.standorte = db.standorte.filter((x) => x.id !== s.id); commit(); });
      loeschDialog({ titel: `Standort „${s.name}“ löschen?`, garagen: gs, hinweis: `Der Standort wird mit allen ${gs.length} Garagen gelöscht.`, onDone: () => { db.standorte = db.standorte.filter((x) => x.id !== s.id); if (garagenFilter.standort === s.id) garagenFilter.standort = ""; } });
    }));
    $("#fStandort").onchange = (e) => { garagenFilter.standort = e.target.value; rerender(); };
    $("#fQ").oninput = (e) => { garagenFilter.q = e.target.value; clearTimeout(views._q); views._q = setTimeout(() => { rerender(); const i = $("#fQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    $("#addGarage").onclick = () => garageForm(null);
    $("#bulkGaragen").onclick = bulkForm;
    $$("[data-dg]").forEach((b) => (b.onclick = () => garageDetail(b.dataset.dg)));
    $$("[data-eg]").forEach((b) => (b.onclick = () => garageForm(garageById(b.dataset.eg))));
    $$("[data-xg]").forEach((b) => (b.onclick = () => {
      const g = garageById(b.dataset.xg);
      loeschDialog({ titel: `Garage ${g.nummer} (${standortById(g.standortId).name}) löschen?`, garagen: [g] });
    }));
  };

  function standortForm(s) {
    const isNew = !s;
    s = s || { id: uid(), name: "", adresse: "", notiz: "" };
    openModal(isNew ? "Neuer Standort" : "Standort bearbeiten", `<div class="grid">
      ${field("name", "Bezeichnung (kurz)", s.name, { attrs: 'placeholder="z. B. Gera Zusener Str."' })}
      ${field("adresse", "Genaue Adresse", s.adresse, { attrs: 'placeholder="Zusener Straße, 07549 Gera"', hint: "Erscheint so im Mietvertrag." })}
      ${area("notiz", "Notiz", s.notiz, { rows: 2 })}</div>`,
      [{ label: "Abbrechen" }, { label: "Speichern", cls: "primary", onClick: () => {
        const f = formValues($("#modalBody"));
        if (!f.name || !f.adresse) { toast("Bitte Bezeichnung und Adresse angeben"); return false; }
        Object.assign(s, f);
        if (isNew) db.standorte.push(s);
        commit(); toast("Standort gespeichert");
      } }]);
  }

  const standortOptions = () => db.standorte.slice().sort((a, b) => a.name.localeCompare(b.name, "de")).map((s) => [s.id, s.name]);

  function bulkForm() {
    openModal("Mehrere Garagen anlegen", `<div class="grid">
      ${select("standortId", "Standort", standortOptions(), garagenFilter.standort || db.standorte[0]?.id, { full: true })}
      ${field("von", "Von Nr.", "1", { type: "number" })}
      ${field("bis", "Bis Nr.", "10", { type: "number" })}
      ${field("miete", "Miete € / Monat", "", { type: "number", attrs: 'step="0.01"' })}
      ${field("kaution", "Kaution €", "", { type: "number", attrs: 'step="0.01"' })}
      </div><p class="hint">Bereits vorhandene Nummern am Standort werden übersprungen.</p>`,
      [{ label: "Abbrechen" }, { label: "Anlegen", cls: "primary", onClick: () => {
        const f = formValues($("#modalBody"));
        const von = parseInt(f.von, 10), bis = parseInt(f.bis, 10);
        if (!(von <= bis) || bis - von > 200) { toast("Bitte gültigen Bereich angeben"); return false; }
        let n = 0;
        for (let i = von; i <= bis; i++) {
          if (db.garagen.some((x) => x.standortId === f.standortId && String(x.nummer) === String(i))) continue;
          db.garagen.push({ id: uid(), standortId: f.standortId, nummer: String(i), typ: "Garage", groesse: "", miete: f.miete, kaution: f.kaution, gesamtgewicht: "2", strom: false, notiz: "" });
          n++;
        }
        commit(); toast(`${n} Garagen angelegt`);
      } }]);
  }

  /* ================= Mieter ================= */
  let mieterQ = "";
  views.mieter = () => {
    const list = db.mieter
      .filter((m) => !mieterQ || `${mieterName(m)} ${m.telefon || ""} ${m.kennzeichen || ""} ${m.plzOrt || ""}`.toLowerCase().includes(mieterQ.toLowerCase()))
      .sort((a, b) => (a.nachname || "").localeCompare(b.nachname || "", "de"));
    $("#view").innerHTML = `<h1>Mieter</h1><p class="sub">${db.mieter.length} Mieter</p>
    <div class="toolbar"><input id="mQ" class="search" placeholder="Suchen …" value="${esc(mieterQ)}"><span class="grow"></span><button class="btn primary" id="addMieter">+ Mieter</button></div>
    <div class="panel table-wrap">${list.length ? `<table><thead><tr><th>Name</th><th>Adresse</th><th>Telefon</th><th>Kennzeichen</th><th>Garagen</th><th></th></tr></thead><tbody>
    ${list.map((m) => {
      const gs = db.vertraege.filter((v) => v.mieterId === m.id && v.status !== "beendet").map((v) => { const g = garageById(v.garageId); return g ? `${standortById(g.standortId).name} ${g.nummer}` : ""; });
      return `<tr><td><b>${esc(mieterName(m))}</b></td><td>${esc([m.strasse, m.plzOrt].filter(Boolean).join(", "))}</td><td>${esc(m.telefon || "")}</td><td>${esc(m.kennzeichen || "")}</td><td>${esc(gs.join(", ")) || '<span class="hint">–</span>'}</td>
      <td class="act"><button class="btn small" data-em="${m.id}">Bearbeiten</button> <button class="btn small danger" data-xm="${m.id}">Löschen</button></td></tr>`;
    }).join("")}</tbody></table>` : `<p class="empty">Keine Mieter gefunden.</p>`}</div>`;
    $("#mQ").oninput = (e) => { mieterQ = e.target.value; clearTimeout(views._m); views._m = setTimeout(() => { rerender(); const i = $("#mQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    $("#addMieter").onclick = () => mieterForm();
    $$("[data-em]").forEach((b) => (b.onclick = () => mieterForm(mieterById(b.dataset.em))));
    $$("[data-xm]").forEach((b) => (b.onclick = () => {
      const m = mieterById(b.dataset.xm);
      if (!db.vertraege.some((v) => v.mieterId === m.id)) return confirmModal("Mieter löschen?", `${mieterName(m)} wird gelöscht.`, () => { db.mieter = db.mieter.filter((x) => x.id !== m.id); commit(); });
      loeschDialog({ titel: `${mieterName(m)} löschen?`, mieterIds: [m.id], hinweis: "Die Verträge dieses Mieters werden mitgelöscht, die Garagen bleiben erhalten und sind danach frei." });
    }));
  };

  function mieterFields(m) {
    return `<div class="grid">
      ${select("anrede", "Anrede", [["Herr", "Herr"], ["Frau", "Frau"], ["", "–"]], m.anrede)}
      <span></span>
      ${field("vorname", "Vorname", m.vorname)}
      ${field("nachname", "Nachname / Firma", m.nachname)}
      ${field("strasse", "Straße, Nr.", m.strasse)}
      ${field("plzOrt", "PLZ Ort", m.plzOrt)}
      ${field("telefon", "Telefon", m.telefon, { type: "tel" })}
      ${field("email", "E-Mail", m.email, { type: "email" })}
      ${field("kennzeichen", "Kfz-Kennzeichen", m.kennzeichen)}
      <span></span>
      ${area("notiz", "Notiz", m.notiz, { rows: 2 })}</div>`;
  }
  function mieterForm(m, after) {
    const isNew = !m;
    m = m || { id: uid(), anrede: "Herr", vorname: "", nachname: "", strasse: "", plzOrt: "", telefon: "", email: "", kennzeichen: "", notiz: "" };
    openModal(isNew ? "Neuer Mieter" : "Mieter bearbeiten", mieterFields(m),
      [{ label: "Abbrechen", onClick: () => { if (after) { after(null); return false; } } },
       { label: "Speichern", cls: "primary", onClick: () => {
        const f = formValues($("#modalBody"));
        if (!f.nachname) { toast("Bitte mindestens den Nachnamen angeben"); return false; }
        Object.assign(m, f);
        if (isNew) db.mieter.push(m);
        save();
        if (after) { after(m); return false; }
        rerender(); toast("Mieter gespeichert");
      } }]);
  }

  /* ================= Verträge ================= */
  let vertragFilter = "laufend";
  views.vertraege = () => {
    const list = db.vertraege
      .filter((v) => vertragFilter === "alle" || (vertragFilter === "laufend" ? v.status !== "beendet" : v.status === vertragFilter))
      .sort((a, b) => sortGaragen(garageById(a.garageId) || {}, garageById(b.garageId) || {}));
    $("#view").innerHTML = `<h1>Verträge</h1><p class="sub">Mietverträge erstellen, unterschreiben lassen und als PDF ausgeben</p>
    <div class="toolbar">
      ${["laufend", "aktiv", "gekuendigt", "beendet", "alle"].map((f) => `<button class="btn small ${vertragFilter === f ? "primary" : ""}" data-vf="${f}">${{ laufend: "Laufend", aktiv: "Aktiv", gekuendigt: "Gekündigt", beendet: "Beendet", alle: "Alle" }[f]}</button>`).join("")}
      <span class="grow"></span>
      <button class="btn primary" id="addVertrag" ${db.garagen.length ? "" : "disabled"}>+ Neuer Vertrag</button>
    </div>
    <div class="panel table-wrap">${list.length ? `<table><thead><tr><th>Nr.</th><th>Garage</th><th>Mieter</th><th>Beginn</th><th class="num">Miete</th><th>Status</th><th>Unterschrift</th><th></th></tr></thead><tbody>
    ${list.map((v) => {
      const g = garageById(v.garageId) || {}, m = mieterById(v.mieterId);
      const sig = v.sigMieter && v.sigVermieter ? "✓ beide" : v.sigMieter || v.sigVermieter ? "teilweise" : v.unterschriebenPapier ? "auf Papier" : "–";
      return `<tr><td>${esc(v.nr)}</td><td>${esc(standortById(g.standortId).name)} · <b>${esc(g.nummer)}</b></td><td>${esc(mieterName(m))}</td><td>${dfmt(v.beginn)}</td><td class="num">${eur(gesamt(v))}</td>
      <td><span class="badge ${v.status}">${statusLabel[v.status]}</span>${v.endeZum && v.status !== "aktiv" ? `<div class="hint">zum ${dfmt(v.endeZum)}</div>` : ""}</td><td>${sig}</td>
      <td class="act"><button class="btn small" data-pdf="${v.id}">PDF</button> <button class="btn small" data-sign="${v.id}">Unterschreiben</button> <button class="btn small" data-ev="${v.id}">Bearbeiten</button>
      ${v.status !== "beendet" ? `<button class="btn small" data-brief="${v.id}">Schreiben …</button>` : ""}</td></tr>`;
    }).join("")}</tbody></table>` : `<p class="empty">Keine Verträge in dieser Ansicht.</p>`}</div>`;
    $$("[data-vf]").forEach((b) => (b.onclick = () => { vertragFilter = b.dataset.vf; rerender(); }));
    $("#addVertrag").onclick = () => schnellVertrag();
    $$("[data-pdf]").forEach((b) => (b.onclick = () => vertragPdf(b.dataset.pdf)));
    $$("[data-sign]").forEach((b) => (b.onclick = () => signForm(b.dataset.sign)));
    $$("[data-ev]").forEach((b) => (b.onclick = () => vertragForm(db.vertraege.find((v) => v.id === b.dataset.ev))));
    $$("[data-brief]").forEach((b) => (b.onclick = () => briefForm(b.dataset.brief)));
  };

  function naechsteVertragsNr() {
    db.seq = (db.seq || 0) + 1;
    return `GV-${new Date().getFullYear()}-${String(db.seq).padStart(3, "0")}`;
  }

  function vertragForm(v, preset = {}, draft = null) {
    const isNew = !v;
    const g0 = garageById(preset.garageId);
    // Formular arbeitet immer auf einer Kopie, gespeichert wird erst bei "Speichern"
    const o = draft || (v ? JSON.parse(JSON.stringify(v)) : {
      id: uid(), nr: "", garageId: preset.garageId || "", mieterId: "", beginn: today(), miete: g0?.miete || "", nebenkosten: g0?.nebenkosten || "", kaution: g0?.kaution || "",
      schluessel: "1", transponder: "0", gesamtgewicht: g0?.gesamtgewicht || "2", erstmalsZum: "", maengel: "", besonderes: "",
      winterdienstVermieter: false, mitGaragenordnung: true, anlageExtra: "", ort: db.settings.ort || "", datum: today(),
      status: "aktiv", endeZum: "", zahlungenAb: "", unterschriebenPapier: false, sigMieter: null, sigVermieter: null, dokumente: [],
    });
    const freieGaragen = db.garagen.filter((g) => g.id === o.garageId || !laufenderVertrag(g.id) || (v && g.id === v.garageId)).sort(sortGaragen)
      .map((g) => [g.id, `${standortById(g.standortId).name} · ${g.typ === "Stellplatz" ? "SP" : "Nr."} ${g.nummer}`]);
    const mieterOpts = [["", "– Mieter wählen –"], ...db.mieter.slice().sort((a, b) => (a.nachname || "").localeCompare(b.nachname || "", "de")).map((m) => [m.id, `${m.nachname}, ${m.vorname}${m.plzOrt ? " (" + m.plzOrt + ")" : ""}`])];

    const body = `<div class="grid">
      ${select("garageId", "Garage", [["", "– Garage wählen –"], ...freieGaragen], o.garageId)}
      <div class="f" style="display:flex;gap:6px;align-items:flex-end"><div style="flex:1">${select("mieterId", "Mieter", mieterOpts, o.mieterId)}</div><button type="button" class="btn" id="neuerMieter" title="Neuen Mieter anlegen">+ Neu</button></div>
      ${field("beginn", "Mietbeginn", o.beginn, { type: "date" })}
      ${field("miete", "Miete € / Monat", o.miete, { type: "number", attrs: 'step="0.01"' })}
      ${field("nebenkosten", "Nebenkostenpauschale € / Monat", o.nebenkosten, { type: "number", attrs: 'step="0.01"', hint: "Zahlt der Mieter zusätzlich zur Miete (leer = keine)." })}
      ${field("kaution", "Kaution € (0 = keine)", o.kaution, { type: "number", attrs: 'step="0.01"' })}
      ${field("gesamtgewicht", "Zul. Gesamtgewicht (t)", o.gesamtgewicht, { type: "number", attrs: 'step="0.5"' })}
      ${field("schluessel", "Anzahl Schlüssel", o.schluessel, { type: "number" })}
      ${field("transponder", "Anzahl Transponder", o.transponder, { type: "number" })}
      ${field("erstmalsZum", "Kündigung erstmals zum (optional)", o.erstmalsZum, { type: "date" })}
      ${field("zahlungenAb", "Mieteingänge erfassen ab", o.zahlungenAb || monthKey(o.beginn || today()), { type: "month", hint: "Bei Altverträgen den aktuellen Monat wählen, sonst gelten alle Monate seit Beginn als offen." })}
      ${area("maengel", "Bekannte Mängel (leer = keine)", o.maengel, { rows: 2 })}
      ${area("besonderes", "Besondere Vereinbarungen", o.besonderes, { rows: 2 })}
      ${check("winterdienstVermieter", "Vermieter übernimmt Winterdienst auf Zufahrten", o.winterdienstVermieter)}
      ${check("mitGaragenordnung", "Garagenordnung als Anlage 1 beifügen", o.mitGaragenordnung !== false)}
      ${field("anlageExtra", "Weitere Anlage (optional, z. B. Lageplan)", o.anlageExtra, { full: true })}
      ${field("ort", "Ort der Unterzeichnung", o.ort)}
      ${field("datum", "Datum der Unterzeichnung", o.datum, { type: "date" })}
      ${check("unterschriebenPapier", "Auf Papier unterschrieben (Altvertrag / Ausdruck)", o.unterschriebenPapier)}
      ${!isNew ? select("status", "Status", [["aktiv", "aktiv"], ["gekuendigt", "gekündigt"], ["beendet", "beendet"]], o.status) + field("endeZum", "Vertragsende zum", o.endeZum, { type: "date" }) : ""}
    </div>`;
    const doSave = () => {
      const f = formValues($("#modalBody"));
      if (!f.garageId || !f.mieterId || !f.beginn) { toast("Garage, Mieter und Beginn sind Pflicht"); return null; }
      Object.assign(o, f);
      if (isNew) { o.nr = naechsteVertragsNr(); db.vertraege.push(o); commit(); return o; }
      Object.assign(v, o); commit(); return v;
    };
    const actions = [];
    if (!isNew) actions.push({ label: "Löschen", cls: "danger left", onClick: () => {
      confirmModal("Vertrag löschen?", `Vertrag ${v.nr} wird endgültig gelöscht (inkl. erfasster Mieteingänge). Zur Dokumentation besser auf „beendet“ setzen.`, () => {
        db.vertraege = db.vertraege.filter((x) => x.id !== v.id); delete db.zahlungen[v.id]; commit();
      });
      return false;
    } });
    actions.push({ label: "Abbrechen" });
    actions.push({ label: "Speichern", onClick: () => { if (!doSave()) return false; toast("Vertrag gespeichert"); } });
    actions.push({ label: "Speichern & unterschreiben", cls: "primary", onClick: () => { const r = doSave(); if (!r) return false; signForm(r.id); return false; } });

    openModal(isNew ? "Neuer Mietvertrag" : `Vertrag ${v.nr}`, body, actions, (root) => {
      const gSel = $("[name=garageId]", root);
      gSel.onchange = () => {
        const g = garageById(gSel.value);
        if (!g) return;
        if (g.miete) $("[name=miete]", root).value = g.miete;
        $("[name=nebenkosten]", root).value = g.nebenkosten || "";
        if (g.kaution !== undefined && g.kaution !== "") $("[name=kaution]", root).value = g.kaution;
        if (g.gesamtgewicht) $("[name=gesamtgewicht]", root).value = g.gesamtgewicht;
      };
      $("[name=beginn]", root).onchange = (e) => { if (isNew) $("[name=zahlungenAb]", root).value = monthKey(e.target.value); };
      $("#neuerMieter").onclick = () => {
        Object.assign(o, formValues(root));
        mieterForm(null, (m) => {
          if (m) o.mieterId = m.id;
          vertragForm(v, preset, o);
        });
      };
    });
  }

  function ctx(vid) {
    const v = db.vertraege.find((x) => x.id === vid);
    const garage = garageById(v.garageId);
    return { v, garage, standort: standortById(garage.standortId), mieter: mieterById(v.mieterId), s: vermieterFuer(garage) };
  }

  function vertragPdf(vid, archiv = false) {
    const c = ctx(vid);
    const doc = Docs.mietvertrag(c);
    const name = `Mietvertrag ${c.v.nr} ${c.standort.name} Garage ${c.garage.nummer} ${c.mieter.nachname}.pdf`;
    downloadPdf(doc, name);
    if (archiv) archivPdf(c.garage, doc, name, "Vertrag");
    toast(archiv ? "PDF erstellt und in der Akte abgelegt" : "PDF erstellt");
  }

  function signForm(vid) {
    const c = ctx(vid);
    const v = c.v;
    let padM, padV;
    openModal(`Unterschriften · ${v.nr}`, `
      <p class="sub" style="margin:0 0 12px">${esc(c.standort.name)} · Garage ${esc(c.garage.nummer)} · ${esc(mieterName(c.mieter))} · ${eur(gesamt(v))} / Monat</p>
      <p class="hint" style="margin:0 0 12px">Mit Finger, Stift oder Maus unterschreiben. Tipp: Vorher das PDF zeigen, damit der Mieter den Vertrag lesen kann.</p>
      <div class="sig">
        <div class="sig-box"><div class="row"><b>Mieter</b><button type="button" class="btn small" id="clrM">Löschen</button></div><canvas id="cvM"></canvas><span class="hint">${esc(mieterName(c.mieter))}</span></div>
        <div class="sig-box"><div class="row"><b>Vermieter</b><span><button type="button" class="btn small" id="useV" ${c.s.sigVermieter ? "" : "disabled"} title="In den Einstellungen hinterlegte Unterschrift einsetzen">Gespeicherte</button> <button type="button" class="btn small" id="clrV">Löschen</button></span></div><canvas id="cvV"></canvas><span class="hint">${esc(c.s.name)}</span></div>
      </div>
      <div class="grid" style="margin-top:12px">${field("ort", "Ort", v.ort || db.settings.ort)}${field("datum", "Datum", v.datum || today(), { type: "date" })}</div>`,
      [
        { label: "Abbrechen" },
        { label: "Speichern", onClick: () => { store(); toast("Unterschriften gespeichert"); } },
        { label: "Speichern & PDF", cls: "primary", onClick: () => { store(); vertragPdf(vid, !!(v.sigMieter || v.sigVermieter)); } },
      ],
      (root) => {
        padM = signaturePad($("#cvM", root), v.sigMieter);
        padV = signaturePad($("#cvV", root), v.sigVermieter);
        $("#clrM", root).onclick = () => padM.clear();
        $("#clrV", root).onclick = () => padV.clear();
        $("#useV", root).onclick = () => padV.load(c.s.sigVermieter);
      });
    function store() {
      const f = formValues($("#modalBody"));
      v.sigMieter = padM.value();
      v.sigVermieter = padV.value();
      v.ort = f.ort; v.datum = f.datum;
      commit();
    }
  }

  function vertragBeenden(vid) {
    const v = db.vertraege.find((x) => x.id === vid);
    openModal("Rückgabe erledigt?", `<p>Vertrag ${esc(v.nr)} wird auf „beendet“ gesetzt und die Garage ist wieder frei.</p>
      <div class="grid">${field("endeZum", "Vertragsende", v.endeZum || today(), { type: "date" })}${field("schluesselZurueck", "Schlüssel/Transponder zurück", `${v.schluessel || 0} / ${v.transponder || 0}`)}</div>`,
      [{ label: "Abbrechen" }, { label: "Beenden", cls: "primary", onClick: () => {
        const f = formValues($("#modalBody"));
        v.status = "beendet"; v.endeZum = f.endeZum; v.rueckgabe = { datum: today(), schluessel: f.schluesselZurueck };
        commit(); toast("Vertrag beendet – Garage ist frei");
      } }]);
  }

  /* ---------- Schreiben: Kündigung / Zahlungserinnerung ---------- */
  function briefForm(vid) {
    const c = ctx(vid);
    const v = c.v;
    const offen = offeneMonate(v);
    const monateText = offen.length ? offen.map(monthName).join(", ") : "";
    const betrag = offen.length * gesamt(v);
    const zugang = addDays(today(), 2);
    openModal(`Schreiben an ${mieterName(c.mieter)}`, `
      <div class="grid">
        ${select("art", "Art des Schreibens", [["erinnerung", "Zahlungserinnerung / Mahnung"], ["ordentlich", "Ordentliche Kündigung"], ["fristlos", "Fristlose Kündigung"]], offen.length ? "erinnerung" : "ordentlich", { full: true })}
        ${field("datum", "Datum des Schreibens", today(), { type: "date" })}
        ${field("ort", "Ort", db.settings.ort)}
      </div>
      <div data-art="erinnerung"><div class="grid" style="margin-top:10px">
        ${select("stufe", "Stufe", [["Zahlungserinnerung", "Zahlungserinnerung"], ["Mahnung", "Mahnung"], ["Letzte Mahnung", "Letzte Mahnung"]], "Zahlungserinnerung")}
        ${field("frist", "Zahlen bis", addDays(today(), 10), { type: "date" })}
        ${field("monate", "Offene Monate", monateText, { full: true })}
        ${field("betrag", "Offener Betrag €", betrag.toFixed(2), { type: "number", attrs: 'step="0.01"' })}
      </div></div>
      <div data-art="ordentlich"><div class="grid" style="margin-top:10px">
        ${field("zugang", "Voraussichtlicher Zugang beim Mieter", zugang, { type: "date", hint: "Einwurf-Einschreiben: ca. 2 Tage. Entscheidend für die Frist." })}
        ${field("zum", "Kündigung zum", kuendigungZum(zugang), { type: "date", hint: "Zugang bis 3. Werktag → Ende des übernächsten Monats." })}
      </div></div>
      <div data-art="fristlos"><div class="grid" style="margin-top:10px">
        ${select("grund", "Grund", [["zahlungsverzug", "Zahlungsverzug"], ["sonstiges", "Vertragswidriger Gebrauch / sonstiger wichtiger Grund"]], "zahlungsverzug", { full: true })}
        ${field("monateF", "Rückständige Monate", monateText, { full: true })}
        ${field("betragF", "Rückstand €", betrag.toFixed(2), { type: "number", attrs: 'step="0.01"' })}
        ${field("mahnungVom", "Mahnung / Abmahnung vom (optional)", "", { type: "date" })}
        ${area("grundText", "Begründung (bei sonstigem Grund)", "", { rows: 2 })}
        ${field("raeumungBis", "Räumung & Schlüsselrückgabe bis", addDays(today(), 14), { type: "date" })}
        ${field("hilfsweiseZum", "Hilfsweise ordentlich zum", kuendigungZum(zugang), { type: "date" })}
      </div>
      <p class="hint">Bei Garagen ist eine fristlose Kündigung wegen Zahlungsverzugs möglich, wenn zwei aufeinanderfolgende Monatsmieten (oder ein nicht unerheblicher Teil davon) oder über einen längeren Zeitraum insgesamt zwei Monatsmieten offen sind (§ 543 Abs. 2 Nr. 3 BGB). Aktuell offen: ${offen.length} Monat(e).</p></div>
      <div class="grid" style="margin-top:10px">
        ${area("zusatz", "Zusätzlicher Absatz (optional)", "", { rows: 2 })}
        ${check("mitUnterschrift", "Gespeicherte Vermieter-Unterschrift einsetzen", !!c.s.sigVermieter)}
        <label class="f check full" data-only="kuendigung"><input type="checkbox" name="markieren" checked> Vertrag als gekündigt markieren</label>
      </div>`,
      [{ label: "Abbrechen" }, { label: "PDF erstellen", cls: "primary", onClick: () => {
        const f = formValues($("#modalBody"));
        if (f.mitUnterschrift && !c.s.sigVermieter) f.mitUnterschrift = false;
        const k = { datum: f.datum, ort: f.ort, zusatz: f.zusatz, mitUnterschrift: f.mitUnterschrift };
        let doc, name;
        if (f.art === "erinnerung") {
          Object.assign(k, { stufe: f.stufe, frist: f.frist, monate: f.monate || "die zurückliegenden Monate", betrag: num(f.betrag) });
          doc = Docs.zahlungserinnerung({ ...c, k });
          name = `${f.stufe} ${c.mieter.nachname} Garage ${c.garage.nummer} ${f.datum}.pdf`;
        } else if (f.art === "ordentlich") {
          Object.assign(k, { zum: f.zum });
          doc = Docs.kuendigungOrdentlich({ ...c, k });
          name = `Kündigung ${c.mieter.nachname} Garage ${c.garage.nummer} ${f.datum}.pdf`;
          if (f.markieren) { v.status = "gekuendigt"; v.endeZum = f.zum; }
        } else {
          if (f.grund === "sonstiges" && !f.grundText) { toast("Bitte eine Begründung eintragen"); return false; }
          Object.assign(k, { grund: f.grund, monate: f.monateF || "die zurückliegenden Monate", betrag: num(f.betragF), mahnungVom: f.mahnungVom, grundText: f.grundText, raeumungBis: f.raeumungBis, hilfsweiseZum: f.hilfsweiseZum });
          doc = Docs.kuendigungFristlos({ ...c, k });
          name = `Fristlose Kündigung ${c.mieter.nachname} Garage ${c.garage.nummer} ${f.datum}.pdf`;
          if (f.markieren) { v.status = "gekuendigt"; v.endeZum = f.raeumungBis; }
        }
        v.dokumente = v.dokumente || [];
        v.dokumente.push({ art: f.art === "erinnerung" ? f.stufe : f.art === "ordentlich" ? "Ordentliche Kündigung" : "Fristlose Kündigung", datum: f.datum });
        downloadPdf(doc, name);
        archivPdf(c.garage, doc, name, f.art === "erinnerung" ? "Mahnung" : "Kündigung");
        commit();
      } }],
      (root) => {
        const art = $("[name=art]", root);
        const upd = () => {
          $$("[data-art]", root).forEach((el) => (el.style.display = el.dataset.art === art.value ? "" : "none"));
          $$("[data-only=kuendigung]", root).forEach((el) => (el.style.display = art.value === "erinnerung" ? "none" : ""));
        };
        art.onchange = upd; upd();
        $("[name=zugang]", root).onchange = (e) => {
          const z = kuendigungZum(e.target.value);
          $("[name=zum]", root).value = z;
          $("[name=hilfsweiseZum]", root).value = z;
        };
      });
  }

  /* ================= Mieteingänge ================= */
  let payMonth = monthKey(today());
  views.zahlungen = () => {
    const list = db.vertraege.filter((v) => v.status !== "beendet" || (v.endeZum && monthKey(v.endeZum) >= payMonth))
      .filter((v) => (v.zahlungenAb || monthKey(v.beginn)) <= payMonth && monthKey(v.beginn) <= payMonth)
      .sort((a, b) => sortGaragen(garageById(a.garageId) || {}, garageById(b.garageId) || {}));
    const soll = list.reduce((s, v) => s + gesamt(v), 0);
    const ist = list.filter((v) => bezahlt(v.id, payMonth)).reduce((s, v) => s + gesamt(v), 0);
    $("#view").innerHTML = `<h1>Mieteingänge</h1><p class="sub">Haken setzen, sobald die Miete auf dem Konto ist</p>
    <div class="toolbar">
      <button class="btn" id="pPrev">‹</button><b style="min-width:150px;text-align:center">${monthName(payMonth)}</b><button class="btn" id="pNext">›</button>
      <span class="grow"></span>
      <button class="btn" id="pAll">Alle als bezahlt markieren</button>
      <label class="btn primary" style="cursor:pointer">Kontoauszug einlesen (DKB)<input type="file" id="pImport" accept=".csv,.pdf,.txt" multiple hidden></label>
    </div>
    <div class="cards">
      <div class="card"><div class="lbl">Soll</div><div class="val">${eur(soll)}</div></div>
      <div class="card"><div class="lbl">Eingegangen</div><div class="val">${eur(ist)}</div></div>
      <div class="card"><div class="lbl">Fehlt</div><div class="val" style="color:${soll - ist > 0 ? "var(--danger)" : "inherit"}">${eur(soll - ist)}</div></div>
    </div>
    <div class="panel table-wrap">${list.length ? `<table><thead><tr><th class="pay-cell">Bezahlt</th><th>Garage</th><th>Mieter</th><th class="num">Miete</th><th>Rückstand gesamt</th><th></th></tr></thead><tbody>
    ${list.map((v) => {
      const g = garageById(v.garageId) || {}, o = offeneMonate(v);
      return `<tr><td class="pay-cell"><input type="checkbox" data-pay="${v.id}" ${bezahlt(v.id, payMonth) ? "checked" : ""}></td><td>${esc(standortById(g.standortId).name)} · <b>${esc(g.nummer)}</b></td><td>${esc(mieterName(mieterById(v.mieterId)))}</td><td class="num">${eur(gesamt(v))}</td>
      <td>${o.length ? `<span class="badge offen" title="${esc(o.map(monthName).join(", "))}">${o.length} Monat(e) · ${eur(o.length * gesamt(v))}</span>` : '<span class="hint">–</span>'}</td>
      <td class="act">${o.length ? `<button class="btn small" data-brief="${v.id}">Erinnerung …</button>` : ""}</td></tr>`;
    }).join("")}</tbody></table>` : `<p class="empty">Keine laufenden Verträge in diesem Monat.</p>`}</div>`;
    $("#pPrev").onclick = () => { payMonth = addMonths(payMonth, -1); rerender(); };
    $("#pNext").onclick = () => { payMonth = addMonths(payMonth, 1); rerender(); };
    $("#pImport").onchange = (e) => { const fs = [...e.target.files]; if (fs.length) kontoauszugEinlesen(fs); };
    $("#pAll").onclick = () => { list.forEach((v) => { (db.zahlungen[v.id] = db.zahlungen[v.id] || {})[payMonth] = today(); }); commit(); };
    $$("[data-pay]").forEach((cb) => (cb.onchange = () => {
      const z = (db.zahlungen[cb.dataset.pay] = db.zahlungen[cb.dataset.pay] || {});
      if (cb.checked) z[payMonth] = today(); else delete z[payMonth];
      commit();
    }));
    $$("[data-brief]").forEach((b) => (b.onclick = () => briefForm(b.dataset.brief)));
  };

  /* ================= Schnell-Vertrag (Assistent) ================= */
  function schnellVertrag(preset = {}, state = null) {
    const freie = db.garagen.filter((g) => !laufenderVertrag(g.id) || g.id === state?.garageId).sort(sortGaragen);
    if (!freie.length) return alertModal("Keine freie Garage", "Aktuell ist keine Garage frei. Lege unter „Garagen“ eine an oder beende einen Vertrag.");
    const st = state || {
      garageId: preset.garageId || "", mieterId: "",
      m: { anrede: "Herr", vorname: "", nachname: "", strasse: "", plzOrt: "", telefon: "", email: "", kennzeichen: "" },
      beginn: today(), miete: "", kaution: "", schluessel: "1", transponder: "0", gesamtgewicht: "", maengel: "", besonderes: "",
    };
    const g0 = garageById(st.garageId);
    if (g0 && !state) { st.miete = g0.miete || ""; st.nebenkosten = g0.nebenkosten || ""; st.kaution = g0.kaution || ""; st.gesamtgewicht = g0.gesamtgewicht || "2"; }
    const m = st.m;
    const body = `
      <div class="grid">
        ${select("garageId", "Garage", [["", "– freie Garage wählen –"], ...freie.map((g) => [g.id, `${standortById(g.standortId).name} · ${g.typ === "Stellplatz" ? "SP" : "Nr."} ${g.nummer}${g.miete ? ` · ${eur(g.miete)}` : ""}${istEigen(g) ? "" : ` · Eigentümer: ${vermieterName(g)}`}`])], st.garageId, { full: true })}
        ${select("mieterId", "Mieter", [["", "Neuer Mieter – Daten unten eintragen"], ...db.mieter.slice().sort((a, b) => (a.nachname || "").localeCompare(b.nachname || "", "de")).map((x) => [x.id, `Bestehend: ${x.nachname}, ${x.vorname}`])], st.mieterId, { full: true })}
      </div>
      <fieldset id="mFields"><legend>Mieter</legend><div class="grid">
        ${select("anrede", "Anrede", [["Herr", "Herr"], ["Frau", "Frau"], ["", "–"]], m.anrede)}
        ${field("kennzeichen", "Kfz-Kennzeichen", m.kennzeichen)}
        ${field("vorname", "Vorname", m.vorname)}
        ${field("nachname", "Nachname", m.nachname)}
        ${field("strasse", "Straße, Nr.", m.strasse)}
        ${field("plzOrt", "PLZ Ort", m.plzOrt)}
        ${field("telefon", "Telefon", m.telefon, { type: "tel" })}
        ${field("email", "E-Mail", m.email, { type: "email" })}
      </div></fieldset>
      <fieldset><legend>Vertrag</legend><div class="grid">
        ${field("beginn", "Mietbeginn", st.beginn, { type: "date" })}
        ${field("miete", "Miete € / Monat", st.miete, { type: "number", attrs: 'step="0.01"' })}
        ${field("nebenkosten", "Nebenkosten € / Monat (leer = keine)", st.nebenkosten, { type: "number", attrs: 'step="0.01"' })}
        ${field("kaution", "Kaution € (leer/0 = keine)", st.kaution, { type: "number", attrs: 'step="0.01"' })}
        ${field("schluessel", "Schlüssel", st.schluessel, { type: "number" })}
      </div>
      <details style="margin-top:10px"><summary class="hint" style="cursor:pointer">Weitere Angaben (Transponder, Gewicht, Mängel, Sondervereinbarungen)</summary><div class="grid" style="margin-top:8px">
        ${field("transponder", "Transponder", st.transponder, { type: "number" })}
        ${field("gesamtgewicht", "Zul. Gesamtgewicht (t)", st.gesamtgewicht || "2", { type: "number", attrs: 'step="0.5"' })}
        ${area("maengel", "Bekannte Mängel", st.maengel, { rows: 2 })}
        ${area("besonderes", "Besondere Vereinbarungen", st.besonderes, { rows: 2 })}
      </div></details></fieldset>`;
    openModal("Neuer Mietvertrag · 1/2 Daten", body, [
      { label: "Ausführliches Formular", cls: "left", onClick: () => { vertragForm(null, { garageId: $("[name=garageId]").value }); return false; } },
      { label: "Abbrechen" },
      { label: "Weiter zur Unterschrift →", cls: "primary", onClick: () => {
        const f = formValues($("#modalBody"));
        Object.assign(st, { garageId: f.garageId, mieterId: f.mieterId, beginn: f.beginn, miete: f.miete, nebenkosten: f.nebenkosten, kaution: f.kaution, schluessel: f.schluessel, transponder: f.transponder, gesamtgewicht: f.gesamtgewicht, maengel: f.maengel, besonderes: f.besonderes });
        ["anrede", "vorname", "nachname", "strasse", "plzOrt", "telefon", "email", "kennzeichen"].forEach((k) => (st.m[k] = f[k]));
        if (!st.garageId) { toast("Bitte eine Garage wählen"); return false; }
        if (!st.mieterId && (!st.m.nachname || !st.m.strasse || !st.m.plzOrt)) { toast("Bitte Name und Anschrift des Mieters eintragen"); return false; }
        if (!st.beginn || !(num(st.miete) > 0)) { toast("Bitte Mietbeginn und Miete angeben"); return false; }
        schnellSign(st, preset);
        return false;
      } },
    ], (root) => {
      const gSel = $("[name=garageId]", root), mSel = $("[name=mieterId]", root);
      gSel.onchange = () => {
        const g = garageById(gSel.value);
        if (!g) return;
        $("[name=miete]", root).value = g.miete || "";
        $("[name=nebenkosten]", root).value = g.nebenkosten || "";
        $("[name=kaution]", root).value = g.kaution || "";
        $("[name=gesamtgewicht]", root).value = g.gesamtgewicht || "2";
      };
      const updM = () => { $("#mFields", root).style.display = mSel.value ? "none" : ""; };
      mSel.onchange = updM; updM();
      if (!st.garageId) gSel.focus(); else if (!mSel.value) $("[name=vorname]", root).focus();
    });
  }

  function schnellDraft(st) {
    const mieter = st.mieterId ? mieterById(st.mieterId) : Object.assign({ id: st.mId || (st.mId = uid()), notiz: "" }, st.m);
    const v = {
      id: st.vId || (st.vId = uid()), nr: "Entwurf", garageId: st.garageId, mieterId: mieter.id, beginn: st.beginn, miete: st.miete, nebenkosten: st.nebenkosten || "", kaution: st.kaution || "0",
      schluessel: st.schluessel || "0", transponder: st.transponder || "0", gesamtgewicht: st.gesamtgewicht || "2", erstmalsZum: "", maengel: st.maengel, besonderes: st.besonderes,
      winterdienstVermieter: false, mitGaragenordnung: true, anlageExtra: "", ort: st.ort || db.settings.ort || "", datum: st.datum || today(),
      status: "aktiv", endeZum: "", zahlungenAb: monthKey(st.beginn), unterschriebenPapier: false, sigMieter: null, sigVermieter: null, dokumente: [],
    };
    const garage = garageById(st.garageId);
    return { v, mieter, garage, standort: standortById(garage.standortId), s: vermieterFuer(garage) };
  }

  function schnellSign(st, preset) {
    const c = schnellDraft(st);
    const hatSig = !!c.s.sigVermieter;
    let padM, padV;
    openModal("Neuer Mietvertrag · 2/2 Unterschrift", `
      <table><tbody>
        <tr><th>Garage</th><td>${esc(c.standort.name)} · Nr. ${esc(c.garage.nummer)}<div class="hint">${esc(c.standort.adresse)}</div></td></tr>
        <tr><th>Mieter</th><td>${esc(mieterName(c.mieter))}<div class="hint">${esc([c.mieter.strasse, c.mieter.plzOrt].filter(Boolean).join(", "))}</div></td></tr>
        <tr><th>Beginn</th><td>${dfmt(c.v.beginn)}</td></tr>
        <tr><th>Miete</th><td>${eur(c.v.miete)} monatlich${num(c.v.nebenkosten) > 0 ? ` + ${eur(c.v.nebenkosten)} Nebenkosten = <b>${eur(gesamt(c.v))}</b>` : ""}, fällig bis zum 3. Werktag${num(c.v.kaution) > 0 ? ` · Kaution ${eur(c.v.kaution)}` : ""}</td></tr>
        <tr><th>Kündigung</th><td>3 Monate zum Monatsende</td></tr>
      </tbody></table>
      <div class="toolbar" style="margin:10px 0 14px"><button type="button" class="btn" id="preview">Vollständigen Vertrag ansehen (PDF)</button></div>
      <div class="sig-box"><div class="row"><b>Unterschrift Mieter</b><button type="button" class="btn small" id="clrM">Löschen</button></div><canvas id="cvM"></canvas><span class="hint">${esc(mieterName(c.mieter))} – mit Finger oder Stift unterschreiben</span></div>
      <div class="sig-box" style="margin-top:12px">
        <div class="row"><b>Unterschrift Vermieter${istEigen(c.garage) ? "" : ` (${esc(c.s.name)})`}</b><span>${hatSig ? '<button type="button" class="btn small" id="signV">Neu unterschreiben</button>' : '<button type="button" class="btn small" id="clrV">Löschen</button>'}</span></div>
        ${hatSig ? `<div id="vSigImg"><img src="${c.s.sigVermieter}" alt="Unterschrift Vermieter" style="max-height:60px;border:1px dashed var(--line);border-radius:8px;padding:4px;background:#fffdf8"><div class="hint">Gespeicherte Unterschrift wird eingesetzt.</div></div><canvas id="cvV" style="display:none"></canvas>` : `<canvas id="cvV"></canvas><div class="hint">Tipp: Unter Einstellungen einmal hinterlegen, dann wird sie automatisch eingesetzt.</div>`}
      </div>
      <div class="grid" style="margin-top:12px">${field("ort", "Ort", c.v.ort)}${field("datum", "Datum", c.v.datum, { type: "date" })}</div>`,
      [
        { label: "← Zurück", cls: "left", onClick: () => { readOrt(); schnellVertrag(preset, st); return false; } },
        { label: "Ohne Unterschrift speichern", onClick: () => { finish(false); } },
        { label: "Fertig – PDF erstellen", cls: "primary", onClick: () => {
          if (!padM.value()) { toast("Bitte zuerst den Mieter unterschreiben lassen"); return false; }
          finish(true);
        } },
      ],
      (root) => {
        padM = signaturePad($("#cvM", root));
        const cvV = $("#cvV", root);
        if (!hatSig) padV = signaturePad(cvV);
        $("#clrM", root).onclick = () => padM.clear();
        if ($("#clrV", root)) $("#clrV", root).onclick = () => padV.clear();
        if ($("#signV", root)) $("#signV", root).onclick = () => { $("#vSigImg", root).style.display = "none"; cvV.style.display = ""; padV = signaturePad(cvV); };
        $("#preview", root).onclick = () => {
          readOrt();
          const d = schnellDraft(st);
          d.v.sigMieter = padM.value();
          d.v.sigVermieter = padV ? padV.value() : c.s.sigVermieter;
          window.open(Docs.mietvertrag(d).output("bloburl"), "_blank");
        };
      });
    function readOrt() { const f = formValues($("#modalBody")); st.ort = f.ort; st.datum = f.datum; }
    function finish(withPdf) {
      readOrt();
      const d = schnellDraft(st);
      if (!st.mieterId && !db.mieter.some((x) => x.id === d.mieter.id)) db.mieter.push(d.mieter);
      d.v.sigMieter = padM.value();
      d.v.sigVermieter = padV ? padV.value() : c.s.sigVermieter;
      d.v.nr = naechsteVertragsNr();
      db.vertraege.push(d.v);
      commit();
      if (withPdf) {
        const doc = Docs.mietvertrag(d);
        const name = `Mietvertrag ${d.v.nr} ${d.standort.name} Garage ${d.garage.nummer} ${d.mieter.nachname}.pdf`;
        downloadPdf(doc, name);
        archivPdf(d.garage, doc, name, "Vertrag");
      }
      toast(`Vertrag ${d.v.nr} gespeichert`);
    }
  }

  /* ================= Kontoauszug-Import & Abgleich ================= */
  let imp = null;
  const laufendeVertraege = () => db.vertraege.filter((v) => v.status !== "beendet" || (v.endeZum && v.endeZum >= addDays(today(), -150)));
  const passt = (betrag, summe) => summe > 0 && Math.round(betrag / summe) >= 1 && Math.abs(betrag / summe - Math.round(betrag / summe)) < 0.001;

  function monateFuer(v, buchung, n, reserviert) {
    const start = v.zahlungenAb || monthKey(v.beginn);
    const bm = monthKey(buchung);
    const res = reserviert[v.id] || (reserviert[v.id] = new Set());
    const frei = (k) => !bezahlt(v.id, k) && !res.has(k);
    const out = [];
    for (let k = start; k <= bm && out.length < n; k = addMonths(k, 1)) if (frei(k)) out.push(k);
    for (let k = addMonths(bm, 1), i = 0; out.length < n && i < 24; k = addMonths(k, 1), i++) if (frei(k)) out.push(k);
    out.forEach((k) => res.add(k));
    return out;
  }

  function zuordnen(t) {
    const words = " " + Bank.norm(`${t.name} ${t.zweck}`) + " ";
    const gruppen = new Map();
    laufendeVertraege().forEach((v) => { if (!gruppen.has(v.mieterId)) gruppen.set(v.mieterId, []); gruppen.get(v.mieterId).push(v); });
    const kandidaten = [];
    for (const [mid, list] of gruppen) {
      const m = mieterById(mid);
      if (!m) continue;
      let score = 0;
      const gruende = [];
      if (t.iban && list.some((v) => (v.zahlerIbans || []).includes(t.iban))) { score += 100; gruende.push("IBAN bekannt"); }
      if (list.some((v) => (v.zahlerNamen || []).some((n) => n && words.includes(" " + n + " ")))) { score += 60; gruende.push("Zahler bekannt"); }
      const nn = Bank.norm(m.nachname);
      if (nn.length >= 3 && words.includes(" " + nn + " ")) { score += 45; gruende.push("Name"); }
      const vn = Bank.norm(m.vorname);
      if (vn.length >= 3 && words.includes(" " + vn + " ")) score += 10;
      const treffer = list.filter((v) => {
        const g = garageById(v.garageId);
        if (!g) return false;
        const nr = String(g.nummer).replace(/[^0-9a-z]/gi, "");
        return new RegExp(`(garage|gar|nr|stellplatz|sp|g)\\s*0*${nr}\\b`).test(words);
      });
      if (treffer.length) { score += 25; gruende.push("Garagen-Nr."); }
      const summe = list.reduce((s, v) => s + gesamt(v), 0);
      let ziel = null;
      if (treffer.length) ziel = treffer;
      else if (list.length > 1 && passt(t.betrag, summe)) ziel = list;
      else ziel = [list.find((v) => passt(t.betrag, gesamt(v))) || list[0]];
      const zielSumme = ziel.reduce((s, v) => s + gesamt(v), 0);
      const fit = passt(t.betrag, zielSumme);
      if (fit) { score += 20; gruende.push("Betrag passt"); }
      kandidaten.push({ mid, list, ziel, fit, score, gruende, n: fit ? Math.round(t.betrag / zielSumme) : 1 });
    }
    kandidaten.sort((a, b) => b.score - a.score);
    const best = kandidaten[0];
    if (!best || best.score < 45) return { target: "", status: "offen", gruende: [] };
    const zweiter = kandidaten[1];
    const eindeutig = !zweiter || zweiter.score < best.score - 20;
    return {
      target: best.ziel.length > 1 ? "m:" + best.mid : best.ziel[0].id,
      n: best.n,
      status: best.fit && best.score >= 65 && eindeutig ? "sicher" : "pruefen",
      gruende: best.gruende,
    };
  }

  const zielVertraege = (target) => !target ? [] : target.startsWith("m:")
    ? laufendeVertraege().filter((v) => v.mieterId === target.slice(2))
    : [db.vertraege.find((v) => v.id === target)].filter(Boolean);

  function monateNeuBerechnen() {
    const reserviert = {};
    imp.rows.slice().sort((a, b) => a.t.datum.localeCompare(b.t.datum)).forEach((r) => {
      r.monate = {};
      if (!r.target || !r.use) return;
      zielVertraege(r.target).forEach((v) => {
        r.monate[v.id] = r.manuell?.[v.id] || monateFuer(v, r.t.datum, r.n || 1, reserviert);
        (reserviert[v.id] = reserviert[v.id] || new Set());
        r.monate[v.id].forEach((k) => reserviert[v.id].add(k));
      });
    });
  }

  async function kontoauszugEinlesen(files) {
    const alle = [];
    const fehler = [];
    for (const f of files) {
      try { (await Bank.readFile(f)).forEach((t) => alle.push(t)); }
      catch (e) { fehler.push(`${f.name}: ${e.message}`); }
    }
    const gesehen = new Set();
    const eingaenge = alle.filter((t) => t.betrag > 0).filter((t) => { const k = Bank.txKey(t); if (gesehen.has(k)) return false; gesehen.add(k); return true; })
      .sort((a, b) => a.datum.localeCompare(b.datum));
    if (!eingaenge.length) {
      return alertModal("Keine Zahlungseingänge gefunden", fehler.length ? fehler.join("\n") : "In der Datei wurden keine Gutschriften erkannt. Am zuverlässigsten ist der CSV-Export aus dem DKB-Banking (Umsätze → Export → CSV).");
    }
    db.importiert = db.importiert || {};
    imp = {
      dateien: files.map((f) => f.name).join(", "),
      quelle: [...new Set(eingaenge.map((t) => t.quelle))].join("/"),
      filter: "alle",
      rows: eingaenge.map((t) => {
        const key = Bank.txKey(t);
        const doppelt = !!db.importiert[key];
        let z = doppelt ? { target: "", status: "doppelt", gruende: [] } : zuordnen(t);
        // gleiche Zahlung schon aus einem anderen Auszug (z. B. CSV und PDF) verbucht?
        if (z.target && zielVertraege(z.target).some((v) => Object.values(db.zahlungen[v.id] || {}).includes(t.datum))) {
          z = { ...z, status: "doppelt", gruende: ["an diesem Tag schon verbucht"] };
        }
        return { t, key, doppelt: z.status === "doppelt", target: z.target, n: z.n || 1, status: z.status, gruende: z.gruende, use: z.status === "sicher" };
      }),
    };
    monateNeuBerechnen();
    current = "import";
    $$("#tabs button").forEach((b) => b.classList.toggle("active", b.dataset.view === "zahlungen"));
    views.import();
    if (fehler.length) toast(fehler[0]);
  }

  views.import = () => {
    if (!imp) return show("zahlungen");
    const rows = imp.rows;
    const cnt = (s) => rows.filter((r) => r.status === s).length;
    const monate = [...new Set(rows.map((r) => monthKey(r.t.datum)))].sort();
    const vonM = monate[0], bisM = monate[monate.length - 1];
    // Wer hat im Auszugszeitraum nach Übernahme noch offene Monate?
    const geplant = {};
    rows.forEach((r) => r.use && Object.entries(r.monate || {}).forEach(([vid, ks]) => ks.forEach((k) => ((geplant[vid] = geplant[vid] || new Set()).add(k)))));
    const offenNachher = laufendeVertraege().map((v) => {
      const start = v.zahlungenAb || monthKey(v.beginn);
      const ende = v.status !== "aktiv" && v.endeZum ? monthKey(v.endeZum) : bisM;
      const ks = [];
      for (let k = start; k <= bisM && k <= ende; k = addMonths(k, 1)) if (!bezahlt(v.id, k) && !geplant[v.id]?.has(k)) ks.push(k);
      return { v, ks };
    }).filter((x) => x.ks.length).sort((a, b) => sortGaragen(garageById(a.v.garageId) || {}, garageById(b.v.garageId) || {}));

    const vertragOpts = [["", "– nicht zuordnen –"]];
    const gruppen = new Map();
    laufendeVertraege().sort((a, b) => (mieterById(a.mieterId)?.nachname || "").localeCompare(mieterById(b.mieterId)?.nachname || "", "de")).forEach((v) => {
      const g = garageById(v.garageId) || {};
      vertragOpts.push([v.id, `${mieterName(mieterById(v.mieterId))} · ${standortById(g.standortId).name} ${g.nummer} · ${eur(gesamt(v))}`]);
      if (!gruppen.has(v.mieterId)) gruppen.set(v.mieterId, []);
      gruppen.get(v.mieterId).push(v);
    });
    for (const [mid, list] of gruppen) if (list.length > 1) vertragOpts.push(["m:" + mid, `${mieterName(mieterById(mid))} · alle ${list.length} Garagen · ${eur(list.reduce((s, v) => s + gesamt(v), 0))}`]);

    const sichtbar = rows.filter((r) => imp.filter === "alle" || r.status === imp.filter);
    const statusBadge = { sicher: '<span class="badge aktiv">erkannt</span>', pruefen: '<span class="badge gekuendigt">bitte prüfen</span>', offen: '<span class="badge beendet">nicht zugeordnet</span>', doppelt: '<span class="badge beendet">schon importiert</span>', manuell: '<span class="badge aktiv">manuell</span>' };

    $("#view").innerHTML = `<h1>Kontoauszug abgleichen</h1><p class="sub">${esc(imp.dateien)} · ${rows.length} Zahlungseingänge · ${monthName(vonM)}${vonM !== bisM ? " bis " + monthName(bisM) : ""}</p>
    <div class="cards">
      <div class="card"><div class="lbl">Erkannt</div><div class="val">${cnt("sicher") + cnt("manuell")}</div></div>
      <div class="card"><div class="lbl">Bitte prüfen</div><div class="val" style="color:${cnt("pruefen") ? "var(--gekuendigt)" : "inherit"}">${cnt("pruefen")}</div></div>
      <div class="card"><div class="lbl">Nicht zugeordnet</div><div class="val">${cnt("offen")}</div><div class="lbl">z. B. andere Eingänge</div></div>
      <div class="card"><div class="lbl">Nach Übernahme offen</div><div class="val" style="color:${offenNachher.length ? "var(--danger)" : "inherit"}">${offenNachher.length}</div><div class="lbl">Verträge</div></div>
    </div>

    <div class="panel"><div class="panel-head"><h2>Noch nicht bezahlt</h2><span class="meta">bis ${monthName(bisM)}, wenn du die angehakten Zahlungen übernimmst</span></div>
    ${offenNachher.length ? `<div class="table-wrap"><table><tbody>${offenNachher.map(({ v, ks }) => { const g = garageById(v.garageId) || {}; return `<tr><td>${esc(standortById(g.standortId).name)} · <b>${esc(g.nummer)}</b></td><td>${esc(mieterName(mieterById(v.mieterId)))}</td><td>${ks.map(mKurz).join(", ")}</td><td class="num"><span class="badge offen">${eur(ks.length * gesamt(v))}</span></td></tr>`; }).join("")}</tbody></table></div>` : '<p class="hint">Alle Mieter haben bezahlt. 🎉</p>'}
    </div>

    <div class="toolbar">
      ${[["alle", "Alle"], ["pruefen", "Bitte prüfen"], ["offen", "Nicht zugeordnet"], ["sicher", "Erkannt"], ["doppelt", "Schon importiert"]].map(([k, l]) => `<button class="btn small ${imp.filter === k ? "primary" : ""}" data-if="${k}">${l}</button>`).join("")}
      <span class="grow"></span>
      <button class="btn" id="impCancel">Verwerfen</button>
      <button class="btn primary" id="impApply">${rows.filter((r) => r.use && r.target).length} Zahlungen übernehmen</button>
    </div>
    <div class="panel table-wrap"><table><thead><tr><th>✓</th><th>Datum</th><th>Zahler / Verwendungszweck</th><th class="num">Betrag</th><th>Zuordnung</th><th>Monate</th><th>Status</th></tr></thead><tbody>
    ${sichtbar.map((r) => {
      const i = rows.indexOf(r);
      const ms = Object.values(r.monate || {})[0] || [];
      return `<tr>
        <td><input type="checkbox" data-use="${i}" ${r.use ? "checked" : ""} ${r.target ? "" : "disabled"}></td>
        <td>${dfmt(r.t.datum)}</td>
        <td style="max-width:340px"><b>${esc(r.t.name || "")}</b><div class="hint" style="margin:0;word-break:break-word">${esc((r.t.quelle === "PDF" ? r.t.text : r.t.zweck || "").slice(0, 160))}</div></td>
        <td class="num"><b>${eur(r.t.betrag)}</b></td>
        <td style="min-width:220px"><select data-tgt="${i}">${vertragOpts.map(([v, l]) => `<option value="${esc(v)}" ${v === r.target ? "selected" : ""}>${esc(l)}</option>`).join("")}</select>${r.gruende?.length ? `<div class="hint" style="margin:2px 0 0">${esc(r.gruende.join(" · "))}</div>` : ""}</td>
        <td style="min-width:130px">${r.target && r.use ? `<input data-mon="${i}" value="${esc(ms.map(mKurz).join(", "))}" title="Monate im Format MM.JJJJ, mit Komma getrennt">` : '<span class="hint">–</span>'}</td>
        <td>${statusBadge[r.status] || ""}</td></tr>`;
    }).join("") || '<tr><td colspan="7" class="empty">Keine Einträge in dieser Ansicht.</td></tr>'}
    </tbody></table></div>
    <p class="hint">Beim Übernehmen merkt sich die App IBAN und Namen der Zahler. Beim nächsten Auszug werden dieselben Mieter dann automatisch erkannt, auch wenn z. B. die Ehefrau überweist.</p>`;

    $$("[data-if]").forEach((b) => (b.onclick = () => { imp.filter = b.dataset.if; views.import(); }));
    $("#impCancel").onclick = () => { imp = null; show("zahlungen"); };
    $$("[data-use]").forEach((cb) => (cb.onchange = () => { const r = rows[cb.dataset.use]; r.use = cb.checked; monateNeuBerechnen(); views.import(); }));
    $$("[data-tgt]").forEach((sel) => (sel.onchange = () => {
      const r = rows[sel.dataset.tgt];
      r.target = sel.value;
      r.manuell = null;
      const summe = zielVertraege(r.target).reduce((s, v) => s + gesamt(v), 0);
      r.n = passt(r.t.betrag, summe) ? Math.round(r.t.betrag / summe) : 1;
      r.use = !!r.target;
      r.status = r.target ? "manuell" : "offen";
      monateNeuBerechnen(); views.import();
    }));
    $$("[data-mon]").forEach((inp) => (inp.onchange = () => {
      const r = rows[inp.dataset.mon];
      const ks = inp.value.split(/[,;\s]+/).map((x) => { const m = /^(\d{1,2})[./-](\d{4})$/.exec(x.trim()); return m ? `${m[2]}-${m[1].padStart(2, "0")}` : null; }).filter(Boolean);
      if (!ks.length) { toast("Monate bitte als MM.JJJJ eingeben, z. B. 10.2026"); return views.import(); }
      r.manuell = {};
      zielVertraege(r.target).forEach((v) => (r.manuell[v.id] = ks));
      r.status = "manuell";
      monateNeuBerechnen(); views.import();
    }));
    $("#impApply").onclick = () => {
      let n = 0;
      rows.forEach((r) => {
        if (!r.use || !r.target) return;
        Object.entries(r.monate || {}).forEach(([vid, ks]) => {
          const z = (db.zahlungen[vid] = db.zahlungen[vid] || {});
          ks.forEach((k) => (z[k] = r.t.datum));
          const v = db.vertraege.find((x) => x.id === vid);
          if (r.t.iban) { v.zahlerIbans = v.zahlerIbans || []; if (!v.zahlerIbans.includes(r.t.iban)) v.zahlerIbans.push(r.t.iban); }
          const nm = Bank.norm(r.t.name);
          if (r.t.quelle === "CSV" && nm.length >= 4) { v.zahlerNamen = v.zahlerNamen || []; if (!v.zahlerNamen.includes(nm)) v.zahlerNamen.push(nm); }
        });
        db.importiert[r.key] = today();
        n++;
      });
      payMonth = bisM;
      imp = null;
      save();
      show("zahlungen");
      toast(`${n} Zahlungen übernommen`);
    };
  };

  /* ================= Dateien pro Garage ================= */
  const IDB = {
    db: null,
    open() {
      return this.db || (this.db = new Promise((res, rej) => {
        const r = indexedDB.open("gv-dateien", 1);
        r.onupgradeneeded = () => r.result.createObjectStore("f");
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      }));
    },
    async run(mode2, fn) {
      const d = await this.open();
      return new Promise((res, rej) => {
        const tx = d.transaction("f", mode2);
        const req = fn(tx.objectStore("f"));
        tx.oncomplete = () => res(req && req.result);
        tx.onerror = () => rej(tx.error);
      });
    },
    put(k, b) { return this.run("readwrite", (s) => s.put(b, k)); },
    get(k) { return this.run("readonly", (s) => s.get(k)); },
    del(k) { return this.run("readwrite", (s) => s.delete(k)); },
  };
  const dateiKey = (g, f) => `${g.id}/${f.id}`;
  async function bildVerkleinern(file) {
    if (!/^image\/(jpeg|png|webp)/.test(file.type)) return file;
    try {
      const bmp = await createImageBitmap(file);
      const sc = Math.min(1, 1800 / Math.max(bmp.width, bmp.height));
      const c = document.createElement("canvas");
      c.width = Math.round(bmp.width * sc); c.height = Math.round(bmp.height * sc);
      c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
      return blob && blob.size < file.size ? blob : file;
    } catch (e) { return file; }
  }
  async function dateiSpeichern(g, blob, name, art = "") {
    const f = { id: uid(), name, typ: blob.type || "application/octet-stream", groesse: blob.size, datum: today(), art };
    if (blob.size > 5.5 * 1024 * 1024) throw new Error(`${name}: zu groß (max. 5 MB)`);
    if (mode === "server") {
      const r = await fetch(`/api/files/${dateiKey(g, f)}`, { method: "PUT", headers: { "Content-Type": f.typ }, body: blob });
      if (!r.ok) throw new Error(`${name}: Upload fehlgeschlagen (${r.status})`);
    } else {
      await IDB.put(dateiKey(g, f), blob);
    }
    g.dateien = g.dateien || [];
    g.dateien.push(f);
    save();
    return f;
  }
  const urlCache = {};
  async function dateiUrl(g, f) {
    const k = dateiKey(g, f);
    if (mode === "server") return `/api/files/${k}`;
    if (!(k in urlCache)) { const b = await IDB.get(k).catch(() => null); urlCache[k] = b ? URL.createObjectURL(b) : ""; }
    return urlCache[k];
  }
  async function dateiLoeschen(g, f) {
    try {
      if (mode === "server") await fetch(`/api/files/${dateiKey(g, f)}`, { method: "DELETE" });
      else await IDB.del(dateiKey(g, f));
    } catch (e) { /* Datei evtl. schon weg */ }
    g.dateien = (g.dateien || []).filter((x) => x.id !== f.id);
    save();
  }
  // erzeugtes PDF zusätzlich in der Garagen-Akte ablegen
  function archivPdf(garage, doc, name, art) {
    dateiSpeichern(garage, doc.output("blob"), name, art).catch((e) => toast("Ablage in der Akte fehlgeschlagen: " + e.message));
  }

  /* ================= Geodaten ================= */
  function parseGeo(str) {
    str = String(str || "").trim();
    let m = str.match(/(-?\d{1,2}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/);
    if (m) return [parseFloat(m[1]), parseFloat(m[2])];
    m = str.match(/(-?\d{1,2}),(\d{3,})[\s;]+(-?\d{1,3}),(\d{3,})/);
    if (m) return [parseFloat(`${m[1]}.${m[2]}`), parseFloat(`${m[3]}.${m[4]}`)];
    return null;
  }
  const geoText = (g) => (g.lat && g.lng ? `${(+g.lat).toFixed(6)}, ${(+g.lng).toFixed(6)}` : "");
  const navUrl = (p) => `https://www.google.com/maps/dir/?api=1&destination=${p.lat},${p.lng}`;
  const kartenUrl = (p) => `https://www.google.com/maps/search/?api=1&query=${p.lat},${p.lng}`;
  function geoFuer(g) {
    if (g.lat && g.lng) return { lat: g.lat, lng: g.lng, eigen: true };
    const s = db.garagen.find((x) => x.standortId === g.standortId && x.lat && x.lng);
    return s ? { lat: s.lat, lng: s.lng, eigen: false, von: s } : null;
  }
  function geoAufnehmen(onOk) {
    if (!navigator.geolocation) return toast("Dieses Gerät kann keinen Standort liefern");
    toast("Standort wird ermittelt …");
    navigator.geolocation.getCurrentPosition(
      (p) => onOk(p.coords.latitude, p.coords.longitude, p.coords.accuracy),
      (e) => toast(e.code === 1 ? "Standortzugriff wurde nicht erlaubt (Browser-Einstellungen prüfen)" : "Standort konnte nicht ermittelt werden"),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  }

  /* ================= Garagen-Formular ================= */
  function garageForm(g) {
    const isNew = !g;
    g = g || { id: uid(), standortId: garagenFilter.standort || db.standorte[0]?.id, nummer: "", typ: "Garage", groesse: "", miete: "", nebenkosten: "", kaution: "", gesamtgewicht: "2", strom: false, notiz: "", vermieterId: "", art: "Eigentum" };
    const vOpts = [["", `Ich (${db.settings.name})`], ...(db.vermieter || []).map((x) => [x.id, x.name])];
    openModal(isNew ? "Neue Garage" : `Garage ${g.nummer} bearbeiten`, `
      <div class="grid">
        <label class="f">Standort<select name="standortId">${standortOptions().map(([v, l]) => `<option value="${esc(v)}" ${v === g.standortId ? "selected" : ""}>${esc(l)}</option>`).join("")}<option value="__neu">+ Neuer Standort …</option></select><span class="hint" id="stAdr"></span></label>
        <div class="full grid" id="neuSt" style="display:none">
          ${field("neuName", "Name des neuen Standorts", "", { attrs: 'placeholder="z. B. Zeitz, Schützenplatz"' })}
          ${field("neuAdresse", "Adresse", "", { attrs: 'placeholder="Straße, PLZ Ort"', hint: "Erscheint so im Mietvertrag." })}
        </div>
        ${field("nummer", "Nummer", g.nummer)}
        ${select("typ", "Typ", [["Garage", "Garage"], ["Stellplatz", "Stellplatz"]], g.typ)}
        ${field("groesse", "Größe in m² (optional)", g.groesse, { type: "number", attrs: 'step="0.1"' })}
        ${field("miete", "Standardmiete € / Monat", g.miete, { type: "number", attrs: 'step="0.01"' })}
        ${field("nebenkosten", "Standard-Nebenkosten € / Monat", g.nebenkosten, { type: "number", attrs: 'step="0.01"', hint: "Zahlt der Mieter zusätzlich (z. B. Hof)." })}
        ${field("kaution", "Standardkaution €", g.kaution, { type: "number", attrs: 'step="0.01"' })}
        ${field("gesamtgewicht", "Zul. Gesamtgewicht (t)", g.gesamtgewicht, { type: "number", attrs: 'step="0.5"' })}
        ${check("strom", "Stromanschluss vorhanden", g.strom)}
      </div>
      <fieldset><legend>Lage / Navigation</legend>
        <div class="geo-row">
          <input name="geo" value="${esc(geoText(g))}" placeholder="Koordinaten oder Google-Maps-Link einfügen">
          <button type="button" class="btn" id="geoGet" title="Aktuellen Standort des Handys übernehmen">📍 Aufnehmen</button>
          <button type="button" class="btn" id="geoNav" title="Navigation in Google Maps öffnen">🧭 Navigation</button>
        </div>
        <p class="hint" id="geoHint">Vor der Garage stehen und „Aufnehmen“ tippen, oder in Google Maps lange auf den Punkt drücken, Koordinaten kopieren und hier einfügen.</p>
      </fieldset>
      <fieldset><legend>Eigentümer &amp; Verpächter</legend><div class="grid">
        ${select("vermieterId", "Eigentümer / Vermieter im Vertrag", vOpts, g.vermieterId || "")}
        ${select("art", "Art", [["Eigentum", "Eigentumsgarage"], ["Pacht", "Pachtgarage"], ["Miete", "angemietet"]], g.art || "Eigentum")}
        ${area("verpaechter", "Verpächter / Garagengemeinschaft / Verwaltung (Kontakt)", g.verpaechter, { rows: 2 })}
      </div><p class="hint">Weitere Eigentümer legst du unter Einstellungen an.</p></fieldset>
      <fieldset><legend>Kosten &amp; Rendite</legend><div class="grid">
        ${field("kaufpreis", "Kaufpreis €", g.kaufpreis, { type: "number", attrs: 'step="0.01"' })}
        ${field("pachtJahr", "Pacht € / Jahr", g.pachtJahr, { type: "number", attrs: 'step="0.01"' })}
        ${field("grundsteuerJahr", "Grundsteuer € / Jahr", g.grundsteuerJahr, { type: "number", attrs: 'step="0.01"' })}
        ${field("beitragJahr", "Vereinsbeitrag € / Jahr", g.beitragJahr, { type: "number", attrs: 'step="0.01"' })}
        ${field("hausgeldMonat", "Hausgeld / Nebenkosten € / Monat", g.hausgeldMonat, { type: "number", attrs: 'step="0.01"', hint: "Was du als Eigentümer monatlich zahlst." })}
        ${field("sonstigeJahr", "Sonstige Kosten € / Jahr", g.sonstigeJahr, { type: "number", attrs: 'step="0.01"', hint: "Versicherung, Reparaturen …" })}
      </div><p class="hint" id="rendPrev"></p></fieldset>
      <div class="grid" style="margin-top:12px">${area("notiz", "Notiz (Zustand, Vormieter, offene Punkte …)", g.notiz, { rows: 3 })}</div>`,
      [...(isNew ? [] : [{ label: "Garage löschen", cls: "danger left", onClick: () => { loeschDialog({ titel: `Garage ${g.nummer} (${standortById(g.standortId).name}) löschen?`, garagen: [g] }); return false; } }]),
       { label: "Abbrechen" }, { label: "Speichern", cls: "primary", onClick: () => {
        const f = formValues($("#modalBody"));
        if (!f.nummer) { toast("Bitte eine Nummer angeben (oder „o. Nr.“)"); return false; }
        let neuerStandort = null;
        if (f.standortId === "__neu") {
          if (!f.neuName || !f.neuAdresse) { toast("Bitte Name und Adresse des neuen Standorts angeben"); return false; }
          neuerStandort = { id: uid(), name: f.neuName, adresse: f.neuAdresse, notiz: "" };
          f.standortId = neuerStandort.id;
        }
        delete f.neuName; delete f.neuAdresse;
        const alterStandort = g.standortId;
        if (db.garagen.some((x) => x.id !== g.id && x.standortId === f.standortId && String(x.nummer) === f.nummer)) { toast("Diese Nummer gibt es an dem Standort schon"); return false; }
        if (f.geo) {
          const p = parseGeo(f.geo);
          if (!p) { toast("Koordinaten nicht erkannt – Format z. B. 51.0456, 12.1345"); return false; }
          f.lat = p[0]; f.lng = p[1];
        } else { f.lat = ""; f.lng = ""; }
        delete f.geo;
        if (neuerStandort) db.standorte.push(neuerStandort);
        Object.assign(g, f);
        if (isNew) db.garagen.push(g);
        // alter Standort leer? -> automatisch entfernen
        let hinweis = "";
        if (!isNew && alterStandort && alterStandort !== g.standortId && !db.garagen.some((x) => x.standortId === alterStandort)) {
          const alt = db.standorte.find((x) => x.id === alterStandort);
          db.standorte = db.standorte.filter((x) => x.id !== alterStandort);
          if (alt) hinweis = ` · leerer Standort „${alt.name}“ entfernt`;
          if (garagenFilter.standort === alterStandort) garagenFilter.standort = "";
        }
        commit(); toast("Garage gespeichert" + hinweis);
      } }],
      (root) => {
        const stSel = $("[name=standortId]", root);
        const stUpd = () => {
          $("#neuSt", root).style.display = stSel.value === "__neu" ? "" : "none";
          $("#stAdr", root).textContent = stSel.value === "__neu" ? "" : standortById(stSel.value).adresse || "";
          if (stSel.value === "__neu") $("[name=neuName]", root).focus();
        };
        stSel.onchange = stUpd; stUpd();
        const geo = $("[name=geo]", root);
        $("#geoGet", root).onclick = () => geoAufnehmen((lat, lng, acc) => {
          geo.value = `${lat.toFixed(6)}, ${lng.toFixed(6)}`;
          $("#geoHint", root).textContent = `Standort übernommen (Genauigkeit ca. ± ${Math.round(acc)} m). Zum Übernehmen noch speichern.`;
        });
        $("#geoNav", root).onclick = () => {
          const p = parseGeo(geo.value);
          if (!p) return toast("Noch keine Koordinaten eingetragen");
          window.open(navUrl({ lat: p[0], lng: p[1] }), "_blank");
        };
        const prev = () => {
          const f = formValues(root);
          const v = laufenderVertrag(g.id);
          const ein = v ? gesamt(v) * 12 : (num(f.miete) + num(f.nebenkosten)) * 12;
          const kosten = kostenJahr(f);
          const ueb = ein - kosten;
          const kp = num(f.kaufpreis);
          $("#rendPrev", root).innerHTML = `${v ? "Einnahmen" : "Mögliche Einnahmen"} ${eur(ein)} / Jahr − Kosten ${eur(kosten)} = <b>${eur(ueb)}</b> Überschuss${kp > 0 ? ` · Rendite <b>${fmtPct(ueb / kp)}</b>` : ""}`;
        };
        $$("input", root).forEach((i) => i.addEventListener("input", prev));
        prev();
      });
  }

  /* ================= Garagen-Akte ================= */
  async function garageDetail(gid) {
    const g = garageById(gid);
    const s = standortById(g.standortId);
    const v = laufenderVertrag(gid);
    const m = v && mieterById(v.mieterId);
    const stt = garageStatus(g);
    const offen = v ? offeneMonate(v) : [];
    const warte = db.warteliste.filter((w) => !w.standortId || w.standortId === g.standortId);
    const geo = geoFuer(g);
    const kosten = kostenJahr(g);
    const ein = v ? gesamt(v) * 12 : 0;
    const kp = num(g.kaufpreis);
    const dateien = (g.dateien || []).slice().sort((a, b) => (b.datum || "").localeCompare(a.datum || ""));
    const urls = await Promise.all(dateien.map((f) => dateiUrl(g, f)));
    let body = `<p><span class="badge ${stt}">${statusLabel[stt]}</span> &nbsp;${esc(s.name)}, ${esc(s.adresse)} <button type="button" class="linkbtn" id="stChange" style="text-decoration:underline">Standort ändern</button></p>
    <div class="toolbar" style="margin:0 0 10px">
      ${geo ? `<a class="btn primary" href="${navUrl(geo)}" target="_blank" rel="noopener">🧭 Navigation</a><a class="btn" href="${kartenUrl(geo)}" target="_blank" rel="noopener">Karte</a><button type="button" class="btn" id="geoCopy">Koordinaten kopieren</button>${geo.eigen ? "" : `<span class="hint">Koordinaten von Garage ${esc(geo.von.nummer)} am selben Standort</span>`}`
        : `<button type="button" class="btn" id="geoNow">📍 Standort jetzt aufnehmen</button><span class="hint">Noch keine Koordinaten hinterlegt.</span>`}
    </div>
    <table><tbody>
      <tr><th>Typ</th><td>${esc(g.art === "Pacht" ? "Pachtgarage" : g.art === "Miete" ? "angemietet" : g.typ || "Garage")}${g.groesse ? ` · ca. ${esc(g.groesse)} m²` : ""}</td></tr>
      ${istEigen(g) ? "" : `<tr><th>Eigentümer</th><td>${esc(vermieterName(g))}</td></tr>`}
      ${g.verpaechter ? `<tr><th>Verpächter</th><td style="white-space:pre-line">${esc(g.verpaechter)}</td></tr>` : ""}
      <tr><th>Miete</th><td>${eur(v ? v.miete : g.miete)}${num(v ? v.nebenkosten : g.nebenkosten) > 0 ? ` + ${eur(v ? v.nebenkosten : g.nebenkosten)} NK` : ""}</td></tr>
      ${m ? `<tr><th>Mieter</th><td>${esc(mieterName(m))}${m.telefon ? ` · <a href="tel:${esc(m.telefon.replace(/\s/g, ""))}">${esc(m.telefon)}</a>` : ""}${m.kennzeichen ? ` · ${esc(m.kennzeichen)}` : ""}<div class="hint" style="margin:0">${esc([m.strasse, m.plzOrt].filter(Boolean).join(", ") || "Adresse fehlt")}</div></td></tr>
      <tr><th>Vertrag</th><td>${esc(v.nr)}${v.beginn ? ` seit ${dfmt(v.beginn)}` : ""}${v.status === "gekuendigt" ? ` · gekündigt zum ${dfmt(v.endeZum)}` : ""}</td></tr>
      <tr><th>Offen</th><td>${offen.length ? `<span class="badge offen">${offen.length} Monat(e) · ${eur(offen.length * gesamt(v))}</span>` : "nichts offen"}</td></tr>` : ""}
      <tr><th>Rendite</th><td>${hatKosten(g) || kp ? `Kosten ${eur(kosten)}/Jahr · Überschuss ${eur(ein - kosten)}/Jahr${kp ? ` · <b>${fmtPct((ein - kosten) / kp)}</b> auf ${eur(kp)}` : ""}` : '<span class="hint">Kosten noch nicht erfasst</span>'}</td></tr>
      ${g.notiz ? `<tr><th>Notiz</th><td style="white-space:pre-line">${esc(g.notiz)}</td></tr>` : ""}
    </tbody></table>
    <fieldset><legend>Akte · ${dateien.length} Datei(en)</legend>
      <div class="files">${dateien.map((f, i) => `
        <div class="file">
          <a href="${esc(urls[i])}" target="_blank" rel="noopener" class="thumb">${/^image\//.test(f.typ) && urls[i] ? `<img src="${esc(urls[i])}" alt="" loading="lazy">` : `<span class="ficon">${/pdf/.test(f.typ) ? "PDF" : "DATEI"}</span>`}</a>
          <div class="fname" title="${esc(f.name)}">${esc(f.name)}</div>
          <div class="fmeta">${dfmt(f.datum)}${f.art ? ` · ${esc(f.art)}` : ""} <button type="button" class="linkbtn" data-fdel="${f.id}" title="Löschen">✕</button></div>
        </div>`).join("") || '<span class="hint">Noch keine Dateien. Fotos, alte Verträge, Übergabeprotokolle …</span>'}</div>
      <div class="toolbar" style="margin:10px 0 0">
        <label class="btn">📷 Foto<input type="file" id="upCam" accept="image/*" capture="environment" hidden></label>
        <label class="btn">📎 Dateien hinzufügen<input type="file" id="upFile" accept="image/*,application/pdf,.doc,.docx,.xls,.xlsx,.txt" multiple hidden></label>
        <span class="hint" id="upState"></span>
      </div>
    </fieldset>`;
    if (!v && warte.length) {
      body += `<fieldset><legend>Warteliste</legend>${warte.map((w) => `<div>${esc(w.name)}${w.telefon ? ` · ${esc(w.telefon)}` : ""} <span class="hint">seit ${dfmt(w.datum)}</span></div>`).join("")}</fieldset>`;
    }
    const actions = [{ label: "Garage bearbeiten", cls: "left", onClick: () => { garageForm(g); return false; } }];
    if (v) {
      actions.push({ label: "Vertrag als PDF", onClick: () => { vertragPdf(v.id); return false; } });
      actions.push({ label: "Zum Vertrag", cls: "primary", onClick: () => { show("vertraege"); setTimeout(() => vertragForm(v), 0); } });
    } else {
      actions.push({ label: "Schließen" });
      actions.push({ label: "Vertrag anlegen", cls: "primary", onClick: () => { schnellVertrag({ garageId: g.id }); return false; } });
    }
    openModal(`${g.typ === "Stellplatz" ? "Stellplatz" : "Garage"} ${g.nummer} · ${s.name}`, body, actions, (root) => {
      $("#stChange", root).onclick = () => garageForm(g);
      if ($("#geoCopy", root)) $("#geoCopy", root).onclick = () => { navigator.clipboard?.writeText(`${geo.lat}, ${geo.lng}`); toast("Koordinaten kopiert"); };
      if ($("#geoNow", root)) $("#geoNow", root).onclick = () => geoAufnehmen((lat, lng, acc) => { g.lat = lat; g.lng = lng; save(); toast(`Standort gespeichert (± ${Math.round(acc)} m)`); garageDetail(gid); });
      const upload = async (files) => {
        const st = $("#upState", root);
        let ok = 0;
        for (const file of files) {
          st.textContent = `Lade ${file.name} …`;
          try {
            const blob = await bildVerkleinern(file);
            const name = blob !== file && !/\.jpe?g$/i.test(file.name) ? file.name.replace(/\.\w+$/, "") + ".jpg" : file.name;
            await dateiSpeichern(g, blob, name || `Foto ${today()}.jpg`, /^image\//.test(blob.type) ? "Foto" : "");
            ok++;
          } catch (e) { toast(e.message); }
        }
        if (ok) { toast(`${ok} Datei(en) gespeichert`); garageDetail(gid); } else st.textContent = "";
      };
      $("#upCam", root).onchange = (e) => upload([...e.target.files]);
      $("#upFile", root).onchange = (e) => upload([...e.target.files]);
      $$("[data-fdel]", root).forEach((b) => (b.onclick = () => {
        const f = g.dateien.find((x) => x.id === b.dataset.fdel);
        if (!confirm(`„${f.name}“ löschen?`)) return;
        dateiLoeschen(g, f).then(() => garageDetail(gid));
      }));
    });
  }

  /* ================= Rendite ================= */
  let renditeFilter = "eigen";
  views.rendite = () => {
    const passtFilter = (g) => renditeFilter === "alle" || (renditeFilter === "eigen" ? istEigen(g) : g.vermieterId === renditeFilter);
    const rows = db.garagen.filter(passtFilter).map((g) => {
      const v = laufenderVertrag(g.id);
      const ein = v ? gesamt(v) * 12 : 0;
      const kosten = kostenJahr(g);
      const kp = num(g.kaufpreis);
      return { g, v, ein, kosten, ueb: ein - kosten, kp, r: kp > 0 ? (ein - kosten) / kp : null };
    }).sort((a, b) => (b.r ?? -99) - (a.r ?? -99) || b.ueb - a.ueb);
    const sum = (k) => rows.reduce((s, x) => s + x[k], 0);
    const mitKp = rows.filter((x) => x.kp > 0);
    const gesamtR = mitKp.length ? mitKp.reduce((s, x) => s + x.ueb, 0) / mitKp.reduce((s, x) => s + x.kp, 0) : null;
    const leer = rows.filter((x) => !x.v);
    const leerVerlust = leer.reduce((s, x) => s + (num(x.g.miete) + num(x.g.nebenkosten)) * 12, 0);
    const ohneKosten = rows.filter((x) => !hatKosten(x.g)).length;
    const filterBtns = [["eigen", "Meine Garagen"], ...(db.vermieter || []).map((x) => [x.id, x.name]), ["alle", "Alle"]];
    $("#view").innerHTML = `<h1>Rendite</h1><p class="sub">Einnahmen aus laufenden Verträgen abzüglich Pacht, Grundsteuer, Beiträge und Hausgeld, pro Jahr</p>
    <div class="toolbar">${filterBtns.map(([k, l]) => `<button class="btn small ${renditeFilter === k ? "primary" : ""}" data-rf="${esc(k)}">${esc(l)}</button>`).join("")}</div>
    <div class="cards">
      <div class="card"><div class="lbl">Einnahmen / Jahr</div><div class="val">${eur(sum("ein"))}</div></div>
      <div class="card"><div class="lbl">Kosten / Jahr</div><div class="val">${eur(sum("kosten"))}</div>${ohneKosten ? `<div class="lbl">${ohneKosten} Garagen ohne Kosten</div>` : ""}</div>
      <div class="card"><div class="lbl">Überschuss / Jahr</div><div class="val">${eur(sum("ueb"))}</div><div class="lbl">${eur(sum("ueb") / 12)} pro Monat</div></div>
      <div class="card"><div class="lbl">Rendite</div><div class="val">${gesamtR === null ? "–" : fmtPct(gesamtR)}</div><div class="lbl">${mitKp.length} von ${rows.length} mit Kaufpreis</div></div>
      <div class="card"><div class="lbl">Leerstand kostet</div><div class="val" style="color:${leerVerlust ? "var(--danger)" : "inherit"}">${eur(leerVerlust)}</div><div class="lbl">${leer.length} frei, pro Jahr</div></div>
    </div>
    <div class="panel table-wrap">${rows.length ? `<table><thead><tr><th>Garage</th><th>Mieter</th><th class="num">Einnahmen</th><th class="num">Kosten</th><th class="num">Überschuss</th><th class="num">Kaufpreis</th><th class="num">Rendite</th></tr></thead><tbody>
    ${rows.map((x) => { const st = standortById(x.g.standortId); const m = x.v && mieterById(x.v.mieterId); return `<tr data-rg="${x.g.id}" style="cursor:pointer">
      <td>${esc(st.name)} · <b>${esc(x.g.nummer)}</b>${istEigen(x.g) ? "" : `<div class="hint" style="margin:0">${esc(vermieterName(x.g))}</div>`}</td>
      <td>${m ? esc(mieterName(m)) : '<span class="badge frei">frei</span>'}</td>
      <td class="num">${eur(x.ein)}</td>
      <td class="num">${hatKosten(x.g) ? eur(x.kosten) : '<span class="hint">fehlt</span>'}</td>
      <td class="num" style="color:${x.ueb < 0 ? "var(--danger)" : "inherit"}">${eur(x.ueb)}</td>
      <td class="num">${x.kp ? eur(x.kp) : '<span class="hint">–</span>'}</td>
      <td class="num"><b>${x.r === null ? "–" : fmtPct(x.r)}</b></td></tr>`; }).join("")}
    <tr><td colspan="2"><b>Summe</b></td><td class="num"><b>${eur(sum("ein"))}</b></td><td class="num"><b>${eur(sum("kosten"))}</b></td><td class="num"><b>${eur(sum("ueb"))}</b></td><td class="num"><b>${eur(sum("kp"))}</b></td><td class="num"><b>${gesamtR === null ? "–" : fmtPct(gesamtR)}</b></td></tr>
    </tbody></table>` : '<p class="empty">Keine Garagen in dieser Auswahl.</p>'}</div>
    <p class="hint">Zeile anklicken, um Kosten und Kaufpreis einzutragen. Die Rendite bezieht sich auf den Kaufpreis.</p>`;
    $$("[data-rf]").forEach((b) => (b.onclick = () => { renditeFilter = b.dataset.rf; rerender(); }));
    $$("[data-rg]").forEach((tr) => (tr.onclick = () => garageForm(garageById(tr.dataset.rg))));
  };

  /* ================= Weitere Vermieter / Eigentümer ================= */
  function vermieterForm(x) {
    const isNew = !x;
    x = x || { id: uid(), name: "", strasse: "", plzOrt: "", telefon: "", email: "", kontoinhaber: "", bank: "", iban: "", bic: "", kleinunternehmer: true };
    openModal(isNew ? "Eigentümer hinzufügen" : "Eigentümer bearbeiten", `<div class="grid">
      ${field("name", "Name", x.name)}${field("telefon", "Telefon", x.telefon, { type: "tel" })}
      ${field("strasse", "Straße, Nr.", x.strasse)}${field("plzOrt", "PLZ Ort", x.plzOrt)}
      ${field("email", "E-Mail", x.email, { type: "email" })}${field("kontoinhaber", "Kontoinhaber", x.kontoinhaber)}
      ${field("bank", "Bank", x.bank)}${field("iban", "IBAN", x.iban)}
      ${check("kleinunternehmer", "Kleinunternehmer (§ 19 UStG) – Hinweis in den Vertrag aufnehmen", x.kleinunternehmer !== false)}
      </div><p class="hint">Steht in Verträgen und Schreiben für Garagen dieses Eigentümers als Vermieter.</p>`,
      [{ label: "Abbrechen" }, { label: "Speichern", cls: "primary", onClick: () => {
        const f = formValues($("#modalBody"));
        if (!f.name) { toast("Bitte einen Namen angeben"); return false; }
        Object.assign(x, f);
        db.vermieter = db.vermieter || [];
        if (isNew) db.vermieter.push(x);
        commit();
      } }]);
  }

  /* ================= Warteliste ================= */
  views.warteliste = () => {
    const list = db.warteliste.slice().sort((a, b) => (a.datum || "").localeCompare(b.datum || ""));
    $("#view").innerHTML = `<h1>Warteliste</h1><p class="sub">Interessenten für frei werdende Garagen</p>
    <div class="toolbar"><span class="grow"></span><button class="btn primary" id="addW">+ Interessent</button></div>
    <div class="panel table-wrap">${list.length ? `<table><thead><tr><th>Seit</th><th>Name</th><th>Telefon</th><th>Standort</th><th>Notiz</th><th></th></tr></thead><tbody>
    ${list.map((w) => `<tr><td>${dfmt(w.datum)}</td><td><b>${esc(w.name)}</b></td><td>${esc(w.telefon || "")}</td><td>${w.standortId ? esc(standortById(w.standortId).name) : "egal"}</td><td>${esc(w.notiz || "")}</td>
      <td class="act"><button class="btn small" data-ew="${w.id}">Bearbeiten</button> <button class="btn small" data-mw="${w.id}">→ Mieter</button> <button class="btn small danger" data-xw="${w.id}">Entfernen</button></td></tr>`).join("")}
    </tbody></table>` : `<p class="empty">Niemand auf der Warteliste.</p>`}</div>`;
    $("#addW").onclick = () => warteForm();
    $$("[data-ew]").forEach((b) => (b.onclick = () => warteForm(db.warteliste.find((w) => w.id === b.dataset.ew))));
    $$("[data-xw]").forEach((b) => (b.onclick = () => { db.warteliste = db.warteliste.filter((w) => w.id !== b.dataset.xw); commit(); }));
    $$("[data-mw]").forEach((b) => (b.onclick = () => {
      const w = db.warteliste.find((x) => x.id === b.dataset.mw);
      const parts = w.name.split(" ");
      const m = { id: uid(), anrede: "", vorname: parts.slice(0, -1).join(" "), nachname: parts.slice(-1)[0], strasse: "", plzOrt: "", telefon: w.telefon || "", email: w.email || "", kennzeichen: "", notiz: w.notiz || "" };
      openModal("Als Mieter übernehmen", mieterFields(m), [{ label: "Abbrechen" }, { label: "Übernehmen", cls: "primary", onClick: () => {
        Object.assign(m, formValues($("#modalBody")));
        db.mieter.push(m);
        db.warteliste = db.warteliste.filter((x) => x.id !== w.id);
        commit(); toast("Mieter angelegt – jetzt Vertrag erstellen");
      } }]);
    }));
  };
  function warteForm(w) {
    const isNew = !w;
    w = w || { id: uid(), name: "", telefon: "", email: "", standortId: "", datum: today(), notiz: "" };
    openModal(isNew ? "Interessent hinzufügen" : "Interessent bearbeiten", `<div class="grid">
      ${field("name", "Name", w.name)}${field("telefon", "Telefon", w.telefon, { type: "tel" })}
      ${field("email", "E-Mail", w.email, { type: "email" })}${select("standortId", "Standort", [["", "egal"], ...standortOptions()], w.standortId)}
      ${field("datum", "Eingetragen am", w.datum, { type: "date" })}<span></span>${area("notiz", "Notiz", w.notiz, { rows: 2 })}</div>`,
      [{ label: "Abbrechen" }, { label: "Speichern", cls: "primary", onClick: () => {
        const f = formValues($("#modalBody"));
        if (!f.name) { toast("Bitte einen Namen angeben"); return false; }
        Object.assign(w, f);
        if (isNew) db.warteliste.push(w);
        commit();
      } }]);
  }

  /* ================= Einstellungen ================= */
  views.einstellungen = () => {
    const s = db.settings;
    $("#view").innerHTML = `<h1>Einstellungen</h1><p class="sub">Diese Angaben erscheinen in Verträgen und Schreiben</p>
    <div class="panel"><h2>Vermieter</h2><div class="grid" id="setForm">
      ${field("name", "Name", s.name)}${field("strasse", "Straße, Nr.", s.strasse)}
      ${field("plzOrt", "PLZ Ort", s.plzOrt)}${field("ort", "Ort für Unterschriften", s.ort)}
      ${field("telefon", "Telefon", s.telefon, { type: "tel" })}${field("email", "E-Mail", s.email, { type: "email" })}
      ${field("kontoinhaber", "Kontoinhaber", s.kontoinhaber)}${field("bank", "Bank", s.bank)}
      ${field("iban", "IBAN", s.iban, { attrs: 'placeholder="DE.."' })}${field("bic", "BIC (optional)", s.bic)}
    </div><div class="modal-actions"><button class="btn primary" id="saveSet">Speichern</button></div></div>

    <div class="panel"><h2>Vermieter-Unterschrift</h2><p class="hint" style="margin-top:-6px">Einmal hinterlegen und dann per Klick in Verträge und Schreiben einsetzen.</p>
      <div class="sig" style="grid-template-columns:minmax(0,420px)"><div class="sig-box"><canvas id="cvSet"></canvas><div class="row"><button class="btn small" id="clrSet">Löschen</button><button class="btn small primary" id="saveSig">Unterschrift speichern</button></div></div></div>
    </div>

    <div class="panel"><div class="panel-head"><h2>Weitere Eigentümer</h2><span class="meta">für Garagen, die nicht dir gehören</span><div class="actions"><button class="btn small primary" id="addVerm">+ Eigentümer</button></div></div>
      ${(db.vermieter || []).length ? `<table><tbody>${db.vermieter.map((x) => `<tr><td><b>${esc(x.name)}</b></td><td>${esc([x.strasse, x.plzOrt].filter(Boolean).join(", "))}</td><td>${db.garagen.filter((g) => g.vermieterId === x.id).length} Garagen</td><td class="act"><button class="btn small" data-ev2="${x.id}">Bearbeiten</button></td></tr>`).join("")}</tbody></table>` : '<p class="hint">Keine weiteren Eigentümer angelegt.</p>'}
    </div>

    <div class="panel"><h2>Daten</h2>
      <div class="toolbar" style="margin:0">
        <button class="btn" id="expJson">Komplett-Sicherung (JSON)</button>
        <button class="btn" id="expCsv">Garagenliste (CSV für Excel)</button>
        <label class="btn primary" style="cursor:pointer">Daten ergänzen (Import-Datei)<input type="file" id="impMerge" accept=".json" hidden></label>
        <label class="btn" style="cursor:pointer">Sicherung einspielen (ersetzt alles)<input type="file" id="impJson" accept=".json" hidden></label>
      </div>
      <p class="hint">${mode === "server" ? "Die Daten liegen online in Netlify Blobs. Zusätzlich wird jeden Tag automatisch ein Backup angelegt." : "Lokaler Modus: Die Daten liegen nur in diesem Browser. Bitte regelmäßig eine Sicherung herunterladen."}</p>
    </div>`;
    $("#saveSet").onclick = () => { Object.assign(db.settings, formValues($("#setForm"))); save(); toast("Einstellungen gespeichert"); };
    const pad = signaturePad($("#cvSet"), s.sigVermieter);
    $("#clrSet").onclick = () => pad.clear();
    $("#saveSig").onclick = () => { db.settings.sigVermieter = pad.value(); save(); toast(db.settings.sigVermieter ? "Unterschrift gespeichert" : "Unterschrift entfernt"); };
    $("#expJson").onclick = () => downloadText(JSON.stringify(db, null, 1), `garagenverwaltung-sicherung-${today()}.json`, "application/json");
    $("#expCsv").onclick = () => {
      const rows = [["Standort", "Adresse", "Nr", "Typ", "Status", "Mieter", "Telefon", "Miete", "Kaution", "Vertrag", "Beginn", "Ende zum"]];
      db.garagen.slice().sort(sortGaragen).forEach((g) => {
        const st = standortById(g.standortId), v = laufenderVertrag(g.id), m = v && mieterById(v.mieterId);
        rows.push([st.name, st.adresse, g.nummer, g.typ || "Garage", statusLabel[garageStatus(g)], m ? mieterName(m) : "", m?.telefon || "",
          String(v ? v.miete : g.miete || "").replace(".", ","), String(v ? v.kaution : g.kaution || "").replace(".", ","), v?.nr || "", v ? dfmt(v.beginn) : "", v ? dfmt(v.endeZum) : ""]);
      });
      const csv = "﻿" + rows.map((r) => r.map((x) => `"${String(x ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
      downloadText(csv, `garagen-${today()}.csv`, "text/csv;charset=utf-8");
    };
    $("#addVerm").onclick = () => vermieterForm();
    $$("[data-ev2]").forEach((b) => (b.onclick = () => vermieterForm(db.vermieter.find((x) => x.id === b.dataset.ev2))));
    $("#impMerge").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const arten = ["vermieter", "standorte", "garagen", "mieter", "vertraege", "warteliste"];
        const neu = {};
        arten.forEach((k) => { const ids = new Set((db[k] || []).map((x) => x.id)); neu[k] = (data[k] || []).filter((x) => !ids.has(x.id)); });
        const n = arten.reduce((s, k) => s + neu[k].length, 0);
        if (!n) return alertModal("Nichts Neues", "Alle Einträge aus dieser Datei sind bereits vorhanden.");
        confirmModal("Daten ergänzen?", `Es werden hinzugefügt: ${neu.standorte.length} Standorte, ${neu.garagen.length} Garagen, ${neu.mieter.length} Mieter, ${neu.vertraege.length} Verträge${neu.vermieter.length ? `, ${neu.vermieter.length} Eigentümer` : ""}. Vorhandene Daten bleiben unverändert.`, () => {
          arten.forEach((k) => { db[k] = (db[k] || []).concat(neu[k]); });
          Object.entries(data.zahlungen || {}).forEach(([vid, z]) => { db.zahlungen[vid] = Object.assign({}, z, db.zahlungen[vid] || {}); });
          db.seq = Math.max(db.seq || 0, data.seq || 0);
          commit(); toast(`${n} Einträge ergänzt`);
        }, "Ergänzen");
      } catch (err) { alertModal("Fehler", "Die Datei ist keine gültige Import-Datei."); }
      e.target.value = "";
    };
    $("#impJson").onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data.garagen || !data.vertraege) throw new Error("format");
        confirmModal("Sicherung einspielen?", `Alle aktuellen Daten werden durch die Sicherung ersetzt (${data.garagen.length} Garagen, ${data.vertraege.length} Verträge).`, () => {
          db = Object.assign(emptyDb(), data); commit(); toast("Sicherung eingespielt");
        }, "Ersetzen");
      } catch (err) { alertModal("Fehler", "Die Datei ist keine gültige Sicherung."); }
    };
  };

  /* ================= Start ================= */
  $$("#tabs button").forEach((b) => (b.onclick = () => show(b.dataset.view)));
  modal.addEventListener("cancel", () => {});
  (async () => {
    $("#view").innerHTML = '<p class="empty">Lade Daten …</p>';
    await load();
    let start = "uebersicht";
    try { start = localStorage.getItem("gv-tab") || start; } catch (_) { /* */ }
    show(views[start] ? start : "uebersicht");
  })();

  // für Tests
  window.__gv = { kuendigungZum, get db() { return db; } };
})();
