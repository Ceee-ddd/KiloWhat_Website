// KiloWhat · admin-invite
// An existing admin invites a new admin by email.
//  - creates an INACTIVE account (email not confirmed, random password nobody knows)
//  - emails a one-time activation link; the invitee sets their own password
//  - nothing secret (no password) is ever emailed or returned
//
// Deploy:  supabase functions deploy admin-invite
// Secrets: WEB_URL              e.g. https://your-admin-site.com (http://localhost:5173 in dev)
//          INVITE_TTL_MINUTES   optional, default 15
//          BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME  (already set for device-otp)

import { createClient } from 'npm:@supabase/supabase-js@2';

const WEB_URL = (Deno.env.get('WEB_URL') ?? '').replace(/\/+$/, '');
const TTL_MIN = Math.max(1, Number(Deno.env.get('INVITE_TTL_MINUTES') ?? '15') || 15);

const cors = {
  'Access-Control-Allow-Origin': WEB_URL || 'null',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
const fail = (status: number, code: string, message: string) => json(status, { code, message });

const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
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

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ESC[c]);

async function sendInviteEmail(opts: { to: string; name: string; inviter: string; link: string }) {
  const apiKey = Deno.env.get('BREVO_API_KEY');
  const senderEmail = Deno.env.get('BREVO_SENDER_EMAIL');
  if (!apiKey || !senderEmail) throw new Error('Brevo is not configured');

  const html = `
  <div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto;padding:24px;color:#222">
    <h2 style="color:#2E7D32;margin:0 0 16px">KiloWhat Admin</h2>
    <p>Hi ${esc(opts.name)},</p>
    <p>${esc(opts.inviter)} invited you to be an administrator. Activate your account and choose your own password:</p>
    <p style="margin:24px 0"><a href="${opts.link}" style="background:#2E7D32;color:#fff;padding:12px 22px;border-radius:8px;text-decoration:none;font-weight:bold">Activate my account</a></p>
    <p>This link works <b>once</b> and expires in <b>${TTL_MIN} minute${TTL_MIN === 1 ? '' : 's'}</b>. After that the invitation is cancelled and an admin must send a new one.</p>
    <p style="color:#888;font-size:12px">We never email passwords. If you weren't expecting this, ignore this email.</p>
  </div>`;

  const res = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': apiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { email: senderEmail, name: Deno.env.get('BREVO_SENDER_NAME') ?? 'KiloWhat' },
      to: [{ email: opts.to, name: opts.name }],
      subject: 'Activate your KiloWhat admin account',
      htmlContent: html,
    }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    console.error('Brevo send failed with status', res.status);
    throw new Error('Brevo send failed');
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Method not allowed.');
  if (!WEB_URL) return fail(500, 'server_error', 'WEB_URL is not configured.');

  try {
    // 1. caller must hold a valid session
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return fail(401, 'unauthorized', 'Please sign in again.');

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const caller = userData?.user;
    if (userError || !caller) return fail(401, 'unauthorized', 'Please sign in again.');

    // 2. caller must be an admin (checked in the database, not from the token)
    const { data: roleRow, error: roleError } = await admin
      .from('user_roles').select('role').eq('user_id', caller.id).eq('role', 'admin').maybeSingle();
    if (roleError) throw roleError;
    if (!roleRow) return fail(403, 'forbidden', 'Only administrators can add administrators.');

    // 2b. the login session must have passed the new-device check
    const sessionId = sessionIdFromJwt(token);
    if (!sessionId) return fail(401, 'unauthorized', 'Please sign in again.');
    const { data: vs, error: vsError } = await admin
      .from('verified_sessions').select('session_id').eq('session_id', sessionId).eq('user_id', caller.id).maybeSingle();
    if (vsError) throw vsError;
    if (!vs) return fail(403, 'unverified_session', 'Verify this device before adding administrators.');

    // 3. validate input
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return fail(400, 'bad_request', 'Invalid request.'); }
    const name = (typeof body.name === 'string' ? body.name : '').trim().replace(/\s+/g, ' ');
    const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
    if (name.length < 2 || name.length > 60) return fail(400, 'invalid_name', 'Name must be 2 to 60 characters.');
    if (email.length > 254 || email.includes('..') || !EMAIL_RE.test(email)) {
      return fail(400, 'invalid_email', 'Enter a valid email address.');
    }

    // 4. clear out expired invitations first so their emails can be reused
    await admin.rpc('purge_expired_admin_invites');

    // 5a. pre-register the email so the sign-up trigger creates an admin profile (single use, 2 min)
    const { error: pendingError } = await admin.from('admin_pending').upsert({
      email,
      created_by: caller.id,
      expires_at: new Date(Date.now() + 2 * 60_000).toISOString(),
    });
    if (pendingError) {
      console.error('pending insert failed:', pendingError.message);
      return fail(500, 'server_error', 'Could not create the account.');
    }

    // 5b. create the INACTIVE account.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: b64url(crypto.getRandomValues(new Uint8Array(48))) + 'aA1!', // nobody ever knows it
      email_confirm: false,                                                  // cannot sign in until activated
      user_metadata: { full_name: name },
      app_metadata: { role: 'admin' },
    });
    if (createError || !created?.user) {
      await admin.from('admin_pending').delete().eq('email', email);
      const msg = (createError?.message ?? '').toLowerCase();
      if (msg.includes('already') || msg.includes('registered') || msg.includes('exists')) {
        return fail(409, 'email_exists', 'This email already has an account or a pending invitation.');
      }
      console.error('createUser failed:', createError?.message);
      return fail(500, 'server_error', 'Could not create the account.');
    }
    const userId = created.user.id;

    // 6. one-time activation token (only its hash is stored)
    const rawToken = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const expiresAt = new Date(Date.now() + TTL_MIN * 60_000);
    const { error: inviteError } = await admin.from('admin_invites').insert({
      user_id: userId,
      token_hash: await sha256Hex(rawToken),
      created_by: caller.id,
      expires_at: expiresAt.toISOString(),
    });
    if (inviteError) {
      await admin.auth.admin.deleteUser(userId);
      console.error('invite insert failed:', inviteError.message);
      return fail(500, 'server_error', 'Could not create the invitation.');
    }

    // 7. email the link (token in the URL fragment: not sent to servers or logs)
    try {
      await sendInviteEmail({
        to: email,
        name,
        inviter: String(caller.user_metadata?.full_name ?? 'An administrator'),
        link: `${WEB_URL}/activate#token=${rawToken}`,
      });
    } catch {
      await admin.auth.admin.deleteUser(userId); // roll back: no orphan account
      return fail(502, 'email_send_failed', 'We could not send the invitation email.');
    }

    return json(200, { ok: true, email, expires_at: expiresAt.toISOString(), ttl_minutes: TTL_MIN });
  } catch (err) {
    console.error('admin-invite error:', err instanceof Error ? err.message : 'unknown');
    return fail(500, 'server_error', 'Something went wrong. Please try again.');
  }
});