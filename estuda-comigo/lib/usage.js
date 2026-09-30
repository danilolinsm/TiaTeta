// Lógica compartilhada de autenticação e controle de uso mensal de IA.
// Usado por api/claude.js, api/image.js e api/proofread.js — nunca é exposto como rota própria.
//
// Sequência de todo endpoint de IA:
//   1. auth no servidor (getAuthenticatedUser)
//   2. checagem de uso = reservarUso(): checa o limite E já conta, numa única operação atômica
//      no Postgres (RPC consumir_uso, migration 007). Assim, chamadas em paralelo não passam do limite.
//   3. geração
//   4. incremento: já foi feito na reserva; se a geração FALHAR, estornarUso() devolve a unidade
//      (mesmo efeito do antigo "só incrementa se deu certo").
//
// A categoria é SEMPRE decidida pelo servidor (rota/operação validada) — nada vindo do cliente
// consegue fazer uma chamada "não contar".

const SUPABASE_URL = 'https://riysxwgjsdltungeioji.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJpeXN4d2dqc2RsdHVuZ2Vpb2ppIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODc4MzEzNzAsImV4cCI6MjEwMzQwNzM3MH0.IONaLD45l6s_0FZqTZ2gh0pCPJtmXEejYOtTilCqUHA';

// ===== Limites mensais por conta (mude aqui) =====
const LIMITE_ROTEIROS = 10;    // gerar e regenerar roteiro (resumo/mapa)
const LIMITE_IMAGENS = 100;    // pôster e ilustração de questões (Gemini imagem)
const LIMITE_AUXILIARES = 100; // dicas, verificação de imagem, revisão de texto, questões extras

// categoria -> coluna em usage_monthly + limite
const CATEGORIAS = {
  roteiros:   { campo: 'roteiros_count',   limite: LIMITE_ROTEIROS,   nome: 'roteiros' },
  imagens:    { campo: 'imagens_count',    limite: LIMITE_IMAGENS,    nome: 'imagens' },
  auxiliares: { campo: 'auxiliares_count', limite: LIMITE_AUXILIARES, nome: 'usos de apoio (dicas, revisões e questões extras)' }
};

// Contas ilimitadas também são contadas (para acompanhar custo), só não são barradas.
const SEM_LIMITE = 2147483647;

// Códigos do PostgREST/Postgres que indicam "o schema ainda não tem isso" (migration não aplicada)
const FUNCAO_INEXISTENTE = new Set(['PGRST202', '42883']);
const COLUNA_INEXISTENTE = new Set(['42703', 'PGRST204']);

function svcHeaders(extra) {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...(extra || {}) };
}

// Erro "esperado" que o endpoint devolve como HTTP (429, 503...)
class UsageError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

// Descobre quem está chamando a partir do token de login enviado pelo frontend.
// Retorna null se não estiver logado ou o token for inválido.
async function getAuthenticatedUser(req) {
  const authHeader = (req.headers && (req.headers.authorization || req.headers.Authorization)) || '';
  const token = String(authHeader).replace(/^Bearer\s+/i, '').trim();
  if (!token) return null;
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` }
  });
  if (!r.ok) return null;
  const me = await r.json().catch(() => null);
  if (!me || !me.id) return null;
  return me;
}

function adminEmails() {
  return (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim().toLowerCase()).filter(Boolean);
}

// Admin = email em ADMIN_EMAILS E confirmado (evita alguém cadastrar um email de admin ainda sem conta).
function isAdminUser(me) {
  if (!me || !me.email) return false;
  const confirmado = !!(me.email_confirmed_at || me.confirmed_at);
  return confirmado && adminEmails().includes(String(me.email).toLowerCase());
}

async function lerErro(r) {
  const txt = await r.text().catch(() => '');
  try { return JSON.parse(txt); } catch (e) { return { message: txt }; }
}

// permissions.unlimited (migration 006). Se a coluna ainda não existir, trata como "com limite".
async function isUnlimited(me) {
  if (isAdminUser(me)) return true;
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/permissions?user_id=eq.${encodeURIComponent(me.id)}&select=unlimited`,
    { headers: svcHeaders() }
  );
  if (!r.ok) {
    const err = await lerErro(r);
    if (COLUNA_INEXISTENTE.has(err.code)) {
      console.warn('[usage] coluna permissions.unlimited não existe — aplique a migration 006. Tratando como conta com limite.');
      return false;
    }
    throw new UsageError(503, 'Não consegui verificar seu plano agora. Tente de novo em instantes.');
  }
  const rows = await r.json().catch(() => []);
  return !!(Array.isArray(rows) && rows[0] && rows[0].unlimited === true);
}

function mesAtual() {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function chamarRpc(nome, args) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nome}`, {
    method: 'POST', headers: svcHeaders(), body: JSON.stringify(args)
  });
  if (!r.ok) return { ok: false, err: await lerErro(r) };
  const txt = await r.text();
  return { ok: true, data: txt ? JSON.parse(txt) : null };
}

// ---------- caminho antigo (ler e gravar), usado só se a RPC ainda não existir ----------
// NÃO é atômico: duas chamadas simultâneas podem passar do limite por 1-2 unidades.
async function lerContagem(userId, campo, ym) {
  const r = await fetch(
    `${SUPABASE_URL}/rest/v1/usage_monthly?user_id=eq.${encodeURIComponent(userId)}&year_month=eq.${ym}&select=${campo}`,
    { headers: svcHeaders() }
  );
  if (!r.ok) {
    const err = await lerErro(r);
    const e = new UsageError(503, 'Não consegui verificar seu uso agora. Tente de novo em instantes.');
    e.code = err.code;
    throw e;
  }
  const rows = await r.json();
  const row = Array.isArray(rows) && rows[0];
  return row ? (row[campo] || 0) : 0;
}

async function gravarContagem(userId, campo, ym, valor) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/usage_monthly?on_conflict=user_id,year_month`, {
    method: 'POST',
    headers: svcHeaders({ Prefer: 'resolution=merge-duplicates' }),
    // updated_at existe em produção (timestamptz default now()), mas não há trigger: atualiza aqui.
    body: JSON.stringify([{ user_id: userId, year_month: ym, [campo]: valor, updated_at: new Date().toISOString() }])
  });
  if (!r.ok) {
    const err = await lerErro(r);
    const e = new UsageError(503, 'Não consegui registrar seu uso agora. Tente de novo em instantes.');
    e.code = err.code;
    throw e;
  }
}

async function reservarLegado(userId, cat, limite, ym) {
  let atual;
  try {
    atual = await lerContagem(userId, cat.campo, ym);
  } catch (e) {
    if (COLUNA_INEXISTENTE.has(e.code) && cat.campo === 'auxiliares_count') {
      // Antes da migration 007 não existe onde contar usos de apoio. Deixa passar SEM contar
      // (é exatamente o comportamento de produção de hoje) e avisa no log. Roteiros e imagens seguem barrados.
      console.warn('[usage] coluna usage_monthly.auxiliares_count não existe — aplique a migration 007. Uso de apoio liberado sem contagem.');
      return { contado: false };
    }
    throw e;
  }
  if (atual >= limite) return null;
  await gravarContagem(userId, cat.campo, ym, atual + 1);
  return { contado: true, legado: true };
}

// Reserva 1 unidade da categoria. Lança UsageError(429) se estourou o limite.
// Devolve um "ticket" para estornar se a geração falhar.
async function reservarUso(me, categoria) {
  const cat = CATEGORIAS[categoria];
  if (!cat) throw new Error(`categoria de uso desconhecida: ${categoria}`); // bug de programação, não do cliente
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new UsageError(500, 'SUPABASE_SERVICE_ROLE_KEY não configurada no servidor');
  }
  const ilimitado = await isUnlimited(me);
  const limite = ilimitado ? SEM_LIMITE : cat.limite;
  const ym = mesAtual();
  const ticket = { userId: me.id, categoria, campo: cat.campo, ym, ilimitado, contado: false, legado: false };

  const rpc = await chamarRpc('consumir_uso', { p_user_id: me.id, p_campo: cat.campo, p_limite: limite, p_year_month: ym });
  if (rpc.ok) {
    if (rpc.data === null || rpc.data === undefined) {
      throw new UsageError(429, `Vocês atingiram o limite de ${cat.limite} ${cat.nome} este mês. O limite renova no início do próximo mês.`);
    }
    ticket.contado = true;
    return ticket;
  }

  if (FUNCAO_INEXISTENTE.has(rpc.err && rpc.err.code)) {
    console.warn('[usage] RPC consumir_uso não existe — aplique a migration 007. Usando caminho antigo (ler e gravar, não atômico).');
    try {
      const res = await reservarLegado(me.id, cat, limite, ym);
      if (res === null) {
        throw new UsageError(429, `Vocês atingiram o limite de ${cat.limite} ${cat.nome} este mês. O limite renova no início do próximo mês.`);
      }
      ticket.contado = res.contado;
      ticket.legado = !!res.legado;
      return ticket;
    } catch (e) {
      if (ilimitado && e.status === 503) {
        // conta ilimitada: falha só na contagem, não precisa barrar
        console.warn('[usage] falha ao contar uso de conta ilimitada:', e.message);
        return ticket;
      }
      throw e;
    }
  }

  console.error('[usage] erro inesperado na RPC consumir_uso:', JSON.stringify(rpc.err));
  if (ilimitado) return ticket; // não barra conta ilimitada por falha de contagem
  // falha fechada: sem conseguir contar, não gera (evita uso sem limite)
  throw new UsageError(503, 'Não consegui verificar seu limite de uso agora. Tente de novo em instantes.');
}

// Devolve a unidade reservada quando a geração falha. Nunca lança erro.
async function estornarUso(ticket) {
  if (!ticket || !ticket.contado) return;
  try {
    if (!ticket.legado) {
      const rpc = await chamarRpc('estornar_uso', { p_user_id: ticket.userId, p_campo: ticket.campo, p_year_month: ticket.ym });
      if (rpc.ok) return;
      if (!FUNCAO_INEXISTENTE.has(rpc.err && rpc.err.code)) {
        console.error('[usage] erro ao estornar uso:', JSON.stringify(rpc.err));
        return;
      }
    }
    const atual = await lerContagem(ticket.userId, ticket.campo, ticket.ym);
    if (atual > 0) await gravarContagem(ticket.userId, ticket.campo, ticket.ym, atual - 1);
  } catch (e) {
    console.error('[usage] erro ao estornar uso:', e.message);
  } finally {
    ticket.contado = false;
  }
}

// Leitura simples (para telas/relatórios). Colunas ausentes contam como 0.
async function getUsage(userId) {
  const ym = mesAtual();
  const out = {};
  for (const cat of Object.values(CATEGORIAS)) {
    try { out[cat.campo] = await lerContagem(userId, cat.campo, ym); } catch (e) { out[cat.campo] = 0; }
  }
  return out;
}

module.exports = {
  getAuthenticatedUser, isAdminUser, isUnlimited, reservarUso, estornarUso, getUsage, mesAtual,
  UsageError, CATEGORIAS, LIMITE_ROTEIROS, LIMITE_IMAGENS, LIMITE_AUXILIARES, SUPABASE_URL, SUPABASE_ANON_KEY
};
