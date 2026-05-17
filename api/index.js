// The Forge — Vercel Edge Function
// Runs on Vercel Edge Runtime (same as Netlify Edge Functions, both use Deno-compatible runtime)
export const config = { runtime: 'edge' };

export default async function handler(request) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/^\/api/, '');

  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
  const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY;

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Server misconfigured — check environment variables' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // ── AUTH ROUTES ───────────────────────────────────────────────
  if (path.startsWith('/auth/')) {
    const authPath = path.replace('/auth', '');
    const body = request.method !== 'GET' ? await request.text() : undefined;
    const res = await fetch(`${SUPABASE_URL}/auth/v1${authPath}`, {
      method: request.method,
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        ...(request.headers.get('Authorization') ? { 'Authorization': request.headers.get('Authorization') } : {}),
      },
      body,
    });
    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // ── VERIFY USER TOKEN ──────────────────────────────────────────
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  const userToken = authHeader.replace('Bearer ', '');
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { 'apikey': SUPABASE_ANON_KEY, 'Authorization': `Bearer ${userToken}` }
  });
  if (!userRes.ok) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }
  const user = await userRes.json();
  const userId = user.id;

  // ── GET /data ─────────────────────────────────────────────────
  if (path === '/data' && request.method === 'GET') {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/forge_data?user_id=eq.${userId}&select=state&limit=1`,
      { headers: { 'apikey': SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}` } }
    );
    const data = await res.json();
    return new Response(JSON.stringify(data?.[0]?.state || null), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // ── POST /data ────────────────────────────────────────────────
  if (path === '/data' && request.method === 'POST') {
    const body = await request.json();
    const res = await fetch(`${SUPABASE_URL}/rest/v1/forge_data`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({ user_id: userId, state: body, updated_at: new Date().toISOString() }),
    });
    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  return new Response(JSON.stringify({ error: 'Not found' }), {
    status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}
