import { getStore, getDeployStore } from "@netlify/blobs";

// Reads a photo of a UK parking sign and returns the rules on it as JSON.
// Needs an ANTHROPIC_API_KEY environment variable on the Netlify project.
// Without one it answers 501 and the app reads the words on the phone instead.

const DAILY_LIMIT_PER_VISITOR = 25;

const PROMPT = `You are reading a photo of a UK parking sign or road-marking plate for a driver.
Reply with JSON only, no prose, in exactly this shape:
{"text":"the words on the sign, in reading order","rules":[{"kind":"dy|sy|dr|sr|pay|limited|permit|disabled|loading|zigzag|free","anyTime":true|false,"days":["Mo","Tu","We","Th","Fr","Sa","Su"],"from":"HH:MM","to":"HH:MM","maxStayMin":0,"noReturnMin":0,"zone":"","notes":["short plain-English warnings the driver should know, such as exceptions, bank holidays, event days, goods vehicles only"]}]}
kind: dy = no waiting at any time, sy = no waiting during hours, dr = no stopping at any time (red route), sr = no stopping during hours, pay = pay and display or pay by phone, limited = free with a time limit, permit = permit holders only, disabled = Blue Badge only, loading = loading only, free = no restriction.
Use 24-hour times. One entry in "rules" per separate panel or rule on the sign. If a rule has two time bands, give two entries.
If the photo is not a parking sign or cannot be read, reply {"text":"","rules":[]}. Never guess hours that are not visible.`;

function counters() {
  const production = Netlify.context?.deploy?.context === "production";
  return production ? getStore("kerbside-usage") : getDeployStore("kerbside-usage");
}

export default async (req: Request, context: any) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const key = Netlify.env.get("ANTHROPIC_API_KEY");
  if (!key) return Response.json({ error: "not_configured" }, { status: 501 });

  let image = "";
  try {
    const text = await req.text();
    if (text.length > 3_000_000) return new Response("Photo too large", { status: 413 });
    image = String(JSON.parse(text).image || "");
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const m = image.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return new Response("Bad request", { status: 400 });

  // a small daily cap per visitor so the key cannot be run up by one person
  const who = (context?.ip || "unknown").replace(/[^0-9a-f.:]/gi, "");
  const usageKey = `${new Date().toISOString().slice(0, 10)}/${who}`;
  const usage = counters();
  const used = Number((await usage.get(usageKey)) || 0);
  if (used >= DAILY_LIMIT_PER_VISITOR) return Response.json({ error: "limit" }, { status: 429 });
  await usage.set(usageKey, String(used + 1));

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 700,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: `image/${m[1]}`, data: m[2] } },
        { type: "text", text: PROMPT },
      ] }],
    }),
  });
  if (!res.ok) return Response.json({ error: "reader_failed" }, { status: 502 });
  const data = await res.json();
  const out = (data?.content || []).map((c: any) => (c.type === "text" ? c.text : "")).join("");
  const json = out.match(/\{[\s\S]*\}/);
  try {
    const parsed = JSON.parse(json ? json[0] : "");
    return Response.json({ text: String(parsed.text || "").slice(0, 600), rules: Array.isArray(parsed.rules) ? parsed.rules.slice(0, 4) : [] });
  } catch {
    return Response.json({ text: "", rules: [] });
  }
};

export const config = { path: "/api/kerbside/sign" };
