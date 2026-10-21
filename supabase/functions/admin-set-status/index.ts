// KiloWhat · admin-set-status
// An admin disables or re-enables ANOTHER admin account. The caller must re-enter their own password.
//  - caller: valid session, admin role, device-verified session (same checks as admin-invite)
//  - never on yourself; never the last active admin; not for accounts that are still Pending
//  - password is checked with a throwaway client (signInWithPassword) and never stored or logged
//  - rate limit: 10 attempts / admin / 15 min (generic 429)
//  - audit events: admin_disabled, admin_enabled, password_confirm_failed (never passwords)
//
// Deploy:  supabase functions deploy admin-set-status
// Secrets: WEB_URL (already set). SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY are built in.
// Needs migration 007 (admin_set_disabled) and 005 (rate_limit_hit, log_admin_event).

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

// WEB_URL = one origin, or a comma-separated allowlist (first = primary), e.g.
//   https://kilowhat-admin.vercel.app,http://localhost:8080
const ALLOWED_ORIGINS = (Deno.env.get('WEB_URL') ?? '')
  .split(',')
  .map((o) => o.trim().replace(/\/+$/, ''))
  .filter(Boolean);
const WEB_URL = ALLOWED_ORIGINS[0] ?? '';
const LIMIT = { limit: 10, windowSec: 900 };
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const cors: Record<string, string> = {
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

function sessionIdFromJwt(token: string): string | null {
  try {
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof claims.session_id === 'string' ? claims.session_id : null;
  } catch {
    return null;
  }
}

type Ctx = { ip: string | null; ua: string | null };
function clientCtx(req: Request): Ctx {
  const fwd = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? '';
  return { ip: fwd.split(',')[0].trim().slice(0, 64) || null, ua: (req.headers.get('user-agent') ?? '').slice(0, 300) || null };
}
async function audit(
  admin: SupabaseClient, ctx: Ctx,
  ev: { actorId: string | null; actorEmail: string | null; action: string; target?: string | null; success: boolean; metadata?: Record<string, unknown> },
) {
  try {
    const { error } = await admin.rpc('log_admin_event', {
      p_actor_id: ev.actorId, p_actor_email: ev.actorEmail, p_action: ev.action, p_target: ev.target ?? null,
      p_success: ev.success, p_ip: ctx.ip, p_user_agent: ctx.ua, p_metadata: ev.metadata ?? {},
    });
    if (error) console.error('audit write failed:', error.message);
  } catch { console.error('audit write failed'); }
}

Deno.serve(async (req) => {
  // Reflect the caller's origin only if it is on the allowlist; otherwise fall back to the primary.
  const reqOrigin = req.headers.get('origin') ?? '';
  cors['Access-Control-Allow-Origin'] = ALLOWED_ORIGINS.includes(reqOrigin) ? reqOrigin : WEB_URL || 'null';
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Method not allowed.');
  if (!WEB_URL) return fail(500, 'server_error', 'WEB_URL is not configured.');

  const ctx = clientCtx(req);
  try {
    // 1. caller session
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return fail(401, 'unauthorized', 'Please sign in again.');
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const caller = userData?.user;
    if (userError || !caller || !caller.email) return fail(401, 'unauthorized', 'Please sign in again.');

    // 2. admin role + device-verified session (checked in the database)
    const { data: roleRow, error: roleError } = await admin.from('user_roles').select('role').eq('user_id', caller.id).eq('role', 'admin').maybeSingle();
    if (roleError) throw roleError;
    if (!roleRow) return fail(403, 'forbidden', 'Only administrators can do this.');
    const sessionId = sessionIdFromJwt(token);
    if (!sessionId) return fail(401, 'unauthorized', 'Please sign in again.');
    const { data: vs, error: vsError } = await admin.from('verified_sessions').select('session_id').eq('session_id', sessionId).eq('user_id', caller.id).maybeSingle();
    if (vsError) throw vsError;
    if (!vs) return fail(403, 'unverified_session', 'Verify this device first.');

    // 3. input
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return fail(400, 'bad_request', 'Invalid request.'); }
    const targetId = typeof body.target_id === 'string' ? body.target_id : '';
    const disable = body.disable;
    const password = typeof body.password === 'string' ? body.password : '';
    if (!UUID_RE.test(targetId) || typeof disable !== 'boolean') return fail(400, 'bad_request', 'Invalid request.');
    if (!password || password.length > 200) return fail(400, 'invalid_password', 'Enter your password to confirm.');
    if (targetId === caller.id) return fail(400, 'self_not_allowed', 'You cannot change your own account status.');

    // 4. rate limit
    const { data: allowed, error: rlError } = await admin.rpc('rate_limit_hit', { p_key: `status:admin:${caller.id}`, p_limit: LIMIT.limit, p_window_seconds: LIMIT.windowSec });
    if (rlError) throw rlError;
    if (allowed !== true) return fail(429, 'rate_limited', 'Too many attempts. Please wait a few minutes and try again.');

    // 5. target (for the audit trail) 
    const { data: targetData } = await admin.auth.admin.getUserById(targetId);
    const targetEmail = targetData?.user?.email ?? null;
    if (!targetEmail) return fail(404, 'not_found', 'Administrator not found.');

    // 6. re-check the caller's password on a throwaway client; its session is revoked right away
    const verifier = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: pwError } = await verifier.auth.signInWithPassword({ email: caller.email, password });
    if (pwError) {
      await audit(admin, ctx, { actorId: caller.id, actorEmail: caller.email, action: 'password_confirm_failed', target: targetEmail, success: false });
      if (pwError.status === 429) return fail(429, 'rate_limited', 'Too many attempts. Please wait a few minutes and try again.');
      return fail(400, 'invalid_password', 'Incorrect password.');
    }
    await verifier.auth.signOut().catch(() => {});

    // 7. do it (guards + atomic change live in the database)
    const { error: rpcError } = await admin.rpc('admin_set_disabled', { p_actor: caller.id, p_target: targetId, p_disable: disable });
    if (rpcError) {
      const m = rpcError.message ?? '';
      if (m.includes('last_admin')) return fail(409, 'last_admin', 'You cannot disable the last active administrator.');
      if (m.includes('pending')) return fail(409, 'pending', 'This account has not been activated yet.');
      if (m.includes('already_disabled')) return fail(409, 'already_disabled', 'This account is already disabled.');
      if (m.includes('already_enabled')) return fail(409, 'already_enabled', 'This account is already active.');
      if (m.includes('target_not_admin')) return fail(404, 'not_found', 'Administrator not found.');
      if (m.includes('self_not_allowed')) return fail(400, 'self_not_allowed', 'You cannot change your own account status.');
      throw rpcError;
    }

    await audit(admin, ctx, { actorId: caller.id, actorEmail: caller.email, action: disable ? 'admin_disabled' : 'admin_enabled', target: targetEmail, success: true });
    return json(200, { ok: true, status: disable ? 'Disabled' : 'Active' });
  } catch (e) {
    console.error('admin-set-status failed:', e instanceof Error ? e.message : 'unknown');
    return fail(500, 'server_error', 'Something went wrong. Please try again.');
  }
});