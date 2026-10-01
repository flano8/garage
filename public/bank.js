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

  async function pdfLines(buf) {
    const pdfjs = await loadPdfJs();
    const pdf = await pdfjs.getDocument({ data: buf }).promise;
    const lines = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const vp = page.getViewport({ scale: 1 });
      const content = await page.getTextContent();
      const byY = new Map();
      for (const it of content.items) {
        if (!it.str || !it.str.trim()) continue;
        const y = Math.round(it.transform[5] / 2.5) * 2.5;
        if (!byY.has(y)) byY.set(y, []);
        byY.get(y).push({ x: it.transform[4], s: it.str, w: it.width });
      }
      [...byY.entries()].sort((a, b) => b[0] - a[0]).forEach(([, items]) => {
        items.sort((a, b) => a.x - b.x);
        lines.push({ text: items.map((i) => i.s).join(" ").replace(/\s+/g, " ").trim(), items, pageWidth: vp.width });
      });
    }
    return lines;
  }

  function fromPdfLines(lines) {
    const all = lines.map((l) => l.text).join("\n");
    const yearMatch = all.match(/\b(20\d{2})\b/);
    const fallbackYear = yearMatch ? Number(yearMatch[1]) : new Date().getFullYear();
    // Spaltenposition der Beträge ermitteln: Haben (Eingang) ist bei DKB rechts von Soll
    const blocks = [];
    let cur = null;
    for (const l of lines) {
      if (/^\d{1,2}\.\d{1,2}\.(\d{2,4})?\b/.test(l.text)) {
        if (cur) blocks.push(cur);
        cur = { lines: [l] };
      } else if (cur) {
        if (/kontostand|saldo|übertrag|seite \d|blatt \d/i.test(l.text) || cur.lines.length > 8) { blocks.push(cur); cur = null; }
        else cur.lines.push(l);
      }
    }
    if (cur) blocks.push(cur);

    const tx = [];
    for (const b of blocks) {
      const text = b.lines.map((l) => l.text).join(" ");
      if (/kontostand|saldo|übertrag/i.test(text)) continue;
      const amounts = [];
      b.lines.forEach((l) => l.items.forEach((it) => {
        const m = it.s.match(AMT);
        if (m) m.forEach((a) => amounts.push({ a, x: it.x + it.w, pw: l.pageWidth }));
      }));
      if (!amounts.length) continue;
      const last = amounts[amounts.length - 1];
      let betrag = parseAmount(last.a.replace(/\s?[SH]$/, ""));
      if (/S$/.test(last.a)) betrag = -Math.abs(betrag);
      if (isNaN(betrag)) continue;
      const datum = parseDate(text, fallbackYear);
      if (!datum) continue;
      const iban = (text.match(/\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?\b/) || [""])[0].replace(/\s/g, "");
      const rest = text.replace(/\d{1,2}\.\d{1,2}\.(\d{2,4})?/g, "").replace(AMT, "").replace(/\s+/g, " ").trim();
      tx.push({ datum, betrag, name: rest.slice(0, 60), zweck: rest, iban, typ: "", text, quelle: "PDF", xRight: last.x, pageWidth: last.pw });
    }
    // Ohne Vorzeichen: Beträge in der rechten Spalte = Eingang, linke Spalte = Ausgang
    if (tx.length && !tx.some((t) => t.betrag < 0)) {
      const xs = tx.map((t) => t.xRight).sort((a, b) => a - b);
      const spread = xs[xs.length - 1] - xs[0];
      if (spread > 40) {
        const mid = (xs[0] + xs[xs.length - 1]) / 2;
        tx.forEach((t) => { if (t.xRight < mid) t.betrag = -Math.abs(t.betrag); });
      }
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
