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
  const num = (v) => { const n = parseFloat(String(v).replace(",", ".")); return isNaN(n) ? 0 : n; };

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

  function save() {
    clearTimeout(saveTimer);
    setSync("Speichert …");
    saveTimer = setTimeout(doSave, 500);
  }

  async function doSave() {
    if (mode === "local") {
      try { localStorage.setItem(LOCAL_KEY, JSON.stringify(db)); setSync("Lokal gespeichert"); }
      catch (e) { setSync("Speichern fehlgeschlagen", true); }
      return;
    }
    try {
      const r = await fetch("/api/db", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version, data: db }),
      });
      if (r.status === 409) {
        setSync("Konflikt – bitte neu laden", true);
        alertModal("Zwischenzeitlich gespeichert", "Jemand anderes hat in der Zwischenzeit Änderungen gespeichert. Bitte lade die Seite neu, damit nichts überschrieben wird. Deine letzte Änderung ist dann noch einmal einzutragen.");
        return;
      }
      if (!r.ok) throw new Error(r.status);
      const res = await r.json();
      version = res.version;
      setSync("Gespeichert " + new Date(res.savedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" }));
    } catch (e) {
      setSync("Nicht gespeichert – Verbindung prüfen", true);
    }
  }

  /* ================= Abgeleitete Werte ================= */
  const standortById = (id) => db.standorte.find((s) => s.id === id) || { name: "?", adresse: "" };
  const garageById = (id) => db.garagen.find((g) => g.id === id);
  const mieterById = (id) => db.mieter.find((m) => m.id === id);
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
    modal.showModal();
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
      value() { return dirty ? canvas.toDataURL("image/png") : null; },
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

  /* ================= Übersicht ================= */
  views.uebersicht = () => {
    const gs = db.garagen;
    const st = { frei: 0, vermietet: 0, gekuendigt: 0 };
    gs.forEach((g) => st[garageStatus(g)]++);
    const laufend = db.vertraege.filter((v) => v.status === "aktiv" || v.status === "gekuendigt");
    const soll = laufend.reduce((s, v) => s + num(v.miete), 0);
    let offenSumme = 0, offenMieter = 0;
    laufend.forEach((v) => { const o = offeneMonate(v); if (o.length) { offenMieter++; offenSumme += o.length * num(v.miete); } });
    const auszuege = db.vertraege.filter((v) => v.status === "gekuendigt").sort((a, b) => (a.endeZum || "").localeCompare(b.endeZum || ""));

    let html = `<h1>Übersicht</h1><p class="sub">${db.standorte.length} Standorte · ${gs.length} Garagen</p>
    <div class="cards">
      <div class="card"><div class="lbl">Vermietet</div><div class="val">${st.vermietet + st.gekuendigt}</div></div>
      <div class="card"><div class="lbl">Frei</div><div class="val">${st.frei}</div></div>
      <div class="card"><div class="lbl">Gekündigt</div><div class="val">${st.gekuendigt}</div></div>
      <div class="card"><div class="lbl">Sollmiete / Monat</div><div class="val">${eur(soll)}</div></div>
      <div class="card"><div class="lbl">Offene Mieten</div><div class="val" style="color:${offenSumme ? "var(--danger)" : "inherit"}">${eur(offenSumme)}</div><div class="lbl">${offenMieter} Mieter</div></div>
    </div>`;

    if (!gs.length) {
      html += `<div class="panel empty">Noch keine Garagen angelegt.<br><br><button class="btn primary" id="goGaragen">Standort &amp; Garagen anlegen</button></div>`;
      $("#view").innerHTML = html;
      $("#goGaragen").onclick = () => show("garagen");
      return;
    }

    if (auszuege.length) {
      html += `<div class="panel"><div class="panel-head"><h2>Anstehende Auszüge</h2></div><div class="table-wrap"><table><tbody>
      ${auszuege.map((v) => { const g = garageById(v.garageId) || {}; return `<tr><td>${esc(standortById(g.standortId).name)} · Nr. ${esc(g.nummer)}</td><td>${esc(mieterName(mieterById(v.mieterId)))}</td><td class="num">zum ${dfmt(v.endeZum)}</td><td class="act"><button class="btn small" data-end="${v.id}">Rückgabe erledigt</button></td></tr>`; }).join("")}
      </tbody></table></div></div>`;
    }

    html += `<div class="legend"><span class="l-frei">frei</span><span class="l-verm">vermietet</span><span class="l-gek">gekündigt</span></div>`;
    db.standorte.slice().sort((a, b) => a.name.localeCompare(b.name, "de")).forEach((s) => {
      const list = gs.filter((g) => g.standortId === s.id).sort(sortGaragen);
      const frei = list.filter((g) => garageStatus(g) === "frei").length;
      const warte = db.warteliste.filter((w) => !w.standortId || w.standortId === s.id).length;
      html += `<div class="panel"><div class="panel-head"><h2>${esc(s.name)}</h2><span class="meta">${esc(s.adresse)} · ${list.length} Garagen · ${frei} frei${warte ? ` · ${warte} auf Warteliste` : ""}</span></div>
      <div class="tiles">${list.map((g) => {
        const stt = garageStatus(g);
        const v = laufenderVertrag(g.id);
        const m = v && mieterById(v.mieterId);
        return `<button class="tile ${stt}" data-g="${g.id}"><div class="nr">${esc(g.typ === "Stellplatz" ? "SP " : "")}${esc(g.nummer)}</div><div class="who">${m ? esc(m.nachname || mieterName(m)) : "frei"}</div></button>`;
      }).join("") || '<span class="hint">Keine Garagen an diesem Standort.</span>'}</div></div>`;
    });
    $("#view").innerHTML = html;
    $$(".tile").forEach((t) => (t.onclick = () => garageDetail(t.dataset.g)));
    $$("[data-end]").forEach((b) => (b.onclick = () => vertragBeenden(b.dataset.end)));
  };

  function garageDetail(gid) {
    const g = garageById(gid);
    const s = standortById(g.standortId);
    const v = laufenderVertrag(gid);
    const m = v && mieterById(v.mieterId);
    const stt = garageStatus(g);
    const offen = v ? offeneMonate(v) : [];
    const warte = db.warteliste.filter((w) => !w.standortId || w.standortId === g.standortId);
    let body = `<p><span class="badge ${stt}">${statusLabel[stt]}</span> &nbsp;${esc(s.name)}, ${esc(s.adresse)}</p>
    <table><tbody>
      <tr><th>Typ</th><td>${esc(g.typ || "Garage")}${g.groesse ? ` · ca. ${esc(g.groesse)} m²` : ""}</td></tr>
      <tr><th>Miete</th><td>${eur(v ? v.miete : g.miete)}</td></tr>
      ${m ? `<tr><th>Mieter</th><td>${esc(mieterName(m))}${m.telefon ? ` · ${esc(m.telefon)}` : ""}${m.kennzeichen ? ` · ${esc(m.kennzeichen)}` : ""}</td></tr>
      <tr><th>Vertrag</th><td>${esc(v.nr)} seit ${dfmt(v.beginn)}${v.status === "gekuendigt" ? ` · gekündigt zum ${dfmt(v.endeZum)}` : ""}</td></tr>
      <tr><th>Offen</th><td>${offen.length ? `<span class="badge offen">${offen.length} Monat(e) · ${eur(offen.length * num(v.miete))}</span>` : "nichts offen"}</td></tr>` : ""}
      ${g.notiz ? `<tr><th>Notiz</th><td>${esc(g.notiz)}</td></tr>` : ""}
    </tbody></table>`;
    if (!v && warte.length) {
      body += `<fieldset><legend>Warteliste</legend>${warte.map((w) => `<div>${esc(w.name)}${w.telefon ? ` · ${esc(w.telefon)}` : ""} <span class="hint">seit ${dfmt(w.datum)}</span></div>`).join("")}</fieldset>`;
    }
    const actions = [{ label: "Garage bearbeiten", cls: "left", onClick: () => { garageForm(g); return false; } }];
    if (v) {
      actions.push({ label: "Vertrag als PDF", onClick: () => { vertragPdf(v.id); return false; } });
      actions.push({ label: "Zum Vertrag", cls: "primary", onClick: () => { show("vertraege"); setTimeout(() => vertragForm(v), 0); } });
    } else {
      actions.push({ label: "Schließen" });
      actions.push({ label: "Vertrag anlegen", cls: "primary", onClick: () => { vertragForm(null, { garageId: g.id }); return false; } });
    }
    openModal(`${g.typ === "Stellplatz" ? "Stellplatz" : "Garage"} Nr. ${g.nummer}`, body, actions);
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
    $("#view").innerHTML = `<h1>Garagen</h1><p class="sub">Standorte und einzelne Garagen bzw. Stellplätze verwalten</p>
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
        return `<tr><td>${esc(standortById(g.standortId).name)}</td><td><b>${esc(g.nummer)}</b></td><td>${esc(g.typ || "Garage")}</td><td class="num">${esc(g.groesse || "")}</td><td class="num">${eur(v ? v.miete : g.miete)}</td>
        <td><span class="badge ${stt}">${statusLabel[stt]}</span></td><td>${esc(m ? mieterName(m) : "")}</td>
        <td class="act"><button class="btn small" data-dg="${g.id}">Details</button> <button class="btn small" data-eg="${g.id}">Bearbeiten</button> <button class="btn small danger" data-xg="${g.id}">Löschen</button></td></tr>`;
      }).join("")}</tbody></table>` : `<p class="empty">Keine Garagen gefunden.</p>`}</div>`;

    $("#addStandort").onclick = () => standortForm();
    $$("[data-es]").forEach((b) => (b.onclick = () => standortForm(db.standorte.find((s) => s.id === b.dataset.es))));
    $$("[data-ds]").forEach((b) => (b.onclick = () => {
      const s = db.standorte.find((x) => x.id === b.dataset.ds);
      if (db.garagen.some((g) => g.standortId === s.id)) return alertModal("Nicht möglich", "Diesem Standort sind noch Garagen zugeordnet. Bitte zuerst die Garagen löschen oder verschieben.");
      confirmModal("Standort löschen?", `„${s.name}“ wird gelöscht.`, () => { db.standorte = db.standorte.filter((x) => x.id !== s.id); commit(); });
    }));
    $("#fStandort").onchange = (e) => { garagenFilter.standort = e.target.value; rerender(); };
    $("#fQ").oninput = (e) => { garagenFilter.q = e.target.value; clearTimeout(views._q); views._q = setTimeout(() => { rerender(); const i = $("#fQ"); i.focus(); i.setSelectionRange(i.value.length, i.value.length); }, 250); };
    $("#addGarage").onclick = () => garageForm(null);
    $("#bulkGaragen").onclick = bulkForm;
    $$("[data-dg]").forEach((b) => (b.onclick = () => garageDetail(b.dataset.dg)));
    $$("[data-eg]").forEach((b) => (b.onclick = () => garageForm(garageById(b.dataset.eg))));
    $$("[data-xg]").forEach((b) => (b.onclick = () => {
      const g = garageById(b.dataset.xg);
      if (db.vertraege.some((v) => v.garageId === g.id)) return alertModal("Nicht möglich", "Für diese Garage gibt es Verträge (auch beendete). Sie bleibt zur Dokumentation erhalten.");
      confirmModal("Garage löschen?", `Garage Nr. ${g.nummer} wird gelöscht.`, () => { db.garagen = db.garagen.filter((x) => x.id !== g.id); commit(); });
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

  function garageForm(g) {
    const isNew = !g;
    g = g || { id: uid(), standortId: garagenFilter.standort || db.standorte[0]?.id, nummer: "", typ: "Garage", groesse: "", miete: "", kaution: "", gesamtgewicht: "2", strom: false, notiz: "" };
    openModal(isNew ? "Neue Garage" : `Garage Nr. ${g.nummer} bearbeiten`, `<div class="grid">
      ${select("standortId", "Standort", standortOptions(), g.standortId)}
      ${field("nummer", "Nummer", g.nummer)}
      ${select("typ", "Typ", [["Garage", "Garage"], ["Stellplatz", "Stellplatz"]], g.typ)}
      ${field("groesse", "Größe in m² (optional)", g.groesse, { type: "number", attrs: 'step="0.1"' })}
      ${field("miete", "Standardmiete € / Monat", g.miete, { type: "number", attrs: 'step="0.01"' })}
      ${field("kaution", "Standardkaution €", g.kaution, { type: "number", attrs: 'step="0.01"' })}
      ${field("gesamtgewicht", "Zul. Gesamtgewicht (t)", g.gesamtgewicht, { type: "number", attrs: 'step="0.5"' })}
      ${check("strom", "Stromanschluss vorhanden", g.strom)}
      ${area("notiz", "Notiz (Zustand, Schäden …)", g.notiz, { rows: 2 })}</div>`,
      [{ label: "Abbrechen" }, { label: "Speichern", cls: "primary", onClick: () => {
        const f = formValues($("#modalBody"));
        if (!f.nummer) { toast("Bitte eine Nummer angeben"); return false; }
        if (db.garagen.some((x) => x.id !== g.id && x.standortId === f.standortId && String(x.nummer) === f.nummer)) { toast("Diese Nummer gibt es an dem Standort schon"); return false; }
        Object.assign(g, f);
        if (isNew) db.garagen.push(g);
        commit(); toast("Garage gespeichert");
      } }]);
  }

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
      if (db.vertraege.some((v) => v.mieterId === m.id)) return alertModal("Nicht möglich", "Für diesen Mieter gibt es Verträge. Er bleibt zur Dokumentation erhalten.");
      confirmModal("Mieter löschen?", `${mieterName(m)} wird gelöscht.`, () => { db.mieter = db.mieter.filter((x) => x.id !== m.id); commit(); });
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
      return `<tr><td>${esc(v.nr)}</td><td>${esc(standortById(g.standortId).name)} · <b>${esc(g.nummer)}</b></td><td>${esc(mieterName(m))}</td><td>${dfmt(v.beginn)}</td><td class="num">${eur(v.miete)}</td>
      <td><span class="badge ${v.status}">${statusLabel[v.status]}</span>${v.endeZum && v.status !== "aktiv" ? `<div class="hint">zum ${dfmt(v.endeZum)}</div>` : ""}</td><td>${sig}</td>
      <td class="act"><button class="btn small" data-pdf="${v.id}">PDF</button> <button class="btn small" data-sign="${v.id}">Unterschreiben</button> <button class="btn small" data-ev="${v.id}">Bearbeiten</button>
      ${v.status !== "beendet" ? `<button class="btn small" data-brief="${v.id}">Schreiben …</button>` : ""}</td></tr>`;
    }).join("")}</tbody></table>` : `<p class="empty">Keine Verträge in dieser Ansicht.</p>`}</div>`;
    $$("[data-vf]").forEach((b) => (b.onclick = () => { vertragFilter = b.dataset.vf; rerender(); }));
    $("#addVertrag").onclick = () => vertragForm(null);
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
      id: uid(), nr: "", garageId: preset.garageId || "", mieterId: "", beginn: today(), miete: g0?.miete || "", kaution: g0?.kaution || "",
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
    return { v, garage, standort: standortById(garage.standortId), mieter: mieterById(v.mieterId), s: db.settings };
  }

  function vertragPdf(vid) {
    const c = ctx(vid);
    const doc = Docs.mietvertrag(c);
    downloadPdf(doc, `Mietvertrag ${c.v.nr} ${c.standort.name} Garage ${c.garage.nummer} ${c.mieter.nachname}.pdf`);
    toast("PDF erstellt");
  }

  function signForm(vid) {
    const c = ctx(vid);
    const v = c.v;
    let padM, padV;
    openModal(`Unterschriften · ${v.nr}`, `
      <p class="sub" style="margin:0 0 12px">${esc(c.standort.name)} · Garage ${esc(c.garage.nummer)} · ${esc(mieterName(c.mieter))} · ${eur(v.miete)} / Monat</p>
      <p class="hint" style="margin:0 0 12px">Mit Finger, Stift oder Maus unterschreiben. Tipp: Vorher das PDF zeigen, damit der Mieter den Vertrag lesen kann.</p>
      <div class="sig">
        <div class="sig-box"><div class="row"><b>Mieter</b><button type="button" class="btn small" id="clrM">Löschen</button></div><canvas id="cvM"></canvas><span class="hint">${esc(mieterName(c.mieter))}</span></div>
        <div class="sig-box"><div class="row"><b>Vermieter</b><span><button type="button" class="btn small" id="useV" ${db.settings.sigVermieter ? "" : "disabled"} title="In den Einstellungen hinterlegte Unterschrift einsetzen">Gespeicherte</button> <button type="button" class="btn small" id="clrV">Löschen</button></span></div><canvas id="cvV"></canvas><span class="hint">${esc(db.settings.name)}</span></div>
      </div>
      <div class="grid" style="margin-top:12px">${field("ort", "Ort", v.ort || db.settings.ort)}${field("datum", "Datum", v.datum || today(), { type: "date" })}</div>`,
      [
        { label: "Abbrechen" },
        { label: "Speichern", onClick: () => { store(); toast("Unterschriften gespeichert"); } },
        { label: "Speichern & PDF", cls: "primary", onClick: () => { store(); vertragPdf(vid); } },
      ],
      (root) => {
        padM = signaturePad($("#cvM", root), v.sigMieter);
        padV = signaturePad($("#cvV", root), v.sigVermieter);
        $("#clrM", root).onclick = () => padM.clear();
        $("#clrV", root).onclick = () => padV.clear();
        $("#useV", root).onclick = () => padV.load(db.settings.sigVermieter);
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
    const betrag = offen.length * num(v.miete);
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
        ${check("mitUnterschrift", "Gespeicherte Vermieter-Unterschrift einsetzen", !!db.settings.sigVermieter)}
        <label class="f check full" data-only="kuendigung"><input type="checkbox" name="markieren" checked> Vertrag als gekündigt markieren</label>
      </div>`,
      [{ label: "Abbrechen" }, { label: "PDF erstellen", cls: "primary", onClick: () => {
        const f = formValues($("#modalBody"));
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
    const soll = list.reduce((s, v) => s + num(v.miete), 0);
    const ist = list.filter((v) => bezahlt(v.id, payMonth)).reduce((s, v) => s + num(v.miete), 0);
    $("#view").innerHTML = `<h1>Mieteingänge</h1><p class="sub">Haken setzen, sobald die Miete auf dem Konto ist</p>
    <div class="toolbar">
      <button class="btn" id="pPrev">‹</button><b style="min-width:150px;text-align:center">${monthName(payMonth)}</b><button class="btn" id="pNext">›</button>
      <span class="grow"></span>
      <button class="btn" id="pAll">Alle als bezahlt markieren</button>
    </div>
    <div class="cards">
      <div class="card"><div class="lbl">Soll</div><div class="val">${eur(soll)}</div></div>
      <div class="card"><div class="lbl">Eingegangen</div><div class="val">${eur(ist)}</div></div>
      <div class="card"><div class="lbl">Fehlt</div><div class="val" style="color:${soll - ist > 0 ? "var(--danger)" : "inherit"}">${eur(soll - ist)}</div></div>
    </div>
    <div class="panel table-wrap">${list.length ? `<table><thead><tr><th class="pay-cell">Bezahlt</th><th>Garage</th><th>Mieter</th><th class="num">Miete</th><th>Rückstand gesamt</th><th></th></tr></thead><tbody>
    ${list.map((v) => {
      const g = garageById(v.garageId) || {}, o = offeneMonate(v);
      return `<tr><td class="pay-cell"><input type="checkbox" data-pay="${v.id}" ${bezahlt(v.id, payMonth) ? "checked" : ""}></td><td>${esc(standortById(g.standortId).name)} · <b>${esc(g.nummer)}</b></td><td>${esc(mieterName(mieterById(v.mieterId)))}</td><td class="num">${eur(v.miete)}</td>
      <td>${o.length ? `<span class="badge offen" title="${esc(o.map(monthName).join(", "))}">${o.length} Monat(e) · ${eur(o.length * num(v.miete))}</span>` : '<span class="hint">–</span>'}</td>
      <td class="act">${o.length ? `<button class="btn small" data-brief="${v.id}">Erinnerung …</button>` : ""}</td></tr>`;
    }).join("")}</tbody></table>` : `<p class="empty">Keine laufenden Verträge in diesem Monat.</p>`}</div>`;
    $("#pPrev").onclick = () => { payMonth = addMonths(payMonth, -1); rerender(); };
    $("#pNext").onclick = () => { payMonth = addMonths(payMonth, 1); rerender(); };
    $("#pAll").onclick = () => { list.forEach((v) => { (db.zahlungen[v.id] = db.zahlungen[v.id] || {})[payMonth] = today(); }); commit(); };
    $$("[data-pay]").forEach((cb) => (cb.onchange = () => {
      const z = (db.zahlungen[cb.dataset.pay] = db.zahlungen[cb.dataset.pay] || {});
      if (cb.checked) z[payMonth] = today(); else delete z[payMonth];
      commit();
    }));
    $$("[data-brief]").forEach((b) => (b.onclick = () => briefForm(b.dataset.brief)));
  };

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

    <div class="panel"><h2>Daten</h2>
      <div class="toolbar" style="margin:0">
        <button class="btn" id="expJson">Komplett-Sicherung (JSON)</button>
        <button class="btn" id="expCsv">Garagenliste (CSV für Excel)</button>
        <label class="btn" style="cursor:pointer">Sicherung einspielen<input type="file" id="impJson" accept=".json" hidden></label>
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
