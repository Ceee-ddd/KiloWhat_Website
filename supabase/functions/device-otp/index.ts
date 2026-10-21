// KiloWhat · device-otp
// Sends and verifies the 6-digit code required when logging in from a new
// device. Emails are sent through the Brevo transactional API.
//
// Secrets (supabase secrets set ...):
//   BREVO_API_KEY       Brevo API key (NOT the SMTP key)
//   BREVO_SENDER_EMAIL  a sender verified in Brevo
//   BREVO_SENDER_NAME   optional, defaults to "KiloWhat"
// Auto-provided by Supabase: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { createClient } from 'npm:@supabase/supabase-js@2';

const CODE_TTL_MS = 10 * 60 * 1000; // code valid for 10 minutes
const RESEND_COOLDOWN_MS = 60 * 1000; // at most one email per minute
const SEND_WINDOW_MS = 10 * 60 * 1000;
const MAX_SENDS_PER_WINDOW = 3;
const MAX_ATTEMPTS = 5;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function fail(status: number, code: string, message: string, extra: Record<string, unknown> = {}) {
  return json(status, { code, message, ...extra });
}

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function generateCode(): string {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return String(buf[0] % 1_000_000).padStart(6, '0');
}

function sessionIdFromJwt(token: string): string | null {
  try {
    const payload = token.split('.')[1];
    const claims = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')));
    return typeof claims.session_id === 'string' ? claims.session_id : null;
  } catch {
    return null;
  }
}

const HTML_ESCAPES: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

async function sendCodeEmail(opts: {
  to: string;
  name: string;
  code: string;
  deviceName: string;
}): Promise<void> {
  const apiKey = Deno.env.get('BREVO_API_KEY');
  const senderEmail = Deno.env.get('BREVO_SENDER_EMAIL');
  if (!apiKey || !senderEmail) throw new Error('Brevo is not configured');

  const device = escapeHtml(opts.deviceName || 'a new device');
  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto;padding:24px;color:#222">
    <h2 style="color:#2E7D32;margin:0 0 16px">KiloWhat</h2>
    <p>Hi ${escapeHtml(opts.name || 'there')},</p>
    <p>Someone signed in to your account from <b>${device}</b>. Enter this code in the app to continue:</p>
    <p style="font-size:32px;letter-spacing:8px;font-weight:bold;margin:24px 0">${opts.code}</p>
    <p>The code expires in 10 minutes. If this wasn't you, don't share the code and change your password.</p>
    <p style="color:#888;font-size:12px">KiloWhat · Power Submetering &amp; Budget Management</p>
  </div>`;

  const response = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: senderEmail, name: Deno.env.get('BREVO_SENDER_NAME') ?? 'KiloWhat' },
      to: [{ email: opts.to, name: opts.name || undefined }],
      subject: 'Your KiloWhat verification code',
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(10_000),
  });

  if (!response.ok) {
    // Log status only. Never log the code or the recipient's details.
    console.error('Brevo send failed with status', response.status);
    throw new Error('Brevo send failed');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Method not allowed.');

  try {
    // ---- authenticate: the caller must hold a valid Supabase session
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return fail(401, 'unauthorized', 'Please log in again.');

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const user = userData?.user;
    const sessionId = sessionIdFromJwt(token);
    if (userError || !user || !user.email || !sessionId) {
      return fail(401, 'unauthorized', 'Please log in again.');
    }

    // ---- validate input
    let body: Record<string, unknown>;
    try {
      body = await req.json();
    } catch {
      return fail(400, 'bad_request', 'Invalid request.');
    }
    const action = body.action;
    const deviceId = typeof body.device_id === 'string' ? body.device_id : '';
    const deviceName = typeof body.device_name === 'string' ? body.device_name.slice(0, 80) : '';
    const platform = typeof body.platform === 'string' ? body.platform.slice(0, 20) : '';
    if ((action !== 'send' && action !== 'verify') || deviceId.length < 32 || deviceId.length > 128) {
      return fail(400, 'bad_request', 'Invalid request.');
    }

    const now = Date.now();

    // =========================================================== SEND
    if (action === 'send') {
      // purge old rows (best effort)
      await admin.from('device_otps').delete().lt('expires_at', new Date(now - 24 * 3600 * 1000).toISOString());

      const { data: recent, error: recentError } = await admin
        .from('device_otps')
        .select('created_at')
        .eq('user_id', user.id)
        .gte('created_at', new Date(now - SEND_WINDOW_MS).toISOString())
        .order('created_at', { ascending: false });
      if (recentError) throw recentError;

      if ((recent?.length ?? 0) >= MAX_SENDS_PER_WINDOW) {
        return fail(429, 'rate_limited', 'Too many code requests. Please wait a few minutes.');
      }
      const last = recent?.[0];
      if (last) {
        const waitMs = RESEND_COOLDOWN_MS - (now - Date.parse(last.created_at));
        if (waitMs > 0) return json(200, { ok: true, already_sent: true, resend_in: Math.ceil(waitMs / 1000) });
      }

      const code = generateCode();
      const { data: inserted, error: insertError } = await admin
        .from('device_otps')
        .insert({
          user_id: user.id,
          session_id: sessionId,
          code_hash: await sha256Hex(`${code}:${user.id}:${sessionId}`),
          expires_at: new Date(now + CODE_TTL_MS).toISOString(),
        })
        .select('id')
        .single();
      if (insertError) throw insertError;

      try {
        await sendCodeEmail({
          to: user.email,
          name: String(user.user_metadata?.full_name ?? ''),
          code,
          deviceName,
        });
      } catch (_err) {
        await admin.from('device_otps').delete().eq('id', inserted.id);
        return fail(502, 'email_send_failed', 'We could not send the verification email.');
      }
      return json(200, { ok: true });
    }

    // ========================================================= VERIFY
    const code = typeof body.code === 'string' ? body.code : '';
    if (!/^\d{6}$/.test(code)) return fail(400, 'invalid_code', 'Enter the 6-digit code.');

    const { data: row, error: rowError } = await admin
      .from('device_otps')
      .select('id, code_hash, attempts, expires_at')
      .eq('user_id', user.id)
      .eq('session_id', sessionId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (rowError) throw rowError;

    if (!row || Date.parse(row.expires_at) < now) {
      return fail(400, 'code_expired', 'That code has expired. Request a new one.');
    }
    if (row.attempts >= MAX_ATTEMPTS) {
      return fail(429, 'too_many_attempts', 'Too many incorrect attempts. Request a new code.');
    }

    // Count the attempt first (optimistic lock) so parallel guesses can't skip the limit.
    const { data: bumped, error: bumpError } = await admin
      .from('device_otps')
      .update({ attempts: row.attempts + 1 })
      .eq('id', row.id)
      .eq('attempts', row.attempts)
      .select('id');
    if (bumpError) throw bumpError;
    if (!bumped || bumped.length === 0) {
      return fail(429, 'rate_limited', 'Please wait a moment and try again.');
    }

    const expected = row.code_hash as string;
    const actual = await sha256Hex(`${code}:${user.id}:${sessionId}`);
    if (!timingSafeEqual(expected, actual)) {
      const left = Math.max(0, MAX_ATTEMPTS - (row.attempts + 1));
      return fail(400, left === 0 ? 'too_many_attempts' : 'invalid_code', 'Incorrect code.', {
        attempts_left: left,
      });
    }

    // ---- success: trust this device and mark this login session verified
    const deviceHash = await sha256Hex(deviceId);
    const { data: device, error: deviceError } = await admin
      .from('trusted_devices')
      .upsert(
        {
          user_id: user.id,
          device_hash: deviceHash,
          device_name: deviceName || null,
          platform: platform || null,
          last_seen_at: new Date().toISOString(),
          revoked_at: null,
        },
        { onConflict: 'user_id,device_hash' },
      )
      .select('id')
      .single();
    if (deviceError) throw deviceError;

    const { error: sessionError } = await admin
      .from('verified_sessions')
      .upsert({ session_id: sessionId, user_id: user.id, device_id: device.id }, { onConflict: 'session_id' });
    if (sessionError) throw sessionError;

    await admin.from('device_otps').delete().eq('user_id', user.id).eq('session_id', sessionId);
    return json(200, { ok: true });
  } catch (err) {
    console.error('device-otp error:', err instanceof Error ? err.message : 'unknown');
    return fail(500, 'server_error', 'Something went wrong. Please try again.');
  }
});
