// Lista os usuários cadastrados no Supabase — acesso restrito a quem estiver em ADMIN_EMAILS.
// Usa a service_role key do Supabase, que NUNCA é exposta ao navegador (fica só aqui, no servidor).
const SUPABASE_URL = 'https://riysxwgjsdltungeioji.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpeXN4d2dqc2RsdHVuZ2Vpb2ppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MzEzNzAsImV4cCI6MjEwMzQwNzM3MH0.IONaLD45l6s_0FZqTZ2gh0pCPJtmXEejYOtTilCqUHA';

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.replace('Bearer ', '').trim();
    if (!token) { res.status(401).json({ error: 'Não autenticado' }); return; }

    // 1. Descobre quem está pedindo (usando o token da sessão de quem chamou)
    const meRes = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
      headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
    });
    const me = await meRes.json();
    if (!me || !me.email) { res.status(401).json({ error: 'Sessão inválida' }); return; }

    // 2. Confere se esse email está na lista de administradores
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
    if (!adminEmails.includes(me.email.toLowerCase())) {
      res.status(403).json({ error: 'Acesso restrito ao administrador' });
      return;
    }

    // 3. Lista os usuários usando a service_role key (secreta, só no servidor)
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      res.status(500).json({ error: 'SUPABASE_SERVICE_ROLE_KEY não configurada no servidor' });
      return;
    }
    const usersRes = await fetch(`${SUPABASE_URL}/auth/v1/admin/users?per_page=200`, {
      headers: {
        apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`
      }
    });
    const data = await usersRes.json();
    if (!usersRes.ok || !data.users) {
      res.status(500).json({ error: data.msg || data.error || 'Erro ao listar usuários' });
      return;
    }

    const users = data.users.map(u => ({
      id: u.id,
      email: u.email,
      created_at: u.created_at,
      last_sign_in_at: u.last_sign_in_at,
      email_confirmed_at: u.email_confirmed_at,
      role: (u.user_metadata && u.user_metadata.role) || null,
      full_name: (u.user_metadata && u.user_metadata.full_name) || null
    }));
    res.status(200).json({ users });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
