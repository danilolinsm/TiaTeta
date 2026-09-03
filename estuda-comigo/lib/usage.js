// Lógica compartilhada de autenticação e controle de uso mensal (roteiros/imagens).
// Usado por api/claude.js e api/image.js — nunca é exposto como rota própria.

const SUPABASE_URL = 'https://riysxwgjsdltungeioji.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpeXN4d2dqc2RsdHVuZ2Vpb2ppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MzEzNzAsImV4cCI6MjEwMzQwNzM3MH0.IONaLD45l6s_0FZqTZ2gh0pCPJtmXEejYOtTilCqUHA';

const LIMITE_ROTEIROS = 10;
const LIMITE_IMAGENS = 100;

// Descobre quem está chamando a partir do token de login enviado pelo frontend.
// Retorna null se não estiver logado ou o token for inválido.
async function getAuthenticatedUser(req) {
  const authHeader = req.headers.authorization || '';
  const token = authHeader.replace('Bearer ', '').trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  const me = await r.json();
  if (!me || !me.id) return null;
  return me;
}

function mesAtual() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function getUsage(userId) {
  const ym = mesAtual();
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/usage_monthly?user_id=eq.${userId}&year_month=eq.${ym}&select=roteiros_count,imagens_count`,
    { headers: { apikey: process.env.SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}` } }
  );
  const rows = await r.json();
  const row = Array.isArray(rows) && rows[0];
  return { roteiros_count: row ? row.roteiros_count : 0, imagens_count: row ? row.imagens_count : 0 };
}

async function incrementUsage(userId, campo) {
  const ym = mesAtual();
  const atual = await getUsage(userId);
  const novoValor = atual[campo] + 1;
  await fetch(`${SUPABASE_URL}/rest/v1/usage_monthly?on_conflict=user_id,year_month`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates'
    },
    body: JSON.stringify([{ user_id: userId, year_month: ym, [campo]: novoValor }])
  });
}

module.exports = { getAuthenticatedUser, getUsage, incrementUsage, LIMITE_ROTEIROS, LIMITE_IMAGENS };