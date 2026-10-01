// Dateiablage pro Garage (Fotos, PDFs) in Netlify Blobs.
// PUT    /api/files/<garageId>/<dateiId>   Body = Datei, Content-Type = Dateityp
// GET    /api/files/<garageId>/<dateiId>
// DELETE /api/files/<garageId>/<dateiId>
import { getStore } from "@netlify/blobs";

const MAX = 5.5 * 1024 * 1024;
const KEY = /^[A-Za-z0-9_-]{1,64}\/[A-Za-z0-9_-]{1,64}$/;

export default async (req) => {
  const store = getStore({ name: "garagen-dateien", consistency: "strong" });
  const key = decodeURIComponent(new URL(req.url).pathname.replace(/^\/api\/files\//, ""));
  if (!KEY.test(key)) return new Response("Ungültiger Schlüssel", { status: 400 });

  if (req.method === "PUT") {
    const buf = await req.arrayBuffer();
    if (buf.byteLength > MAX) return new Response("Datei zu groß (max. 5 MB)", { status: 413 });
    await store.set(key, buf, { metadata: { type: req.headers.get("content-type") || "application/octet-stream" } });
    return Response.json({ ok: true, size: buf.byteLength });
  }
  if (req.method === "GET") {
    const r = await store.getWithMetadata(key, { type: "arrayBuffer" });
    if (!r) return new Response("Nicht gefunden", { status: 404 });
    return new Response(r.data, {
      headers: { "Content-Type": r.metadata?.type || "application/octet-stream", "Cache-Control": "private, max-age=31536000, immutable" },
    });
  }
  if (req.method === "DELETE") {
    await store.delete(key);
    return Response.json({ ok: true });
  }
  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/files/*" };
