// Speichert die gesamte Garagen-Datenbank als ein JSON-Dokument in Netlify Blobs.
// GET  /api/db  -> { version, data }
// PUT  /api/db  -> body { version, data }  (409, wenn jemand anderes zwischenzeitlich gespeichert hat)
import { getStore } from "@netlify/blobs";

export default async (req) => {
  const store = getStore({ name: "garagenverwaltung", consistency: "strong" });

  if (req.method === "GET") {
    const doc = await store.get("db", { type: "json" });
    return Response.json(doc || { version: 0, data: null });
  }

  if (req.method === "PUT") {
    const body = await req.json();
    const current = (await store.get("db", { type: "json" })) || { version: 0, data: null };
    if (typeof body.version !== "number" || body.version !== current.version) {
      return Response.json({ error: "conflict", current }, { status: 409 });
    }
    // Tagesbackup des alten Stands (eines pro Tag, wird am selben Tag überschrieben)
    if (current.data) {
      const day = new Date().toISOString().slice(0, 10);
      await store.setJSON(`backup/${day}`, current);
    }
    const next = { version: current.version + 1, savedAt: new Date().toISOString(), data: body.data };
    await store.setJSON("db", next);
    return Response.json({ version: next.version, savedAt: next.savedAt });
  }

  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/db" };
