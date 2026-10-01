# Garagenverwaltung

Web-App für die Verwaltung der Mietgaragen: Standorte, Garagen, Mieter, Mietverträge als PDF mit Unterschrift auf dem Tablet, Mieteingänge, Zahlungserinnerungen, Kündigungen und eine Warteliste.

## Auf Netlify bringen (wie bei FlowWork)

1. Neues GitHub-Repo anlegen, z. B. `garagenverwaltung`, und den Inhalt dieses Ordners hochladen.
2. In Netlify: **Add new site → Import an existing project → GitHub →** Repo wählen.
   Netlify liest die Einstellungen aus `netlify.toml` selbst, es ist nichts weiter einzutragen.
3. **Site configuration → Access & security → Visitor access → Password protection** aktivieren (Netlify Pro).
   Die Mieterdaten sind dann nur mit Passwort erreichbar.
4. Fertig. Die Daten liegen in Netlify Blobs (Store `garagenverwaltung`), zusätzlich legt die App jeden Tag automatisch ein Backup an.

## Aufbau

- `public/` – die App (HTML, CSS, JS). `vendor/jspdf` ist mitgeliefert, es wird also kein CDN gebraucht.
- `public/docs.js` – Texte und Layout von Mietvertrag, Garagenordnung, Kündigungen und Zahlungserinnerung.
- `netlify/functions/db.mjs` – Speicher-API (`/api/db`) mit Konfliktschutz, falls zwei Personen gleichzeitig speichern.

Wird `index.html` ohne Netlify geöffnet (z. B. lokal), läuft die App im „lokalen Modus“ und speichert nur im Browser.

## Altverträge übernehmen

Beim Erfassen bestehender Verträge „Auf Papier unterschrieben“ anhaken und bei „Mieteingänge erfassen ab“ den aktuellen Monat wählen. Sonst gelten alle Monate seit Vertragsbeginn als offen.

## Hinweis

Die Vertrags- und Kündigungstexte orientieren sich am bisherigen Formular, sind aber keine Rechtsberatung. Vor dem ersten Einsatz einmal prüfen lassen, z. B. über Haus & Grund.

## Neu in Version 3

- **Garagen-Akte:** Fotos und Dateien pro Garage (Netlify Function `files.mjs`, Store `garagen-dateien`, max. 5 MB pro Datei, Fotos werden automatisch verkleinert). Erzeugte Verträge, Kündigungen und Mahnungen werden automatisch abgelegt.
- **Geodaten:** Standort per Handy-GPS aufnehmen oder Koordinaten bzw. Google-Maps-Link einfügen, dann Navigation per Klick.
- **Weitere Eigentümer** (Einstellungen): Für deren Garagen stehen sie im Vertrag als Vermieter.
- **Nebenkostenpauschale** im Vertrag, **Kosten pro Garage** (Pacht, Grundsteuer, Beitrag, Hausgeld, Sonstiges) und **Kaufpreis**, daraus die Ansicht „Rendite“.
- **Daten ergänzen:** Eine Import-Datei fügt Einträge hinzu, ohne Vorhandenes zu überschreiben.
