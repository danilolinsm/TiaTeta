// Lista permissões + pedidos de acesso pendentes, e permite ao admin
// habilitar/desabilitar a geração de imagens por usuário.
// Protegido: só quem estiver em ADMIN_EMAILS consegue usar.
const SUPABASE_URL = 'https://riysxwgjsdltungeioji.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpeXN4d2dqc2RsdHVuZ2Vpb2ppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MzEzNzAsImV4cCI6MjEwMzQwNzM3MH0.IONaLD45l6s_0FZqTZ2gh0pCPJtmXEejYOtTilCqUHA';

async function requireAdmin(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return { ok: false, status: 401, error: 'Não autenticado' };

  const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  const me = await meRes.json();
  if (!me || !me.email) return { ok: false, status: 401, error: 'Sessão inválida' };

  const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
  if (!adminEmails.includes(me.email.toLowerCase())) {
    return { ok: false, status: 403, error: 'Acesso restrito ao administrador' };
  }
  return { ok: true, me };
}

module.exports = async function handler(req, res) {
  const auth = await requireAdmin(req);
  if (!auth.ok) { res.status(auth.status).json({ error: auth.error }); return; }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada no servidor' });
    return;
  }
  const svcHeaders = {
    apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json'
  };

  try {
    if (req.method === 'GET') {
      const [permRes, reqRes] = await Promise.all([
        fetch(`${SUPABASE_URL}/rest/v1/permissions?select=*`, { headers: svcHeaders }),
        fetch(`${SUPABASE_URL}/rest/v1/access_requests?select=*&status=eq.pending&order=requested_at.desc`, { headers: svcHeaders })
      ]);
      const permissions = await permRes.json();
      const requests = await reqRes.json();
      res.status(200).json({ permissions, requests });
      return;
    }

    if (req.method === 'POST') {
      const { action, user_id, value, request_id } = req.body || {};

      if (action === 'toggle') {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/permissions`, {
          method: 'POST',
          headers: { ...svcHeaders, Prefer: 'resolution=merge-duplicates,return=representation' },
          body: JSON.stringify({ user_id, can_generate_images: !!value, updated_at: new Date().toISOString() })
        });
        if (!r.ok) { res.status(500).json({ error: await r.text() }); return; }
        res.status(200).json({ ok: true });
        return;
      }

      if (action === 'resolve_request') {
        const r = await fetch(`${SUPABASE_URL}/rest/v1/access_requests?id=eq.${request_id}`, {
          method: 'PATCH',
          headers: svcHeaders,
          body: JSON.stringify({ status: 'approved' })
        });
        if (!r.ok) { res.status(500).json({ error: await r.text() }); return; }
        res.status(200).json({ ok: true });
        return;
      }

      res.status(400).json({ error: 'ação desconhecida' });
      return;
    }

    res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
