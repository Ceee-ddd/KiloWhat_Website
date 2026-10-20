// KiloWhat · admin-invite  (STEP 2: rate limits + out-of-band invite code + audit log)
// An existing admin invites a new admin by email.
//  - creates an INACTIVE account (email not confirmed, random password nobody knows)
//  - emails a one-time activation link; the invitee sets their own password
//  - generates an 8-character invite code, returned ONCE to the inviter (never emailed, never logged);
//    the inviter gives it to the invitee by phone or chat. Only sha256(code:userId) is stored.
//  - rate limits: 5 invites / admin / hour, 3 / target email / day, 20 / day globally (generic 429)
//  - audit events: invite_sent, invite_rate_limited, invite_failed (never tokens or codes)
//
// Deploy:  supabase functions deploy admin-invite
// Secrets: WEB_URL              e.g. https://your-admin-site.com (http://localhost:8080 in dev)
//          INVITE_TTL_MINUTES   optional, default 15
//          BREVO_API_KEY, BREVO_SENDER_EMAIL, BREVO_SENDER_NAME  (already set for device-otp)
// Needs migration 005 (rate_limit_hit, log_admin_event, admin_invites.code_hash).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const WEB_URL = (Deno.env.get('WEB_URL') ?? '').replace(/\/+$/, '');
const TTL_MIN = Math.max(1, Number(Deno.env.get('INVITE_TTL_MINUTES') ?? '15') || 15);

// Rate limits (key, limit, window seconds)
const LIMIT_PER_ADMIN = { limit: 5, windowSec: 3600 };
const LIMIT_PER_EMAIL = { limit: 3, windowSec: 86_400 };
const LIMIT_GLOBAL = { limit: 20, windowSec: 86_400 };

// 32 symbols, no 0/O/1/I (uppercase only, so no lowercase l either). 32 divides 256 -> no modulo bias.
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

const cors = {
  'Access-Control-Allow-Origin': WEB_URL || 'null',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
const fail = (status: number, code: string, message: string) => json(status, { code, message });

const EMAIL_RE = /^[A-Za-z0-9._%+\-]+@[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9\-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;

const b64url = (bytes: Uint8Array) =>
  btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function generateInviteCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => CODE_ALPHABET[b & 31]).join('');
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

// ---- audit + rate limit helpers -------------------------------------------------------------

type Admin = SupabaseClient;
type Ctx = { ip: string | null; ua: string | null };

function clientCtx(req: Request): Ctx {
  const fwd = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? '';
  const ip = fwd.split(',')[0].trim().slice(0, 64) || null;
  const ua = (req.headers.get('user-agent') ?? '').slice(0, 300) || null;
  return { ip, ua };
}

// Best effort: a logging failure must never break (or reveal anything about) the request.
// NEVER pass tokens, codes or passwords in `metadata`.
async function audit(
  admin: Admin,
  ctx: Ctx,
  ev: { actorId: string | null; actorEmail: string | null; action: string; target?: string | null; success: boolean; metadata?: Record<string, unknown> },
) {
  try {
    const { error } = await admin.rpc('log_admin_event', {
      p_actor_id: ev.actorId,
      p_actor_email: ev.actorEmail,
      p_action: ev.action,
      p_target: ev.target ?? null,
      p_success: ev.success,
      p_ip: ctx.ip,
      p_user_agent: ctx.ua,
      p_metadata: ev.metadata ?? {},
    });
    if (error) console.error('audit write failed:', error.message);
  } catch {
    console.error('audit write failed');
  }
}

// true = allowed, false = blocked. Errors are thrown (fail closed -> generic 500).
async function allow(admin: Admin, key: string, cfg: { limit: number; windowSec: number }): Promise<boolean> {
  const { data, error } = await admin.rpc('rate_limit_hit', {
    p_key: key, p_limit: cfg.limit, p_window_seconds: cfg.windowSec,
  });
  if (error) {
    console.error('rate_limit_hit failed:', error.message);
    throw error;
  }
  return data === true;
}

// ---- email ----------------------------------------------------------------------------------

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
    <p>You will also need an <b>invite code</b>. ${esc(opts.inviter)} will give it to you <b>separately</b> (by phone or chat). It is not in this email, so ask them for it.</p>
    <p>This link works <b>once</b> and expires in <b>${TTL_MIN} minute${TTL_MIN === 1 ? '' : 's'}</b>. After that the invitation is cancelled and an admin must send a new one.</p>
    <p style="color:#888;font-size:12px">We never email passwords or codes. If you weren't expecting this, ignore this email.</p>
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

// ---- handler --------------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Method not allowed.');
  if (!WEB_URL) return fail(500, 'server_error', 'WEB_URL is not configured.');

  const ctx = clientCtx(req);
  let admin: Admin | null = null;
  let actor: { id: string; email: string | null } | null = null;

  try {
    // 1. caller must hold a valid session
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return fail(401, 'unauthorized', 'Please sign in again.');

    admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const caller = userData?.user;
    if (userError || !caller) return fail(401, 'unauthorized', 'Please sign in again.');
    actor = { id: caller.id, email: caller.email ?? null };

    // 2. caller must be an admin (checked in the database, not from the token)
    const { data: roleRow, error: roleError } = await admin
      .from('user_roles').select('role').eq('user_id', caller.id).eq('role', 'admin').maybeSingle();
    if (roleError) throw roleError;
    if (!roleRow) {
      await audit(admin, ctx, { actorId: actor.id, actorEmail: actor.email, action: 'invite_failed', success: false, metadata: { reason: 'not_admin' } });
      return fail(403, 'forbidden', 'Only administrators can add administrators.');
    }

    // 2b. the login session must have passed the new-device check
    const sessionId = sessionIdFromJwt(token);
    if (!sessionId) return fail(401, 'unauthorized', 'Please sign in again.');
    const { data: vs, error: vsError } = await admin
      .from('verified_sessions').select('session_id').eq('session_id', sessionId).eq('user_id', caller.id).maybeSingle();
    if (vsError) throw vsError;
    if (!vs) {
      await audit(admin, ctx, { actorId: actor.id, actorEmail: actor.email, action: 'invite_failed', success: false, metadata: { reason: 'unverified_session' } });
      return fail(403, 'unverified_session', 'Verify this device before adding administrators.');
    }

    // 3. validate input
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return fail(400, 'bad_request', 'Invalid request.'); }
    const name = (typeof body.name === 'string' ? body.name : '').trim().replace(/\s+/g, ' ');
    const email = (typeof body.email === 'string' ? body.email : '').trim().toLowerCase();
    if (name.length < 2 || name.length > 60) return fail(400, 'invalid_name', 'Name must be 2 to 60 characters.');
    if (email.length > 254 || email.includes('..') || !EMAIL_RE.test(email)) {
      return fail(400, 'invalid_email', 'Enter a valid email address.');
    }

    // 3b. rate limits (generic 429: the response never says which limit was hit)
    const emailKey = await sha256Hex(email); // hashed so no raw email sits in the counter table
    let blockedBy: 'admin' | 'email' | 'global' | null = null;
    if (!(await allow(admin, `invite:admin:${caller.id}`, LIMIT_PER_ADMIN))) blockedBy = 'admin';
    else if (!(await allow(admin, `invite:email:${emailKey}`, LIMIT_PER_EMAIL))) blockedBy = 'email';
    else if (!(await allow(admin, 'invite:global', LIMIT_GLOBAL))) blockedBy = 'global';
    if (blockedBy) {
      await audit(admin, ctx, {
        actorId: actor.id, actorEmail: actor.email, action: 'invite_rate_limited',
        target: email, success: false, metadata: { scope: blockedBy },
      });
      return fail(429, 'rate_limited', 'Too many invitations. Please try again later.');
    }

    const failed = (reason: string) =>
      audit(admin!, ctx, { actorId: actor!.id, actorEmail: actor!.email, action: 'invite_failed', target: email, success: false, metadata: { reason } });

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
      await failed('pending_insert');
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
        await failed('email_exists');
        return fail(409, 'email_exists', 'This email already has an account or a pending invitation.');
      }
      console.error('createUser failed:', createError?.message);
      await failed('create_user');
      return fail(500, 'server_error', 'Could not create the account.');
    }
    const userId = created.user.id;

    // 6. one-time activation token + invite code (only their hashes are stored)
    const rawToken = b64url(crypto.getRandomValues(new Uint8Array(32)));
    const inviteCode = generateInviteCode();
    const expiresAt = new Date(Date.now() + TTL_MIN * 60_000);
    const { error: inviteError } = await admin.from('admin_invites').insert({
      user_id: userId,
      token_hash: await sha256Hex(rawToken),
      code_hash: await sha256Hex(`${inviteCode}:${userId}`),
      code_attempts: 0,
      created_by: caller.id,
      expires_at: expiresAt.toISOString(),
    });
    if (inviteError) {
      await admin.auth.admin.deleteUser(userId);
      console.error('invite insert failed:', inviteError.message);
      await failed('invite_insert');
      return fail(500, 'server_error', 'Could not create the invitation.');
    }

    // 7. email the link only (token in the URL fragment: not sent to servers or logs).
    //    The code is NOT in the email.
    try {
      await sendInviteEmail({
        to: email,
        name,
        inviter: String(caller.user_metadata?.full_name ?? 'An administrator'),
        link: `${WEB_URL}/activate#token=${rawToken}`,
      });
    } catch {
      await admin.auth.admin.deleteUser(userId); // roll back: no orphan account
      await failed('email_send');
      return fail(502, 'email_send_failed', 'We could not send the invitation email.');
    }

    await audit(admin, ctx, {
      actorId: actor.id, actorEmail: actor.email, action: 'invite_sent',
      target: email, success: true, metadata: { ttl_minutes: TTL_MIN },
    });

    // The ONLY place the code ever leaves the server: this response, to the inviter.
    return json(200, {
      ok: true,
      email,
      expires_at: expiresAt.toISOString(),
      ttl_minutes: TTL_MIN,
      invite_code: inviteCode,
    });
  } catch (err) {
    console.error('admin-invite error:', err instanceof Error ? err.message : 'unknown');
    if (admin && actor) {
      await audit(admin, ctx, { actorId: actor.id, actorEmail: actor.email, action: 'invite_failed', success: false, metadata: { reason: 'exception' } });
    }
    return fail(500, 'server_error', 'Something went wrong. Please try again.');
  }
});