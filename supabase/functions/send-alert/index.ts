// send-alert: Supabase Database Webhooks -> FCM push.
//   kw_alerts     INSERT + UPDATE   (spike question, flagged, finish-tagging, warnings)
//   kw_box_events INSERT            (box offline / back online)
// Secrets:  FIREBASE_SERVICE_ACCOUNT (service-account JSON as one string), WEBHOOK_SECRET
//           (same value as the webhook's x-webhook-secret header).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.
import { createClient } from "npm:@supabase/supabase-js@2";

const sa = JSON.parse(Deno.env.get("FIREBASE_SERVICE_ACCOUNT") ?? "{}");
const db = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const b64url = (data: string | ArrayBuffer) => {
  const bytes = typeof data === "string"
    ? new TextEncoder().encode(data)
    : new Uint8Array(data);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function accessToken(): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const unsigned = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" })) + "." +
    b64url(JSON.stringify({
      iss: sa.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now,
      exp: now + 3600,
    }));
  const pem = String(sa.private_key).replace(/-----[^-]+-----/g, "").replace(/\s/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: unsigned + "." + b64url(sig),
    }),
  });
  const json = await res.json();
  if (!json.access_token) throw new Error("FCM auth failed: " + JSON.stringify(json));
  return json.access_token;
}

type Alert = Record<string, unknown>;
type Kind = "question" | "flagged" | "untagged" | "warning";

/** Which message (if any) this webhook event should produce. */
function kindOf(type: string, rec: Alert, old: Alert | undefined): Kind | null {
  if (type === "INSERT") {
    if (rec.alert_type !== "power_spike") return "warning";          // overload / voltage
    if (rec.status === "pending") return "question";                  // fresh spike
    if (rec.status === "anomaly" && rec.auto_flagged) return "flagged"; // late spike (box was offline)
    return null;
  }
  if (type === "UPDATE" && old?.status === "pending" && rec.status === "anomaly" && rec.auto_flagged) {
    return "flagged"; // 60 s without an answer
  }
  if (type === "UPDATE" && old?.status === "tagging" && rec.status === "untagged") {
    return "untagged"; // said "new device" but never finished tagging
  }
  return null; // the user answered: nothing to send
}

function build(kind: Kind, a: Alert, where: string) {
  const w = (v: unknown) => (v == null ? "?" : Math.round(Number(v)));
  if (kind === "question") {
    return {
      title: "Sudden power change",
      body: `${where} jumped to ${w(a.power_w)} W (was ${w(a.prev_power_w)} W). Tap within 1 minute to tell us what happened.`,
      ttl: "60s", // after 60 s the question is pointless; the "flagged" push replaces it
    };
  }
  if (kind === "flagged") {
    const ageMin = Math.round((Date.parse(String(a.created_at)) - Date.parse(String(a.event_at))) / 60000);
    const late = ageMin >= 2 ? ` (detected ${ageMin} min ago while the box was offline)` : "";
    return {
      title: "Flagged as anomaly",
      body: `${where}: no response, so the ${w(a.power_w)} W jump was flagged as an anomaly${late}. Tap to review.`,
      ttl: "86400s", // keep for a day: a phone that was offline still gets told
    };
  }
  if (kind === "untagged") {
    return {
      title: "Finish tagging your new device",
      body: `${where}: you said a new device was plugged in, but it isn't tagged yet. Tap to finish.`,
      ttl: "86400s",
    };
  }
  switch (a.alert_type) {
    case "overload":
      return { title: "Overload warning", body: `${where} is drawing ${w(a.power_w)} W. Unplug heavy appliances.`, ttl: "3600s" };
    case "voltage_sag":
      return { title: "Low voltage", body: `Voltage dropped to ${w(a.voltage_v)} V. Appliances may not run properly.`, ttl: "3600s" };
    default:
      return { title: "High voltage", body: `Voltage rose to ${w(a.voltage_v)} V. Consider unplugging sensitive appliances.`, ttl: "3600s" };
  }
}

type Msg = { title: string; body: string; ttl: string; tag: string; data: Record<string, string> };

/** Tenant / individual users of a unit. Never the landlord (outlet detail is private). */
async function recipients(unitCode: unknown) {
  const { data: unit } = await db.from("kw_units").select("id").eq("code", unitCode).maybeSingle();
  if (!unit) return null;
  const { data: members } = await db.from("kw_unit_members").select("user_id").eq("unit_id", unit.id);
  const ids = (members ?? []).map((m) => m.user_id);
  if (!ids.length) return null;
  const { data: roles } = await db.from("user_roles").select("user_id")
    .in("user_id", ids).in("role", ["tenant", "individual"]);
  const users = [...new Set((roles ?? []).map((r) => r.user_id))];
  if (!users.length) return null;
  const { data: tokens } = await db.from("kw_device_tokens").select("token").in("user_id", users);
  return { unitId: unit.id as string, tokens: (tokens ?? []).map((t) => t.token as string) };
}

async function push(tokens: string[], m: Msg): Promise<number> {
  const bearer = await accessToken();
  let sent = 0;
  for (const token of tokens) {
    const res = await fetch(
      `https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          message: {
            token,
            notification: { title: m.title, body: m.body },
            data: m.data,
            android: {
              priority: "HIGH",        // wakes a sleeping phone (Doze) so it shows now
              ttl: m.ttl,              // how long FCM keeps it for an offline phone
              collapse_key: m.tag,
              notification: {
                channel_id: "kw_alerts", // high-importance channel created in MainActivity
                tag: m.tag,              // a newer push with the same tag replaces the old one
              },
            },
          },
        }),
      },
    );
    if (res.ok) sent++;
    else if (res.status === 404 || res.status === 400) {
      const err = await res.text();
      if (err.includes("UNREGISTERED") || err.includes("INVALID_ARGUMENT")) {
        await db.from("kw_device_tokens").delete().eq("token", token); // dead token
      }
    }
  }
  return sent;
}

/** "Aircon (Box 2, Outlet 1)" - the outlet label is optional. */
async function whereText(unitId: string, boxNumber: unknown, outlet: unknown): Promise<string> {
  const pos = outlet == null ? `Box ${boxNumber}` : `Box ${boxNumber}, Outlet ${outlet}`;
  if (outlet == null) return pos;
  const { data: box } = await db.from("kw_boxes").select("id")
    .eq("unit_id", unitId).eq("box_number", boxNumber).maybeSingle();
  if (!box) return pos;
  const { data: o } = await db.from("kw_outlets").select("label")
    .eq("box_id", box.id).eq("outlet_number", outlet).maybeSingle();
  return o?.label ? `${o.label} (${pos})` : pos;
}

const json = (o: unknown) => new Response(JSON.stringify(o), { headers: { "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.headers.get("x-webhook-secret") !== Deno.env.get("WEBHOOK_SECRET")) {
    return new Response("forbidden", { status: 403 });
  }
  const evt = await req.json();
  const rec = evt.record as Alert | undefined;
  if (!rec?.id) return new Response("skip");

  // ---- box offline / back online -------------------------------------------------
  if (evt.table === "kw_box_events") {
    const r = await recipients(rec.unit_code);
    if (!r?.tokens.length) return new Response("no recipients");
    const box = `Box ${rec.box_number}`;
    const offline = rec.kind === "offline";
    const sent = await push(r.tokens, {
      title: offline ? "KiloWhat box offline" : "KiloWhat box back online",
      body: offline
        ? `${box} stopped reporting. This may be a power outage or lost Wi-Fi/internet. Live monitoring is paused until it reconnects.`
        : `${box} is reporting again.`,
      ttl: offline ? "86400s" : "3600s",
      tag: `box-${rec.box_id}`, // "online" replaces "offline" in the tray
      data: { kind: offline ? "box_offline" : "box_online", unit_code: String(rec.unit_code) },
    });
    return json({ kind: rec.kind, sent });
  }

  // ---- alerts ----------------------------------------------------------------------
  const kind = kindOf(evt.type, rec, evt.old_record);
  if (!kind) return new Response("skip");

  const r = await recipients(rec.unit_code);
  if (!r?.tokens.length) return new Response("no recipients");
  const where = await whereText(r.unitId, rec.box_number, rec.outlet);

  const { title, body, ttl } = build(kind, rec, where);
  const sent = await push(r.tokens, {
    title, body, ttl,
    tag: `alert-${rec.id}`, // the "flagged" push replaces the "question" one
    data: { alert_id: String(rec.id), kind, type: String(rec.alert_type), label: where },
  });
  if (sent > 0 && kind === "question") {
    await db.from("kw_alerts").update({ notified_at: new Date().toISOString() }).eq("id", rec.id);
  }
  return json({ kind, sent });
});