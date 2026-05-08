// ════════════════════════════════════════════════════════════════
// Forge API — Netlify Edge Function
// Acts as a proxy between the app and Supabase.
// The SUPABASE_SERVICE_KEY never leaves this server.
// ════════════════════════════════════════════════════════════════

export default async (request, context) => {
  const url = new URL(request.url);
  const path = url.pathname.replace('/api', '');

  // CORS headers for the PWA
  const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Environment variables — set these in Netlify dashboard
  const SUPABASE_URL = Deno.env.get('SUPABASE_URL');
  const SUPABASE_SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_KEY');
  const SUPABASE_ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY');

  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // ── AUTH ROUTES (use anon key, handled by Supabase Auth) ──────
  if (path.startsWith('/auth/')) {
    const authPath = path.replace('/auth', '');
    const body = request.method !== 'GET' ? await request.text() : undefined;

    const res = await fetch(`${SUPABASE_URL}/auth/v1${authPath}`, {
      method: request.method,
      headers: {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json',
        ...(request.headers.get('Authorization') ? {
          'Authorization': request.headers.get('Authorization')
        } : {}),
      },
      body,
    });

    const data = await res.text();
    return new Response(data, {
      status: res.status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // ── DATA ROUTES (use service key — bypasses RLS, we enforce auth manually) ─
  // Verify the user's JWT before touching data
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const userToken = authHeader.replace('Bearer ', '');

  // Verify token by calling Supabase auth
  const userRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${userToken}`,
    }
  });

  if (!userRes.ok) {
    return new Response(JSON.stringify({ error: 'Invalid token' }), {
      status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  const user = await userRes.json();
  const userId = user.id;

  // ── GET /data — pull user's forge state ───────────────────────
  if (path === '/data' && request.method === 'GET') {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/forge_data?user_id=eq.${userId}&select=state&limit=1`,
      {
        headers: {
          'apikey': SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${SUPABASE_SERVICE_KEY}`,
        }
      }
    );
    const data = await res.json();
    return new Response(JSON.stringify(data?.[0]?.state || null), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  }

  // ── POST /data — push forge state ──────────────────────────────
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
      body: JSON.stringify({
        user_id: userId,
        state: body,
        updated_at: new Date().toISOString(),
      }),
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
};

export const config = { path: '/api/*' };
