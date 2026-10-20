// KiloWhat · admin-activate
// Public on purpose: the invitee has no account yet. Safety comes from the
// token: 256-bit random, single-use, short-lived, stored only as a hash.
//
// Deploy:  supabase functions deploy admin-activate --no-verify-jwt
// Secrets: WEB_URL (same as admin-invite)
//
// Body: { action: "check", token }  -> { valid, email }   (masked email)
//       { action: "activate", token, password } -> { ok }

import { createClient } from 'npm:@supabase/supabase-js@2';

const WEB_URL = (Deno.env.get('WEB_URL') ?? '').replace(/\/+$/, '');
const cors = {
  'Access-Control-Allow-Origin': WEB_URL || 'null',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Vary': 'Origin',
};
function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } });
}
const fail = (status: number, code: string, message: string) => json(status, { code, message });

async function sha256Hex(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Same rules as the mobile app.
function passwordProblem(p: string): string | null {
  if (p.length < 8) return 'Use at least 8 characters.';
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

const INVALID = () => fail(410, 'invalid_link', 'This invitation link is invalid or has expired. Ask an administrator to send a new one.');

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors });
  if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Method not allowed.');

  try {
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return fail(400, 'bad_request', 'Invalid request.'); }
    const action = body.action;
    const rawToken = typeof body.token === 'string' ? body.token : '';
    if ((action !== 'check' && action !== 'activate') || rawToken.length < 20 || rawToken.length > 100) return INVALID();

    const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    await admin.rpc('purge_expired_admin_invites'); // expired accounts are deleted right here too

    const { data: inv, error: invError } = await admin
      .from('admin_invites')
      .select('id, user_id, expires_at, activated_at')
      .eq('token_hash', await sha256Hex(rawToken))
      .maybeSingle();
    if (invError) throw invError;
    if (!inv || inv.activated_at || Date.parse(inv.expires_at) <= Date.now()) return INVALID();

    if (action === 'check') {
      const { data: u } = await admin.auth.admin.getUserById(inv.user_id);
      return json(200, { valid: true, email: maskEmail(u?.user?.email ?? '??@??') });
    }

    // ---- activate
    const password = typeof body.password === 'string' ? body.password : '';
    const problem = passwordProblem(password);
    if (problem) return fail(400, 'weak_password', problem);

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

    return json(200, { ok: true });
  } catch (err) {
    console.error('admin-activate error:', err instanceof Error ? err.message : 'unknown');
    return fail(500, 'server_error', 'Something went wrong. Please try again.');
  }
});