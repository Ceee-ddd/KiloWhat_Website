// KiloWhat · submit-inquiry
// Receives an inquiry from the public marketing website (server to server), stores it in
// public_inquiries, emails the team, and sends the visitor a short confirmation, via Brevo.
//
// Deploy:  supabase functions deploy submit-inquiry --no-verify-jwt
//          (no JWT: the website is not signed in. The shared secret below protects it.)
// Secrets: INQUIRY_SHARED_SECRET  long random string; the website sends it in x-inquiry-secret
//          INQUIRY_NOTIFY_EMAIL   where new inquiries are emailed
//          BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME  (already set)
// Needs migrations 005 (rate_limit_hit) and 014 (public_inquiries).

import { createClient } from 'npm:@supabase/supabase-js@2';

const TYPES = [
  'General Inquiry',
  'Product Information',
  'Property / Landlord Inquiry',
  'Technical Question',
  'Collaboration / Research',
  'Other',
];

// Rate limits (key, limit, window seconds)
const LIMIT_PER_EMAIL = { limit: 3, windowSec: 3600 };
const LIMIT_GLOBAL = { limit: 100, windowSec: 86_400 };

const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);
// Strip control characters (keeps newlines/tabs where the caller allows them).
const clean = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
const fail = (status: number, code: string, message: string) => json(status, { ok: false, code, message });

function safeEqual(a: string, b: string): boolean {
  const ea = new TextEncoder().encode(a);
  const eb = new TextEncoder().encode(b);
  if (ea.length !== eb.length) return false;
  let diff = 0;
  for (let i = 0; i < ea.length; i++) diff |= ea[i] ^ eb[i];
  return diff === 0;
}

// ---- email ----------------------------------------------------------------------------------

async function brevo(opts: {
  to: { email: string; name?: string };
  subject: string;
  html: string;
  replyTo?: { email: string; name?: string };
}) {
  const apiKey = Deno.env.get('BREVO_API_KEY');
  const senderEmail = Deno.env.get('BREVO_SENDER_EMAIL');
  if (!apiKey || !senderEmail) throw new Error('Brevo is not configured');

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: senderEmail, name: Deno.env.get('BREVO_SENDER_NAME') ?? 'KiloWhat' },
      to: [opts.to],
      ...(opts.replyTo ? { replyTo: opts.replyTo } : {}),
      subject: opts.subject,
      htmlContent: opts.html,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.error('Brevo send failed with status', res.status);
    throw new Error('Brevo send failed');
  }
}

const wrap = (inner: string) => `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:auto;padding:24px;color:#222">
    <h2 style="color:#4F5A37;margin:0 0 16px">Kilo<span style="color:#C28629">What</span></h2>
    ${inner}
  </div>`;

// ---- handler --------------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Method not allowed.');

  const secret = Deno.env.get('INQUIRY_SHARED_SECRET') ?? '';
  const sent = req.headers.get('x-inquiry-secret') ?? '';
  if (!secret || !safeEqual(secret, sent)) return fail(401, 'unauthorized', 'Unauthorized.');

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return fail(400, 'invalid', 'Invalid request.');
  }

  // Honeypot: accept silently, store nothing.
  if (typeof body.company === 'string' && body.company.length > 0) return json(200, { ok: true });

  const fullName = clean(String(body.fullName ?? '')).trim();
  const email = String(body.email ?? '').trim().toLowerCase();
  const inquiryType = String(body.inquiryType ?? '');
  const subject = clean(String(body.subject ?? '')).trim();
  const message = clean(String(body.message ?? '')).replace(/\r\n/g, '\n').trim();

  if (
    fullName.length < 2 || fullName.length > 100 ||
    email.length > 255 || !EMAIL_RE.test(email) ||
    !TYPES.includes(inquiryType) ||
    subject.length < 3 || subject.length > 120 ||
    message.length < 10 || message.length > 2000
  ) {
    return fail(400, 'invalid', 'Please review the form and try again.');
  }

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  try {
    // Rate limits: fail closed on errors.
    for (const [key, cfg] of [
      [`inquiry:email:${email}`, LIMIT_PER_EMAIL],
      ['inquiry:global', LIMIT_GLOBAL],
    ] as const) {
      const { data, error } = await db.rpc('rate_limit_hit', {
        p_key: key, p_limit: cfg.limit, p_window_seconds: cfg.windowSec,
      });
      if (error) throw error;
      if (data !== true) return fail(429, 'rate_limited', 'Too many inquiries. Please try again later.');
    }

    const { data: row, error: insertError } = await db
      .from('public_inquiries')
      .insert({ full_name: fullName, email, inquiry_type: inquiryType, subject, message })
      .select('id')
      .single();
    if (insertError) throw insertError;

    // Emails. The inquiry is already stored, so an email failure never fails the request.
    const notifyTo = Deno.env.get('INQUIRY_NOTIFY_EMAIL');
    const stamps: Record<string, string> = {};

    if (notifyTo) {
      try {
        await brevo({
          to: { email: notifyTo },
          replyTo: { email, name: fullName },
          subject: `[KiloWhat inquiry] ${subject}`,
          html: wrap(`
            <p><b>New website inquiry</b></p>
            <p>From: ${esc(fullName)} &lt;${esc(email)}&gt;<br>Type: ${esc(inquiryType)}<br>Subject: ${esc(subject)}</p>
            <div style="border-left:3px solid #C28629;padding:4px 12px;margin:16px 0;white-space:pre-wrap">${esc(message)}</div>
            <p style="color:#888;font-size:12px">Reply to this email to answer the sender.</p>`),
        });
        stamps.notified_at = new Date().toISOString();
      } catch (e) {
        console.error('team notification failed:', (e as Error).message);
      }
    } else {
      console.error('INQUIRY_NOTIFY_EMAIL is not set; team was not emailed.');
    }

    try {
      await brevo({
        to: { email, name: fullName },
        subject: 'We received your KiloWhat inquiry',
        html: wrap(`
          <p>Hi ${esc(fullName)},</p>
          <p>Thank you for reaching out. We received your inquiry <b>“${esc(subject)}”</b> and will reply to this email address.</p>
          <p style="color:#888;font-size:12px">If you didn't send this inquiry, you can ignore this email.</p>`),
      });
      stamps.ack_sent_at = new Date().toISOString();
    } catch (e) {
      console.error('confirmation email failed:', (e as Error).message);
    }

    if (Object.keys(stamps).length) {
      await db.from('public_inquiries').update(stamps).eq('id', row.id);
    }

    return json(200, { ok: true });
  } catch (e) {
    console.error('submit-inquiry failed:', (e as Error).message);
    return fail(500, 'server_error', 'Something went wrong. Please try again in a moment.');
  }
});