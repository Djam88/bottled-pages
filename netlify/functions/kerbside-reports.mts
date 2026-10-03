import { getStore, getDeployStore } from "@netlify/blobs";

// Anonymous "did you get a ticket here?" reports for the Kerbside parking app.
// One report per device, per ~50 m cell, per day. No free text is stored.

const REASONS = ["warden", "sign", "camera", "quick", "quiet"];

function store() {
  const production = Netlify.context?.deploy?.context === "production";
  return production ? getStore("kerbside-reports") : getDeployStore("kerbside-reports");
}
function inUk(lat: number, lon: number) {
  return Number.isFinite(lat) && Number.isFinite(lon) && lat > 49 && lat < 61.5 && lon > -9 && lon < 2.5;
}
function dayStamp(d: Date) {
  return d.toISOString().slice(0, 10).replace(/-/g, "");
}

export default async (req: Request) => {
  const s = store();
  if (req.method === "GET") {
    const url = new URL(req.url);
    const lat = parseFloat(url.searchParams.get("lat") || "");
    const lon = parseFloat(url.searchParams.get("lon") || "");
    if (!inUk(lat, lon)) return Response.json({ ok: 0, ticket: 0, reasons: {} });
    const cx = Math.round(lat * 2000), cy = Math.round(lon * 2000);
    const oldest = dayStamp(new Date(Date.now() - 365 * 86400000));
    const keys: string[] = [];
    const lists = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) lists.push(s.list({ prefix: `${cx + dx}_${cy + dy}/` }));
    for (const l of await Promise.all(lists)) {
      for (const b of l.blobs) {
        const day = b.key.split("/")[1]?.slice(0, 8) || "";
        if (day >= oldest) keys.push(b.key);
      }
    }
    keys.sort().reverse();
    const rows = await Promise.all(keys.slice(0, 150).map((k) => s.get(k, { type: "json" })));
    const out = { ok: 0, ticket: 0, reasons: {} as Record<string, number> };
    for (const r of rows) {
      if (!r) continue;
      if (r.v === "ticket") out.ticket++; else if (r.v === "ok") out.ok++; else continue;
      if (r.r && REASONS.includes(r.r)) out.reasons[r.r] = (out.reasons[r.r] || 0) + 1;
    }
    return Response.json(out, { headers: { "Cache-Control": "public, max-age=60" } });
  }
  if (req.method === "POST") {
    let body: any;
    try {
      const text = await req.text();
      if (text.length > 600) return new Response("Too large", { status: 413 });
      body = JSON.parse(text);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const lat = Number(body.lat), lon = Number(body.lon);
    const v = body.v === "ticket" ? "ticket" : body.v === "ok" ? "ok" : "";
    const did = typeof body.did === "string" && /^[0-9a-f]{8,32}$/.test(body.did) ? body.did : "";
    if (!inUk(lat, lon) || !v || !did) return new Response("Bad request", { status: 400 });
    const reason = REASONS.includes(body.reason) ? body.reason : "";
    const key = `${Math.round(lat * 2000)}_${Math.round(lon * 2000)}/${dayStamp(new Date())}-${did}`;
    await s.setJSON(key, { v, r: reason, at: Date.now() });
    return Response.json({ saved: true });
  }
  return new Response("Method not allowed", { status: 405 });
};

export const config = { path: "/api/kerbside/reports" };
