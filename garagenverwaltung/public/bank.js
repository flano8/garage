/* Kontoauszüge einlesen (DKB CSV alt/neu, generische CSV, PDF-Kontoauszug) */
window.Bank = (() => {
  function decode(buf) {
    let t = new TextDecoder("utf-8").decode(buf);
    if (t.includes("�")) t = new TextDecoder("windows-1252").decode(buf);
    return t.replace(/^﻿/, "");
  }

  function parseCsv(text, sep) {
    const rows = [];
    let row = [], cell = "", q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === sep) { row.push(cell); cell = ""; }
      else if (c === "\n" || c === "\r") {
        if (c === "\r" && text[i + 1] === "\n") i++;
        row.push(cell); rows.push(row); row = []; cell = "";
      } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows.map((r) => r.map((x) => x.trim()));
  }

  function parseAmount(s) {
    s = String(s ?? "").replace(/\s|€|EUR/gi, "");
    if (!s) return NaN;
    let neg = false;
    if (/^-/.test(s) || /-$/.test(s)) neg = true;
    s = s.replace(/^[+-]|[+-]$/g, "");
    if (/,\d{1,2}$/.test(s)) s = s.replace(/\./g, "").replace(",", ".");
    else s = s.replace(/,/g, "");
    const n = parseFloat(s);
    return isNaN(n) ? NaN : neg ? -n : n;
  }

  function parseDate(s, fallbackYear) {
    const m = /(\d{1,2})\.(\d{1,2})\.(\d{2,4})?/.exec(String(s || ""));
    if (!m) return null;
    let y = m[3] ? Number(m[3]) : fallbackYear;
    if (!y) return null;
    if (y < 100) y += 2000;
    const mo = Number(m[2]), d = Number(m[1]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }

  function fromCsv(text) {
    const first = text.split(/\r?\n/).slice(0, 15).join("\n");
    const sep = (first.match(/;/g) || []).length >= (first.match(/,/g) || []).length ? ";" : ",";
    const rows = parseCsv(text, sep);
    const hi = rows.findIndex((r) => r.some((c) => /betrag/i.test(c)) && r.some((c) => /datum|buchungstag/i.test(c)));
    if (hi < 0) throw new Error("In der CSV-Datei wurde keine Kopfzeile mit „Betrag“ und „Datum“ gefunden.");
    const h = rows[hi].map((c) => c.toLowerCase());
    const col = (re) => h.findIndex((c) => re.test(c));
    const cDate = col(/buchungsdatum|buchungstag|^datum/);
    const cPayer = col(/zahlungspflichtig|auftraggeber|^name|zahler/);
    const cRecv = col(/zahlungsempf|begünstigt/);
    const cZweck = col(/verwendungszweck/);
    const cIban = col(/^iban|kontonummer/);
    const cAmt = col(/betrag/);
    const cTyp = col(/umsatztyp|buchungstext/);
    const tx = [];
    for (const r of rows.slice(hi + 1)) {
      if (r.length < 3) continue;
      const datum = parseDate(r[cDate]);
      const betrag = parseAmount(r[cAmt]);
      if (!datum || isNaN(betrag)) continue;
      const name = (cPayer >= 0 ? r[cPayer] : "") || "";
      tx.push({
        datum, betrag,
        name: betrag >= 0 ? name : (cRecv >= 0 ? r[cRecv] : name),
        zweck: cZweck >= 0 ? r[cZweck] : "",
        iban: cIban >= 0 ? (r[cIban] || "").replace(/\s/g, "").toUpperCase() : "",
        typ: cTyp >= 0 ? r[cTyp] : "",
        text: r.join(" "),
        quelle: "CSV",
      });
    }
    return tx;
  }

  let pdfjsLoading = null;
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    if (!pdfjsLoading) {
      pdfjsLoading = new Promise((res, rej) => {
        const s = document.createElement("script");
        s.src = "vendor/pdf.min.js";
        s.onload = () => { window.pdfjsLib.GlobalWorkerOptions.workerSrc = "vendor/pdf.worker.min.js"; res(window.pdfjsLib); };
        s.onerror = () => rej(new Error("PDF-Leser konnte nicht geladen werden"));
        document.head.appendChild(s);
      });
    }
    return pdfjsLoading;
  }

  const AMT = /[-+]?\d{1,3}(?:\.\d{3})*,\d{2}(?:\s?[-+SH](?![A-Za-zÄÖÜäöüß]))?/g;

  // PDF in Zeilen zerlegen: Textstücke mit ähnlicher Höhe (±3 pt) bilden eine Zeile
  async function pdfLines(buf) {
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const items = content.items.filter((it) => it.str && it.str.trim())
        .map((it) => ({ x: it.transform[4], y: it.transform[5], s: it.str.trim(), w: it.width }))
        .sort((a, b) => b.y - a.y || a.x - b.x);
      const clusters = [];
      for (const it of items) {
        const c = clusters.find((c) => Math.abs(c.y - it.y) <= 3);
        if (c) c.items.push(it); else clusters.push({ y: it.y, items: [it] });
      }
      clusters.sort((a, b) => b.y - a.y).forEach((c) => {
        c.items.sort((a, b) => a.x - b.x);
        lines.push({ page: p, y: c.y, items: c.items, text: c.items.map((i) => i.s).join(" ").replace(/\s+/g, " ").trim() });
      });
    }
    return lines;
  }

  const AMT_FULL = /^[-+]?\d{1,3}(?:\.\d{3})*,\d{2}$/;
  const STOP = /^(kontostand|ihr dispositionskredit|gesamtumsatzsummen|deutsche kreditbank|hinweise zum kontoauszug|kontoauszug \d|girokonto|datum\s+erläuterung|\.\s*-?\d)/i;

  // Kontoauszug mit Spalten "Soll" / "Haben" (DKB und viele andere Banken)
  function fromPdfColumns(lines) {
    const all = lines.map((l) => l.text).join("\n");
    const fallbackYear = Number((all.match(/\b(20\d{2})\b/) || [])[1]) || new Date().getFullYear();
    const cols = {};
    lines.forEach((l) => {
      const soll = l.items.find((i) => /soll/i.test(i.s));
      const haben = l.items.find((i) => /haben/i.test(i.s));
      if (soll && haben && /betrag|datum/i.test(l.text)) cols[l.page] = { soll: soll.x + soll.w, haben: haben.x + haben.w };
    });
    if (!Object.keys(cols).length) return null;
    const tx = [];
    let cur = null;
    const finish = () => { if (cur) { tx.push(cur); cur = null; } };
    for (const l of lines) {
      const c = cols[l.page];
      const first = l.items[0];
      const isDate = first && /^\d{1,2}\.\d{1,2}\.(\d{2,4})?$/.test(first.s) && first.x < 120;
      if (isDate && c) {
        finish();
        const amt = l.items.slice().reverse().find((i) => AMT_FULL.test(i.s) && i.x > first.x + 100);
        if (!amt) continue;
        const right = amt.x + amt.w;
        let betrag = parseAmount(amt.s);
        const zumHaben = Math.abs(right - c.haben) < Math.abs(right - c.soll);
        betrag = zumHaben && !/^-/.test(amt.s) ? Math.abs(betrag) : -Math.abs(betrag);
        const typ = l.items.filter((i) => i !== first && i !== amt).map((i) => i.s).join(" ");
        cur = { datum: parseDate(first.s, fallbackYear), betrag, typ, zeilen: [], quelle: "PDF" };
      } else if (cur) {
        if (STOP.test(l.text) || (c && l.items[0].x < 60 && !/^\d{1,2}\.\d{1,2}\./.test(l.text))) { finish(); continue; }
        cur.zeilen.push(l.text);
      }
    }
    finish();
    return tx.filter((t) => t.datum && !isNaN(t.betrag)).map((t) => {
      const zweck = t.zeilen.join(" ").replace(/\s+/g, " ").trim();
      const iban = (zweck.match(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/) || [""])[0].replace(/\s/g, "");
      // Name = Anfang der ersten Zeile bis zum ersten typischen Zweck-Wort
      const erste = t.zeilen[0] || "";
      const name = (erste.split(/\s(?=garage|garagen|garge|miete|mvn|rechnung|datum|\d)/i)[0] || erste).trim();
      return { datum: t.datum, betrag: t.betrag, name, zweck, iban, typ: t.typ, text: `${t.typ} ${zweck}`, quelle: "PDF" };
    });
  }

  // Fallback für Auszüge ohne erkennbare Soll/Haben-Spalten
  function fromPdfLines(lines) {
    const cols = fromPdfColumns(lines);
    if (cols && cols.length) return cols;
    const all = lines.map((l) => l.text).join("\n");
    const fallbackYear = Number((all.match(/\b(20\d{2})\b/) || [])[1]) || new Date().getFullYear();
    const blocks = [];
    let cur = null;
    for (const l of lines) {
      if (/^\d{1,2}\.\d{1,2}\.(\d{2,4})?\b/.test(l.text)) { if (cur) blocks.push(cur); cur = { lines: [l] }; }
      else if (cur) {
        if (STOP.test(l.text) || cur.lines.length > 8) { blocks.push(cur); cur = null; }
        else cur.lines.push(l);
      }
    }
    if (cur) blocks.push(cur);
    const tx = [];
    for (const b of blocks) {
      const text = b.lines.map((l) => l.text).join(" ");
      const amounts = [];
      b.lines.forEach((l) => l.items.forEach((it) => { if (AMT_FULL.test(it.s)) amounts.push(it); }));
      if (!amounts.length) continue;
      const betrag = parseAmount(amounts[amounts.length - 1].s);
      const datum = parseDate(text, fallbackYear);
      if (!datum || isNaN(betrag)) continue;
      const rest = text.replace(/\d{1,2}\.\d{1,2}\.(\d{2,4})?/g, "").replace(/[-+]?\d{1,3}(?:\.\d{3})*,\d{2}/g, "").replace(/\s+/g, " ").trim();
      tx.push({ datum, betrag, name: rest.slice(0, 60), zweck: rest, iban: "", typ: "", text, quelle: "PDF" });
    }
    return tx;
  }

  async function readFile(file) {
    const buf = await file.arrayBuffer();
    const isPdf = /\.pdf$/i.test(file.name) || new Uint8Array(buf.slice(0, 4)).every((b, i) => b === [0x25, 0x50, 0x44, 0x46][i]);
    if (isPdf) return fromPdfLines(await pdfLines(buf));
    return fromCsv(decode(buf));
  }

  function norm(s) {
    return String(s || "").toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .replace(/[^a-z0-9]+/g, " ").trim();
  }
  const txKey = (t) => `${t.datum}|${t.betrag.toFixed(2)}|${norm(t.name + " " + t.zweck).slice(0, 50)}`;

  return { readFile, fromCsv, fromPdfLines, parseAmount, parseDate, norm, txKey };
})();
