// Registra o pedido de acesso à geração de imagens (tabela access_requests) e avisa o(s)
// administrador(es) por email. O email é "melhor esforço": se falhar, o pedido já está salvo
// e aparece no painel de administrador de qualquer forma.
//
// Proteção contra abuso (Vercel serverless: memória do processo NÃO é confiável entre chamadas,
// cada instância tem a sua e ela some a qualquer momento — então o limite fica no banco):
//   1. Exige login: o email do aviso vem do token verificado no servidor, não do corpo do pedido.
//      Ninguém anônimo dispara email, e não dá pra se passar por outra pessoa.
//   2. Limite por usuário usando a tabela access_requests que JÁ existe (migration 002), sem tabela nova:
//      esta rota conta os pedidos da pessoa nas últimas 24h e, se ainda estiver abaixo do limite, ELA MESMA
//      grava o pedido e só então envia o email. Cada chamada que envia email grava uma linha, então repetir
//      a chamada esgota o limite. O usuário só pode inserir/ler os próprios pedidos (sem UPDATE/DELETE
//      pelas policies da 002), logo não consegue "zerar" a contagem.
//      Tudo com o token do próprio usuário (RLS), sem service_role nesta rota.
//   3. Honeypot: campo `website` que humanos nunca preenchem; se vier preenchido, responde ok sem fazer nada.
//   4. Validação de entrada e escape de tudo que vai para o HTML do email.
// Se a checagem de limite falhar (Supabase fora do ar), não grava nem envia (falha fechada) e devolve 503.
// chave anon pública do Supabase (a mesma do frontend) — reaproveitada de lib/usage.js
const { getAuthenticatedUser, SUPABASE_URL, SUPABASE_ANON_KEY } = require('../lib/usage');

const MAX_PEDIDOS_POR_DIA = 3;  // pedidos (e emails) por usuário a cada 24h
const MAX_NOME = 100;
const MAX_EMAIL = 254;
const EMAIL_RE = /^[^\s@<>"'()\\,;:]+@[^\s@<>"'()\\,;:]+\.[^\s@<>"'()\\,;:]{2,}$/;

function escapeHtml(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// remove caracteres de controle (inclui quebras de linha) e espaços repetidos
function limparTexto(s) {
  return String(s).replace(/[\u0000-\u001F\u007F]/g, ' ').replace(/\s+/g, ' ').trim();
}

function validarEntrada(body, me) {
  const email = String(me.email || '').trim();
  if (!email || email.length > MAX_EMAIL || !EMAIL_RE.test(email)) {
    return { erro: 'Email da conta inválido.' };
  }
  let nome = '';
  if (body.name !== undefined && body.name !== null) {
    if (typeof body.name !== 'string') return { erro: 'name deve ser texto.' };
    nome = limparTexto(body.name);
    if (nome.length > MAX_NOME) return { erro: `name deve ter até ${MAX_NOME} caracteres.` };
  }
  if (body.email !== undefined && body.email !== null && body.email !== '') {
    if (typeof body.email !== 'string' || body.email.length > MAX_EMAIL || !EMAIL_RE.test(body.email.trim())) {
      return { erro: 'email inválido.' };
    }
  }
  return { email, nome };
}

function tokenDo(req) {
  const h = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  return String(h).replace(/^Bearer\s+/i, '').trim();
}

// Consultas com o token do usuário: o RLS garante que ele só vê/insere os próprios pedidos.
function userHeaders(token, extra) {
  return { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(extra || {}) };
}

async function pedidosNasUltimas24h(token, userId) {
  const desde = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/access_requests?user_id=eq.${encodeURIComponent(userId)}&requested_at=gte.${encodeURIComponent(desde)}&select=id`,
    { headers: userHeaders(token) }
  );
  if (!r.ok) throw new Error(`falha ao consultar access_requests (${r.status})`);
  const rows = await r.json();
  return Array.isArray(rows) ? rows.length : 0;
}

async function gravarPedido(token, userId, email) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/access_requests`, {
    method: 'POST',
    headers: userHeaders(token, { Prefer: 'return=minimal' }),
    body: JSON.stringify({ user_id: userId, email })
  });
  if (!r.ok) throw new Error(`falha ao gravar pedido (${r.status})`);
}

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  let salvo = false;
  try {
    const body = (req.body && typeof req.body === 'object') ? req.body : {};

    const me = await getAuthenticatedUser(req);
    if (!me) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }

    // honeypot: finge sucesso para não ensinar o robô
    if (body.website) {
      res.status(200).json({ ok: true });
      return;
    }

    const v = validarEntrada(body, me);
    if (v.erro) {
      res.status(400).json({ error: v.erro });
      return;
    }

    const token = tokenDo(req);
    let recentes;
    try {
      recentes = await pedidosNasUltimas24h(token, me.id);
    } catch (e) {
      console.warn('[request-access] não consegui checar o limite:', e.message);
      res.status(503).json({ error: 'Não consegui registrar o pedido agora. Tente de novo em instantes.' });
      return;
    }
    if (recentes >= MAX_PEDIDOS_POR_DIA) {
      res.status(429).json({ error: 'Seu pedido já foi registrado. Aguarde a análise do administrador.' });
      return;
    }
    try {
      await gravarPedido(token, me.id, v.email);
      salvo = true;
    } catch (e) {
      console.warn('[request-access]', e.message);
      res.status(503).json({ error: 'Não consegui registrar o pedido agora. Tente de novo em instantes.' });
      return;
    }

    // pedido salvo. Daqui pra baixo é só o aviso por email (melhor esforço).
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);
    if (!adminEmails.length) {
      res.status(200).json({ ok: true, note: 'ADMIN_EMAILS não configurado — pedido salvo, mas sem email enviado' });
      return;
    }
    if (!process.env.RESEND_API_KEY) {
      res.status(200).json({ ok: true, note: 'RESEND_API_KEY não configurado — pedido salvo, mas sem email enviado' });
      return;
    }

    const nomeHtml = escapeHtml(v.nome || v.email);
    const emailHtml = escapeHtml(v.email);
    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Tia Teta <onboarding@resend.dev>',
        to: adminEmails,
        subject: 'Novo pedido de acesso à geração de imagens — Tia Teta',
        html: `<p>O usuário <strong>${nomeHtml}</strong> (${emailHtml}) pediu acesso para gerar imagens (pôster ilustrado e ilustração das questões) no app Tia Teta.</p><p>Acesse o painel de administrador do app (ícone 👤 → Área do administrador) para aprovar.</p>`
      })
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    // só chega aqui por falha inesperada (ex.: email). Se o pedido já foi salvo, o admin vê no painel.
    console.warn('[request-access] falha inesperada:', e.message);
    if (salvo) res.status(200).json({ ok: true, note: 'pedido salvo; falha ao enviar email' });
    else res.status(500).json({ error: 'Não consegui registrar o pedido agora. Tente de novo.' });
  }
};

module.exports.escapeHtml = escapeHtml;
module.exports.validarEntrada = validarEntrada;
