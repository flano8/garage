/* PDF-Erzeugung: Mietvertrag, Garagenordnung, Kündigungen, Zahlungserinnerung */
window.Docs = (() => {
  const { jsPDF } = window.jspdf;
  const ML = 22, MR = 20, MT = 20, MB = 22, PW = 210, PH = 297, CW = PW - ML - MR;

  const eur = (n) => Number(n || 0).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const d = (iso) => {
    if (!iso) return "";
    const [y, m, dd] = iso.split("-");
    return `${dd}.${m}.${y}`;
  };

  function writer(footerText) {
    const doc = new jsPDF({ unit: "mm", format: "a4" });
    let y = MT;
    const api = {
      doc,
      get y() { return y; },
      set y(v) { y = v; },
      ensure(h) { if (y + h > PH - MB) { doc.addPage(); y = MT; } },
      space(h = 3) { y += h; },
      text(str, { size = 10.5, bold = false, indent = 0, gap = 1.6, align = "left", color = [30, 36, 48] } = {}) {
        doc.setFont("helvetica", bold ? "bold" : "normal");
        doc.setFontSize(size);
        doc.setTextColor(...color);
        const lh = size * 0.42;
        const lines = doc.splitTextToSize(String(str), CW - indent);
        for (const line of lines) {
          api.ensure(lh);
          const x = align === "right" ? PW - MR : ML + indent;
          doc.text(line, x, y + lh * 0.8, { align });
          y += lh;
        }
        y += gap;
      },
      heading(str) {
        api.ensure(16);
        y += 3;
        api.text(str, { size: 12, bold: true, gap: 2 });
      },
      // nummerierter Absatz "(1) ..."
      clause(num, str) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10.5);
        const lh = 10.5 * 0.42;
        const indent = num ? 8 : 0;
        const lines = doc.splitTextToSize(String(str), CW - indent);
        lines.forEach((line, i) => {
          api.ensure(lh);
          doc.setTextColor(30, 36, 48);
          if (i === 0 && num) doc.text(`(${num})`, ML, y + lh * 0.8);
          doc.text(line, ML + indent, y + lh * 0.8);
          y += lh;
        });
        y += 2;
      },
      rule() { doc.setDrawColor(200); doc.line(ML, y, PW - MR, y); y += 3; },
      signature({ label, place, date, image, xOffset = 0, width = CW / 2 - 6 }) {
        const x = ML + xOffset;
        const top = y;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(10.5);
        doc.setTextColor(30, 36, 48);
        if (place || date) doc.text([place, date].filter(Boolean).join(", "), x, top + 5);
        doc.setDrawColor(120);
        doc.line(x, top + 7, x + width, top + 7);
        doc.setFontSize(8.5);
        doc.setTextColor(110);
        doc.text("Ort, Datum", x, top + 11);
        if (image) {
          try { doc.addImage(image, "PNG", x, top + 14, 60, 20); } catch (e) { /* ignorieren */ }
        }
        doc.line(x, top + 35, x + width, top + 35);
        doc.text(label, x, top + 39);
      },
      finish() {
        const n = doc.getNumberOfPages();
        for (let i = 1; i <= n; i++) {
          doc.setPage(i);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(8.5);
          doc.setTextColor(120);
          if (footerText) doc.text(footerText, ML, PH - 10);
          doc.text(`Seite ${i} von ${n}`, PW - MR, PH - 10, { align: "right" });
        }
        return doc;
      },
    };
    return api;
  }

  function partyBlock(w, lines, role) {
    lines.filter(Boolean).forEach((l, i) => w.text(l, { indent: 8, gap: i === lines.length - 1 ? 0.5 : 0, bold: i === 0 }));
    w.text(`– nachfolgend „${role}“ genannt –`, { indent: 8, size: 9, color: [110, 110, 110], gap: 4 });
  }

  /* ---------------- Mietvertrag ---------------- */
  function mietvertrag({ v, garage, standort, mieter, s }) {
    const objekt = garage.typ === "Stellplatz" ? "Stellplatz" : "Garage";
    const w = writer(`Mietvertrag ${v.nr} · ${objekt} Nr. ${garage.nummer} · ${standort.name}`);
    w.text(`Mietvertrag über ${objekt === "Garage" ? "eine Garage" : "einen Stellplatz"}`, { size: 18, bold: true, gap: 1 });
    w.text(`Vertragsnummer ${v.nr}`, { size: 9.5, color: [110, 110, 110], gap: 6 });

    w.text("Zwischen", { gap: 2 });
    partyBlock(w, [s.name, s.strasse, s.plzOrt, s.telefon ? `Tel. ${s.telefon}` : "", s.email], "Vermieter");
    w.text("und", { gap: 2 });
    partyBlock(w, [
      `${mieter.anrede ? mieter.anrede + " " : ""}${mieter.vorname} ${mieter.nachname}`.trim(),
      mieter.strasse, mieter.plzOrt,
      mieter.telefon ? `Tel. ${mieter.telefon}` : "", mieter.email,
    ], "Mieter");
    w.text("wird folgender Mietvertrag geschlossen:", { gap: 2 });

    let p = 0;
    const H = (t) => w.heading(`§ ${++p} ${t}`);

    H("Mietobjekt");
    w.clause(1, `Der Vermieter vermietet dem Mieter zum Abstellen eines Kraftfahrzeugs bis zu einem zulässigen Gesamtgewicht von ${v.gesamtgewicht || garage.gesamtgewicht || "2"} Tonnen ${objekt === "Garage" ? "die Garage" : "den Stellplatz"} Nr. ${garage.nummer} auf dem Grundstück ${standort.adresse}${standort.name && standort.name !== standort.adresse ? ` (Standort „${standort.name}“)` : ""}.`);
    if (garage.groesse) w.clause(2, `Die Fläche beträgt ca. ${garage.groesse} m².`);
    if (mieter.kennzeichen) w.clause(garage.groesse ? 3 : 2, `Abgestellt wird das Fahrzeug mit dem amtlichen Kennzeichen ${mieter.kennzeichen}. Ein Fahrzeugwechsel ist dem Vermieter mitzuteilen.`);

    H("Mietdauer und Kündigung");
    w.clause(1, `Das Mietverhältnis beginnt am ${d(v.beginn)}. Es läuft auf unbestimmte Zeit und kann von jeder Vertragspartei mit einer Frist von drei Monaten zum Ende eines Kalendermonats gekündigt werden. Die Kündigung muss spätestens am dritten Werktag des ersten Monats der Kündigungsfrist bei der anderen Vertragspartei eingegangen sein.${v.erstmalsZum ? ` Die Kündigung ist beiderseits erstmals zum ${d(v.erstmalsZum)} zulässig.` : ""}`);
    w.clause(2, "Setzt der Mieter den Gebrauch der Mietsache nach Ablauf der Mietzeit fort, gilt das Mietverhältnis nicht als verlängert. § 545 BGB findet keine Anwendung. Eine Verlängerung bedarf einer schriftlichen Vereinbarung.");
    w.clause(3, "Die Kündigung bedarf der Schriftform. Das Recht zur außerordentlichen fristlosen Kündigung aus wichtigem Grund bleibt unberührt.");

    H("Miete");
    w.clause(1, `Die monatliche Miete beträgt ${eur(v.miete)} Euro (in Worten: ${zahlwort(v.miete)}).`);
    w.clause(2, "Der Vermieter ist Kleinunternehmer im Sinne des § 19 UStG. Umsatzsteuer wird daher nicht berechnet.");

    H("Zahlungsweise");
    const konto = s.iban
      ? `auf folgendem Konto des Vermieters eingeht:\nKontoinhaber: ${s.kontoinhaber || s.name}\nBank: ${s.bank || ""}\nIBAN: ${s.iban}${s.bic ? `   BIC: ${s.bic}` : ""}\nVerwendungszweck: Garage ${garage.nummer} ${standort.name} / ${mieter.nachname}`
      : "auf einem vom Vermieter benannten Konto eingeht.";
    w.clause(0, `Die Miete ist monatlich im Voraus, porto- und spesenfrei, so rechtzeitig zu überweisen, dass der Betrag spätestens am dritten Werktag eines jeden Monats ${konto}`);
    w.clause(0, "Verzögerungen, die auf einem Verschulden der beteiligten Banken beruhen, hat der Mieter nicht zu vertreten.");

    H("Schlüssel und Transponder");
    w.clause(1, `Der Mieter erhält ${v.schluessel || 0} Schlüssel und ${v.transponder || 0} Transponder für die Zufahrt zum Mietobjekt. Er darf ohne Zustimmung des Vermieters keine weiteren Schlüssel oder Transponder anfertigen lassen.`);

    H("Mietsicherheit");
    if (Number(v.kaution) > 0) {
      w.clause(1, `Der Mieter verpflichtet sich, zur Sicherung aller Ansprüche aus diesem Vertrag eine Mietsicherheit in Höhe von ${eur(v.kaution)} Euro durch Zahlung an den Vermieter zu leisten.`);
      w.clause(2, "Die Rückzahlung der Mietsicherheit wird frühestens sechs Monate nach vollständiger Rückgabe des Mietobjekts fällig, sofern dem Vermieter keine Gegenansprüche mehr zustehen.");
    } else {
      w.clause(0, "Eine Mietsicherheit wird nicht vereinbart.");
    }

    H("Aufrechnung und Zurückbehaltungsrecht");
    w.clause(1, "Der Mieter kann gegen eine Mietforderung mit einer Forderung aus §§ 536a, 539 BGB oder aus ungerechtfertigter Bereicherung wegen zu viel gezahlter Miete nur aufrechnen, wenn er dem Vermieter seine Absicht mindestens einen Monat vor Fälligkeit der Miete in Textform angezeigt hat.");
    w.clause(2, "Mit anderen Forderungen aus dem Mietverhältnis kann der Mieter nur aufrechnen, wenn diese unbestritten, rechtskräftig festgestellt oder entscheidungsreif sind. Das Leistungsverweigerungsrecht des Mieters aus § 320 BGB bleibt unberührt.");

    H("Zustand des Mietobjekts, Haftung des Vermieters");
    w.clause(1, "Die verschuldensunabhängige Haftung des Vermieters für anfängliche Sachmängel wird ausgeschlossen.");
    w.clause(2, "Wegen anderer Mängel kann der Mieter vom Vermieter Schadensersatz nur verlangen, soweit dem Vermieter oder seinen Erfüllungsgehilfen Vorsatz oder grobe Fahrlässigkeit zur Last fällt oder sich der Vermieter mit der Mängelbeseitigung in Verzug befindet.");
    w.clause(3, "Die Haftung für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit, die auf einer vorsätzlichen oder fahrlässigen Pflichtverletzung des Vermieters oder seiner Erfüllungsgehilfen beruhen, sowie das Recht des Mieters zur Mietminderung oder zur fristlosen Kündigung bleiben von den Absätzen 1 und 2 unberührt.");
    w.clause(4, `Dem Mieter ist bekannt, dass das Mietobjekt folgende Mängel aufweist: ${v.maengel?.trim() || "keine bekannten Mängel"}.`);

    H("Benutzung des Mietobjekts und Überlassung an Dritte");
    w.clause(1, "Der Mieter darf das Mietobjekt nur zum Abstellen eines Kraftfahrzeugs sowie von Fahrrädern verwenden.");
    w.clause(2, "Der Mieter darf das zur Wartung und Pflege des Fahrzeugs notwendige Zubehör (z. B. Reifen, Putzmittel, Werkzeug) im Mietobjekt aufbewahren. Die Vorschriften über das Lagern brennbarer Stoffe in Garagen sind zu beachten.");
    w.clause(3, "Der Mieter ist nicht berechtigt, das Mietobjekt ohne vorherige Erlaubnis des Vermieters unterzuvermieten oder sonst einem Dritten zu überlassen. Das vorübergehende Abstellen von Fahrzeugen eines Besuchers oder Mitbewohners des Mieters ist zulässig.");

    H("Beendigung des Mietverhältnisses");
    w.clause(1, "Bei Beendigung des Mietverhältnisses ist das Mietobjekt vollständig geräumt und sauber zurückzugeben.");
    w.clause(2, "Der Mieter hat alle ihm übergebenen sowie selbst beschafften Schlüssel und Transponder zurückzugeben. Er haftet für sämtliche Schäden, die dem Vermieter oder einem Nachmieter aus der Verletzung dieser Pflichten entstehen.");

    H("Winterdienst");
    if (v.winterdienstVermieter) {
      w.clause(1, "Auf den Zufahrten und Zugängen zum Mietobjekt führt der Vermieter den Winterdienst (Beseitigung von Eis und Schnee sowie von Glätte) durch.");
      w.clause(2, "Die Beseitigung von Eis und Schnee unmittelbar vor dem Mietobjekt obliegt dem Mieter.");
    } else {
      w.clause(0, "Die Beseitigung von Eis und Schnee sowie von Glätte unmittelbar vor dem Mietobjekt obliegt dem Mieter.");
    }

    const anlagen = [];
    if (v.mitGaragenordnung !== false) anlagen.push("Garagenordnung");
    if (v.anlageExtra?.trim()) anlagen.push(v.anlageExtra.trim());

    if (v.mitGaragenordnung !== false) {
      H("Garagenordnung");
      w.clause(0, "Die als Anlage 1 beigefügte Garagenordnung ist Bestandteil des Mietvertrags.");
    }

    H("Besondere Vereinbarungen");
    w.clause(0, v.besonderes?.trim() || "Keine.");

    H("Sonstiges");
    w.clause(1, "Mündliche Nebenabreden sind nicht getroffen. Änderungen und Ergänzungen dieses Mietvertrags bedürfen der Schriftform. Dies gilt auch für eine Vereinbarung, mit der auf die Schriftform verzichtet werden soll.");
    w.clause(2, "Mehrere Personen als Mieter haften für alle Verpflichtungen aus dem Mietvertrag als Gesamtschuldner. Mehrere Mieter bevollmächtigen sich gegenseitig, rechtsverbindliche Erklärungen des Vermieters mit Wirkung für alle Mieter in Empfang zu nehmen. Dies gilt nicht für Erklärungen im Zusammenhang mit der Beendigung des Mietverhältnisses.");
    w.clause(3, "Der Vermieter verarbeitet die personenbezogenen Daten des Mieters ausschließlich zur Durchführung dieses Mietverhältnisses (Art. 6 Abs. 1 lit. b DSGVO) und löscht sie nach Ablauf der gesetzlichen Aufbewahrungsfristen.");
    w.clause(4, "Die Unwirksamkeit einer Bestimmung dieses Vertrags berührt die Wirksamkeit des Vertrags im Übrigen nicht.");

    if (anlagen.length) {
      H("Anlagen");
      w.clause(0, "Folgende Anlagen sind Bestandteil dieses Mietvertrags:\n" + anlagen.map((a, i) => `Anlage ${i + 1}: ${a}`).join("\n"));
    }

    // Unterschriften
    w.ensure(95);
    w.space(10);
    const yy = w.y;
    w.signature({ label: "Unterschrift Vermieter", place: v.ort, date: d(v.datum), image: v.sigVermieter, xOffset: 0 });
    w.y = yy;
    w.signature({ label: "Unterschrift Mieter", place: v.ort, date: d(v.datum), image: v.sigMieter, xOffset: CW / 2 + 6 });
    w.y = yy + 44;

    if (v.mitGaragenordnung !== false) {
      w.doc.addPage();
      w.y = MT;
      w.text("Anlage 1 – Garagenordnung", { size: 15, bold: true, gap: 5 });
      [
        "Das Garagentor ist stets geschlossen und abgeschlossen zu halten, auch bei kurzer Abwesenheit.",
        "Motoren dürfen in der Garage nicht unnötig laufen gelassen werden. Auf dem Gelände ist Schrittgeschwindigkeit zu fahren.",
        "Fahrzeugwäsche, Ölwechsel und Reparaturen mit Austritt von Betriebsstoffen sind in der Garage und auf dem Gelände nicht gestattet.",
        "Brennbare Flüssigkeiten und Gase dürfen außerhalb des Fahrzeugtanks nur in den gesetzlich zulässigen Mengen und Behältnissen aufbewahrt werden.",
        "Zufahrten, Wendeflächen und Rettungswege sind jederzeit freizuhalten. Fahrzeuge dürfen dort nicht abgestellt werden.",
        "Abfälle, Altreifen, Altöl und Sperrmüll dürfen weder in der Garage noch auf dem Gelände abgestellt werden.",
        "Schäden am Mietobjekt, am Tor oder am Schloss sind dem Vermieter unverzüglich zu melden.",
        "Das Anbringen von Schildern, Leitungen oder baulichen Veränderungen sowie der Austausch von Schlössern bedürfen der vorherigen Zustimmung des Vermieters.",
      ].forEach((t, i) => w.clause(i + 1, t));
    }

    return w.finish();
  }

  /* ---------------- Briefe ---------------- */
  function letter({ s, mieter, betreff, absaetze, datum, ort, sigImage }) {
    const w = writer("");
    const doc = w.doc;
    // Absenderzeile
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9.5);
    doc.setTextColor(60);
    [s.name, s.strasse, s.plzOrt, s.telefon ? `Tel. ${s.telefon}` : "", s.email].filter(Boolean)
      .forEach((l, i) => doc.text(l, PW - MR, MT + i * 4.4, { align: "right" }));
    // Empfänger (Fensterbereich DIN 5008)
    doc.setFontSize(7.5);
    doc.setTextColor(120);
    doc.text(`${s.name} · ${s.strasse} · ${s.plzOrt}`, ML, 50);
    doc.setFontSize(11);
    doc.setTextColor(30, 36, 48);
    [`${mieter.anrede ? mieter.anrede + " " : ""}${mieter.vorname} ${mieter.nachname}`.trim(), mieter.strasse, mieter.plzOrt]
      .filter(Boolean).forEach((l, i) => doc.text(l, ML, 56 + i * 5));
    w.y = 92;
    w.text(`${ort || ""}${ort ? ", " : ""}${d(datum)}`, { align: "right", gap: 8 });
    w.text(betreff, { bold: true, size: 11.5, gap: 6 });
    const anrede = mieter.anrede === "Frau" ? `Sehr geehrte Frau ${mieter.nachname},`
      : mieter.anrede === "Herr" ? `Sehr geehrter Herr ${mieter.nachname},`
      : "Sehr geehrte Damen und Herren,";
    w.text(anrede, { gap: 4 });
    absaetze.filter(Boolean).forEach((a) => w.text(a, { gap: 4 }));
    w.text("Mit freundlichen Grüßen", { gap: 2 });
    w.ensure(30);
    if (sigImage) {
      try { doc.addImage(sigImage, "PNG", ML, w.y, 55, 18); } catch (e) { /* */ }
    }
    w.y += 20;
    w.text(s.name, { gap: 0 });
    return w.finish();
  }

  function objektText(garage, standort) {
    return `${garage.typ === "Stellplatz" ? "Stellplatz" : "Garage"} Nr. ${garage.nummer}, ${standort.adresse}`;
  }

  function kuendigungOrdentlich({ v, garage, standort, mieter, s, k }) {
    return letter({
      s, mieter, datum: k.datum, ort: k.ort, sigImage: k.mitUnterschrift ? s.sigVermieter : null,
      betreff: `Kündigung des Mietvertrags vom ${d(v.beginn)} – ${objektText(garage, standort)}`,
      absaetze: [
        `hiermit kündige ich den mit Ihnen geschlossenen Mietvertrag über die ${objektText(garage, standort)} fristgerecht zum ${d(k.zum)}.`,
        `Bitte geben Sie das Mietobjekt zu diesem Termin vollständig geräumt und sauber zurück und händigen Sie mir sämtliche Schlüssel${v.transponder > 0 ? " und Transponder" : ""} aus, auch selbst beschaffte. Für einen Übergabetermin melden Sie sich bitte rechtzeitig bei mir${s.telefon ? ` unter ${s.telefon}` : ""}.`,
        "Einer stillschweigenden Verlängerung des Mietverhältnisses gemäß § 545 BGB widerspreche ich bereits jetzt ausdrücklich.",
        k.zusatz,
      ],
    });
  }

  function kuendigungFristlos({ v, garage, standort, mieter, s, k }) {
    const grund = k.grund === "zahlungsverzug"
      ? `Die Kündigung stütze ich auf § 543 Abs. 1, Abs. 2 Satz 1 Nr. 3 BGB. Sie befinden sich mit der Zahlung der Miete für ${k.monate} in Höhe von insgesamt ${eur(k.betrag)} Euro in Verzug.${k.mahnungVom ? ` Meiner Zahlungsaufforderung vom ${d(k.mahnungVom)} sind Sie nicht nachgekommen.` : ""}`
      : `Die Kündigung stütze ich auf § 543 Abs. 1 BGB. ${k.grundText || ""}${k.mahnungVom ? ` Ich habe Sie mit Schreiben vom ${d(k.mahnungVom)} abgemahnt; Sie haben Ihr vertragswidriges Verhalten dennoch fortgesetzt.` : ""}`;
    return letter({
      s, mieter, datum: k.datum, ort: k.ort, sigImage: k.mitUnterschrift ? s.sigVermieter : null,
      betreff: `Fristlose Kündigung – ${objektText(garage, standort)}`,
      absaetze: [
        `hiermit kündige ich den mit Ihnen geschlossenen Mietvertrag vom ${d(v.beginn)} über die ${objektText(garage, standort)} außerordentlich fristlos, hilfsweise ordentlich zum nächstmöglichen Termin, das ist der ${d(k.hilfsweiseZum)}.`,
        grund,
        `Ich fordere Sie auf, das Mietobjekt bis spätestens ${d(k.raeumungBis)} vollständig geräumt herauszugeben und sämtliche Schlüssel${v.transponder > 0 ? " und Transponder" : ""} zurückzugeben.${k.grund === "zahlungsverzug" ? ` Den rückständigen Betrag von ${eur(k.betrag)} Euro fordere ich weiterhin ein.` : ""}`,
        "Einer stillschweigenden Verlängerung des Mietverhältnisses gemäß § 545 BGB widerspreche ich bereits jetzt ausdrücklich. Das Mietverhältnis verlängert sich auch dann nicht, wenn Sie den Gebrauch des Mietobjekts nach Ablauf der Mietzeit fortsetzen.",
        k.zusatz,
      ],
    });
  }

  function zahlungserinnerung({ v, garage, standort, mieter, s, k }) {
    return letter({
      s, mieter, datum: k.datum, ort: k.ort, sigImage: k.mitUnterschrift ? s.sigVermieter : null,
      betreff: `${k.stufe || "Zahlungserinnerung"} – Miete ${objektText(garage, standort)}`,
      absaetze: [
        `für die von Ihnen gemietete ${objektText(garage, standort)} konnte ich für ${k.monate} keinen Zahlungseingang feststellen. Offen ist derzeit ein Betrag von ${eur(k.betrag)} Euro.`,
        `Bitte überweisen Sie den Betrag bis spätestens ${d(k.frist)}${s.iban ? ` auf mein Konto:\nIBAN ${s.iban}${s.bank ? ` (${s.bank})` : ""}\nVerwendungszweck: Garage ${garage.nummer} ${standort.name} / ${mieter.nachname}` : "."}`,
        "Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.",
        k.zusatz,
      ],
    });
  }

  /* Zahl in Worten (für Mietbeträge bis 9999,99) */
  function zahlwort(n) {
    n = Number(n || 0);
    const e = Math.floor(n), c = Math.round((n - e) * 100);
    const ones = ["null", "ein", "zwei", "drei", "vier", "fünf", "sechs", "sieben", "acht", "neun", "zehn", "elf", "zwölf", "dreizehn", "vierzehn", "fünfzehn", "sechzehn", "siebzehn", "achtzehn", "neunzehn"];
    const tens = ["", "", "zwanzig", "dreißig", "vierzig", "fünfzig", "sechzig", "siebzig", "achtzig", "neunzig"];
    const u100 = (x) => {
      if (x < 20) return ones[x];
      const t = Math.floor(x / 10), o = x % 10;
      return (o ? (o === 1 ? "ein" : ones[o]) + "und" : "") + tens[t];
    };
    const u1000 = (x) => {
      const h = Math.floor(x / 100), r = x % 100;
      return (h ? ones[h] + "hundert" : "") + (r ? u100(r) : "");
    };
    let w;
    if (e === 0) w = "null";
    else if (e < 1000) w = u1000(e);
    else w = (Math.floor(e / 1000) === 1 ? "ein" : u1000(Math.floor(e / 1000))) + "tausend" + (e % 1000 ? u1000(e % 1000) : "");
    if (w.endsWith("ein")) w += "s";
    return c ? `${w} Euro und ${c} Cent` : `${w} Euro`;
  }

  return { mietvertrag, kuendigungOrdentlich, kuendigungFristlos, zahlungserinnerung, eur, d };
})();
