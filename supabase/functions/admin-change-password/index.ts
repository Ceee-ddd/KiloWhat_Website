// KiloWhat · admin-change-password
// An admin changes THEIR OWN password.
//  - caller: valid session, admin role, device-verified session
//  - current password re-checked on a throwaway client; new password must meet the admin rule
//    (12-72 chars, lower, upper, digit, special) and differ from the current one
//  - afterwards every OTHER session of the caller is ended; the current one stays signed in
//  - rate limit: 10 attempts / admin / 15 min (generic 429)
//  - audit events: password_changed, password_confirm_failed (never passwords)
//
// Deploy:  supabase functions deploy admin-change-password
// Needs migration 008 (admin_revoke_other_sessions) and 005 (rate_limit_hit, log_admin_event). Secret WEB_URL already set.

import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2';

const WEB_URL = (Deno.env.get('WEB_URL') ?? '').replace(/\/+$/, '');
const LIMIT = { limit: 10, windowSec: 900 };

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

function sessionIdFromJwt(token: string): string | null {
  try {
    const claims = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
    return typeof claims.session_id === 'string' ? claims.session_id : null;
  } catch {
    return null;
  }
}

function passwordProblem(p: string): string | null {
  if (p.length < 12) return 'Use at least 12 characters.';
  if (p.length > 72) return 'Use 72 characters or fewer.';
  if (!/[a-z]/.test(p)) return 'Add a lowercase letter.';
  if (!/[A-Z]/.test(p)) return 'Add an uppercase letter.';
  if (!/[0-9]/.test(p)) return 'Add a number.';
  if (!/[^A-Za-z0-9]/.test(p)) return 'Add a special character.';
  return null;
}

type Ctx = { ip: string | null; ua: string | null };
function clientCtx(req: Request): Ctx {
  const fwd = req.headers.get('x-forwarded-for') ?? req.headers.get('cf-connecting-ip') ?? '';
  return { ip: fwd.split(',')[0].trim().slice(0, 64) || null, ua: (req.headers.get('user-agent') ?? '').slice(0, 300) || null };
}
async function audit(
  admin: SupabaseClient, ctx: Ctx,
  ev: { actorId: string | null; actorEmail: string | null; action: string; target?: string | null; success: boolean },
) {
  try {
    const { error } = await admin.rpc('log_admin_event', {
      p_actor_id: ev.actorId, p_actor_email: ev.actorEmail, p_action: ev.action, p_target: ev.target ?? null,
      p_success: ev.success, p_ip: ctx.ip, p_user_agent: ctx.ua, p_metadata: {},
    });
    if (error) console.error('audit write failed:', error.message);
  } catch { console.error('audit write failed'); }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Method not allowed.');
  if (!WEB_URL) return fail(500, 'server_error', 'WEB_URL is not configured.');

  const ctx = clientCtx(req);
  try {
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    if (!token) return fail(401, 'unauthorized', 'Please sign in again.');
    const url = Deno.env.get('SUPABASE_URL')!;
    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });

    const { data: userData, error: userError } = await admin.auth.getUser(token);
    const caller = userData?.user;
    if (userError || !caller || !caller.email) return fail(401, 'unauthorized', 'Please sign in again.');

    const { data: roleRow, error: roleError } = await admin.from('user_roles').select('role').eq('user_id', caller.id).eq('role', 'admin').maybeSingle();
    if (roleError) throw roleError;
    if (!roleRow) return fail(403, 'forbidden', 'Only administrators can do this.');
    const sessionId = sessionIdFromJwt(token);
    if (!sessionId) return fail(401, 'unauthorized', 'Please sign in again.');
    const { data: vs, error: vsError } = await admin.from('verified_sessions').select('session_id').eq('session_id', sessionId).eq('user_id', caller.id).maybeSingle();
    if (vsError) throw vsError;
    if (!vs) return fail(403, 'unverified_session', 'Verify this device first.');

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return fail(400, 'bad_request', 'Invalid request.'); }
    const current = typeof body.current_password === 'string' ? body.current_password : '';
    const next = typeof body.new_password === 'string' ? body.new_password : '';
    if (!current || current.length > 200) return fail(400, 'invalid_password', 'Enter your current password.');
    const problem = passwordProblem(next);
    if (problem) return fail(400, 'weak_password', problem);
    if (next === current) return fail(400, 'same_password', 'Choose a password different from your current one.');

    const { data: allowed, error: rlError } = await admin.rpc('rate_limit_hit', { p_key: `pwchange:admin:${caller.id}`, p_limit: LIMIT.limit, p_window_seconds: LIMIT.windowSec });
    if (rlError) throw rlError;
    if (allowed !== true) return fail(429, 'rate_limited', 'Too many attempts. Please wait a few minutes and try again.');

    const verifier = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: pwError } = await verifier.auth.signInWithPassword({ email: caller.email, password: current });
    if (pwError) {
      await audit(admin, ctx, { actorId: caller.id, actorEmail: caller.email, action: 'password_confirm_failed', target: caller.email, success: false });
      if (pwError.status === 429) return fail(429, 'rate_limited', 'Too many attempts. Please wait a few minutes and try again.');
      return fail(400, 'invalid_password', 'Current password is incorrect.');
    }
    await verifier.auth.signOut().catch(() => {});

    const { error: updError } = await admin.auth.admin.updateUserById(caller.id, { password: next });
    if (updError) {
      if (updError.status === 422) return fail(400, 'weak_password', 'That password was rejected. Choose a stronger one.');
      throw updError;
    }

    const { error: revokeError } = await admin.rpc('admin_revoke_other_sessions', { p_user: caller.id, p_keep: sessionId });
    if (revokeError) console.error('revoke other sessions failed:', revokeError.message);

    await audit(admin, ctx, { actorId: caller.id, actorEmail: caller.email, action: 'password_changed', target: caller.email, success: true });
    return json(200, { ok: true });
  } catch (e) {
    console.error('admin-change-password failed:', e instanceof Error ? e.message : 'unknown');
    return fail(500, 'server_error', 'Something went wrong. Please try again.');
  }
});