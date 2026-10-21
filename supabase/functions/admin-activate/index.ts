// KiloWhat · admin-activate  (STEP 3: invite code + rate limit + audit + 12-char admin password)
// Public on purpose: the invitee has no account yet. Two factors, delivered separately:
//   1. the link token (256-bit, single-use, short-lived, stored only as a hash)  -> by email
//   2. the 8-character invite code (stored only as sha256(code:userId))          -> from the inviter, by phone/chat
// 5 wrong codes burn the invitation (the inactive account is deleted).
//
// Deploy:  supabase functions deploy admin-activate --no-verify-jwt
// Secrets: WEB_URL (same as admin-invite)
// Needs migration 005 (rate_limit_hit, log_admin_event, admin_invites.code_hash / code_attempts).
//
// Body: { action: "check", token }                         -> { valid, email }   (masked email; link only)
//       { action: "activate", token, code, password }      -> { ok }

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const WEB_URL = (Deno.env.get('WEB_URL') ?? '').replace(/\/+$/, '');
const MAX_CODE_ATTEMPTS = 5;
const IP_LIMIT = { limit: 10, windowSec: 60 };
const ADMIN_PASSWORD_MIN = 12;

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
const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  json(status, { code, message, ...extra });

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// Admin accounts: stricter than the mobile app (12+). This function is admin-only; the app is untouched.
function passwordProblem(p: string): string | null {
  if (p.length < ADMIN_PASSWORD_MIN) return `Use at least ${ADMIN_PASSWORD_MIN} characters.`;
  if (p.length > 72) return 'Use 72 characters or fewer.';
  if (!/[a-z]/.test(p)) return 'Add a lowercase letter.';
  if (!/[A-Z]/.test(p)) return 'Add an uppercase letter.';
  if (!/[0-9]/.test(p)) return 'Add a number.';
  if (!/[^A-Za-z0-9]/.test(p)) return 'Add a special character.';
  return null;
}

function maskEmail(email: string): string {
  const [u, d] = email.split('@');
  return `${u.slice(0, 2)}***@${d}`;
}

// Same alphabet as admin-invite. Accepts "abcd-efgh", " ABCD EFGH " etc.
function normalizeCode(raw: unknown): string | null {
  if (typeof raw !== 'string' || raw.length > 40) return null;
  const c = raw.toUpperCase().replace(/[\s-]+/g, '');
  return /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/.test(c) ? c : null;
}

const INVALID = () => fail(410, 'invalid_link', 'This invitation link is invalid or has expired. Ask an administrator to send a new one.');

type Admin = SupabaseClient;
type Ctx = { ip: string | null; ua: string | null };

function clientCtx(req: Request): Ctx {
  const fwd = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? '';
  return {
    ip: fwd.split(',')[0].trim().slice(0, 64) || null,
    ua: (req.headers.get('user-agent') ?? '').slice(0, 300) || null,
  };
}

// Best effort. NEVER pass tokens, codes or passwords in `metadata`.
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

async function allow(admin: Admin, key: string, cfg: { limit: number; windowSec: number }): Promise<boolean> {
  const { data, error } = await admin.rpc('rate_limit_hit', {
    p_key: key, p_limit: cfg.limit, p_window_seconds: cfg.windowSec,
  });
  if (error) {
    console.error('rate_limit_hit failed:', error.message);
    throw error; // fail closed
  }
  return data === true;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Method not allowed.');

  const ctx = clientCtx(req);

  try {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return fail(400, 'bad_request', 'Invalid request.'); }
    const action = body.action;
    const rawToken = typeof body.token === 'string' ? body.token : '';
    if ((action !== 'check' && action !== 'activate') || rawToken.length < 20 || rawToken.length > 100) return INVALID();

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // ---- per-IP rate limit (10 / minute, shared by check + activate)
    if (!(await allow(admin, `activate:ip:${ctx.ip ?? 'unknown'}`, IP_LIMIT))) {
      // log at most once per 10 minutes per IP so a flood cannot fill the audit log
      if (await allow(admin, `activate:ratelog:${ctx.ip ?? 'unknown'}`, { limit: 1, windowSec: 600 })) {
        await audit(admin, ctx, { actorId: null, actorEmail: null, action: 'rate_limited', success: false, metadata: { scope: 'activate_ip' } });
      }
      return fail(429, 'rate_limited', 'Too many attempts. Please wait a minute and try again.');
    }

    await admin.rpc('purge_expired_admin_invites'); // expired accounts are deleted right here too

    const { data: inv, error: invError } = await admin
      .from('admin_invites')
      .select('id, user_id, expires_at, activated_at, code_hash, code_attempts')
      .eq('token_hash', await sha256Hex(rawToken))
      .maybeSingle();
    if (invError) throw invError;
    if (!inv || inv.activated_at || Date.parse(inv.expires_at) <= Date.now()) return INVALID();

    // ============================================================ CHECK (link only)
    if (action === 'check') {
      const { data: u } = await admin.auth.admin.getUserById(inv.user_id);
      return json(200, { valid: true, email: maskEmail(u?.user?.email ?? '??@??') });
    }

    // ============================================================ ACTIVATE (link + code)
    const password = typeof body.password === 'string' ? body.password : '';
    const problem = passwordProblem(password);
    if (problem) return fail(400, 'weak_password', problem);

    const code = normalizeCode(body.code);
    if (!code) return fail(400, 'invalid_code', 'Enter the 8-character invite code from your inviter.');

    // Invites created before STEP 2 have no code: they cannot be activated (fail closed).
    if (!inv.code_hash) return INVALID();

    const { data: u } = await admin.auth.admin.getUserById(inv.user_id);
    const inviteeEmail = u?.user?.email ?? null;

    if (inv.code_attempts >= MAX_CODE_ATTEMPTS) return INVALID(); // already burned / being burned

    // Count the attempt BEFORE comparing (optimistic lock) so parallel guesses cannot skip the limit.
    const { data: bumped, error: bumpError } = await admin
      .from('admin_invites')
      .update({ code_attempts: inv.code_attempts + 1 })
      .eq('id', inv.id)
      .eq('code_attempts', inv.code_attempts)
      .is('activated_at', null)
      .select('id');
    if (bumpError) throw bumpError;
    if (!bumped || bumped.length === 0) {
      return fail(429, 'rate_limited', 'Please wait a moment and try again.');
    }
    const used = inv.code_attempts + 1;

    const actual = await sha256Hex(`${code}:${inv.user_id}`);
    if (!timingSafeEqual(inv.code_hash as string, actual)) {
      const left = Math.max(0, MAX_CODE_ATTEMPTS - used);
      await audit(admin, ctx, {
        actorId: inv.user_id, actorEmail: inviteeEmail, action: 'invite_code_failed',
        target: inviteeEmail, success: false, metadata: { attempts_left: left },
      });
      if (left === 0) {
        // burn: delete the inactive account (cascades to profile, role and invite)
        await admin.auth.admin.deleteUser(inv.user_id);
        await audit(admin, ctx, {
          actorId: inv.user_id, actorEmail: inviteeEmail, action: 'invite_burned',
          target: inviteeEmail, success: false, metadata: { reason: 'too_many_wrong_codes' },
        });
        return fail(410, 'invite_burned', 'Too many incorrect codes. This invitation has been cancelled. Ask an administrator to send a new one.');
      }
      return fail(400, 'invalid_code', 'Incorrect invite code.', { attempts_left: left });
    }

    // Claim the token atomically so it can only ever be used once.
    const nowIso = new Date().toISOString();
    const { data: claimed, error: claimError } = await admin
      .from('admin_invites')
      .update({ activated_at: nowIso })
      .eq('id', inv.id)
      .is('activated_at', null)
      .gt('expires_at', nowIso)
      .select('id');
    if (claimError) throw claimError;
    if (!claimed || claimed.length === 0) return INVALID();

    const { error: updError } = await admin.auth.admin.updateUserById(inv.user_id, {
      password,
      email_confirm: true,
    });
    if (updError) {
      await admin.from('admin_invites').update({ activated_at: null }).eq('id', inv.id); // let them retry
      console.error('activate failed:', updError.message);
      return fail(500, 'server_error', 'Could not activate the account. Please try again.');
    }

    await audit(admin, ctx, {
      actorId: inv.user_id, actorEmail: inviteeEmail, action: 'invite_activated',
      target: inviteeEmail, success: true,
    });
    return json(200, { ok: true });
  } catch (err) {
    console.error('admin-activate error:', err instanceof Error ? err.message : 'unknown');
    return fail(500, 'server_error', 'Something went wrong. Please try again.');
  }
});