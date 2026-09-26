// Mocks usados pelos testes: um "Supabase + Anthropic + Gemini + Resend" falso em memória,
// instalado no lugar do fetch global. Nenhuma chamada de rede real é feita.
const SUPA = 'https://riysxwgjsdltungeioji.supabase.co';

function criarMundo(opcoes) {
  const o = Object.assign({ rpc: true, colunaAux: true, colunaUnlimited: true, latenciaMs: 2 }, opcoes || {});
  const mundo = {
    ...o,
    usuarios: {},          // token -> user
    permissions: {},       // user_id -> { unlimited }
    uso: {},               // `${user}|${ym}` -> { roteiros_count, imagens_count, auxiliares_count }
    accessRequests: [],    // { user_id, email, requested_at }
    chamadas: { anthropic: [], gemini: [], resend: [], rpc: 0, legado: 0 },
    falharAnthropic: false,
    falharRpcCom500: false,
    falharInsertPedido: false,
    avisos: []
  };
  const dormir = () => new Promise(r => setTimeout(r, mundo.latenciaMs));
  const json = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });
  const linha = (u, ym) => (mundo.uso[`${u}|${ym}`] = mundo.uso[`${u}|${ym}`] || { roteiros_count: 0, imagens_count: 0, auxiliares_count: 0 });

  mundo.fetch = async (url, opts) => {
    opts = opts || {};
    const h = opts.headers || {};
    const body = opts.body ? JSON.parse(opts.body) : null;
    await dormir();
    const u = new URL(url);

    if (url.startsWith(`${SUPA}/auth/v1/user`)) {
      const token = String(h.Authorization || '').replace('Bearer ', '');
      const user = mundo.usuarios[token];
      return user ? json(200, user) : json(401, { msg: 'invalid JWT' });
    }
    if (u.pathname === '/rest/v1/permissions') {
      if (!mundo.colunaUnlimited) return json(400, { code: '42703', message: 'column permissions.unlimited does not exist' });
      const id = u.searchParams.get('user_id').replace('eq.', '');
      return json(200, mundo.permissions[id] ? [mundo.permissions[id]] : []);
    }
    if (u.pathname === '/rest/v1/rpc/consumir_uso') {
      mundo.chamadas.rpc++;
      if (!mundo.rpc) return json(404, { code: 'PGRST202', message: 'Could not find the function public.consumir_uso' });
      if (mundo.falharRpcCom500) return json(500, { code: 'XX000', message: 'boom' });
      // atômico: checa e incrementa sem nenhum await no meio (como o INSERT ... ON CONFLICT ... WHERE)
      const l = linha(body.p_user_id, body.p_year_month);
      if (l[body.p_campo] >= body.p_limite) return json(200, null);
      l[body.p_campo] += 1;
      return json(200, l[body.p_campo]);
    }
    if (u.pathname === '/rest/v1/rpc/estornar_uso') {
      if (!mundo.rpc) return json(404, { code: 'PGRST202', message: 'Could not find the function public.estornar_uso' });
      const l = linha(body.p_user_id, body.p_year_month);
      l[body.p_campo] = Math.max(0, l[body.p_campo] - 1);
      return json(200, l[body.p_campo]);
    }
    if (u.pathname === '/rest/v1/usage_monthly') {
      mundo.chamadas.legado++;
      if ((opts.method || 'GET') === 'GET') {
        const campo = u.searchParams.get('select');
        if (campo === 'auxiliares_count' && !mundo.colunaAux) return json(400, { code: '42703', message: 'column usage_monthly.auxiliares_count does not exist' });
        const id = u.searchParams.get('user_id').replace('eq.', '');
        const ym = u.searchParams.get('year_month').replace('eq.', '');
        const l = mundo.uso[`${id}|${ym}`];
        return json(200, l ? [{ [campo]: l[campo] }] : []);
      }
      for (const row of body) {
        const l = linha(row.user_id, row.year_month);
        for (const k of Object.keys(row)) if (k.endsWith('_count')) l[k] = row[k];
      }
      return json(201, null);
    }
    if (u.pathname === '/rest/v1/access_requests') {
      const token = String(h.Authorization || '').replace('Bearer ', '');
      const user = mundo.usuarios[token];
      if (!user) return json(401, { message: 'JWT inválido' });
      if ((opts.method || 'GET') === 'GET') {
        const desde = new Date(u.searchParams.get('requested_at').replace('gte.', ''));
        return json(200, mundo.accessRequests.filter(r => r.user_id === user.id && new Date(r.requested_at) >= desde).map(() => ({ id: 'x' })));
      }
      if (mundo.falharInsertPedido) return json(500, { message: 'erro' });
      if (body.user_id !== user.id) return json(403, { message: 'RLS' }); // policy "self insert"
      mundo.accessRequests.push({ user_id: body.user_id, email: body.email, requested_at: new Date().toISOString() });
      return json(201, null);
    }
    if (url.startsWith('https://api.anthropic.com/')) {
      mundo.chamadas.anthropic.push(body);
      if (mundo.falharAnthropic) return json(529, { error: { message: 'overloaded' } });
      return json(200, { content: [{ type: 'text', text: 'resposta' }] });
    }
    if (url.startsWith('https://generativelanguage.googleapis.com/')) {
      mundo.chamadas.gemini.push({ url, body });
      if (url.includes('image')) return json(200, { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'AAAA' } }] } }] });
      const itens = body.contents[0].parts[0].text.split('Textos:\n')[1].split('\n').map(l => l.replace(/^\d+\. /, '') + ' ✓');
      return json(200, { candidates: [{ content: { parts: [{ text: JSON.stringify({ items: itens }) }] } }] });
    }
    if (url.startsWith('https://api.resend.com/')) {
      mundo.chamadas.resend.push(body);
      return json(200, { id: 'email' });
    }
    throw new Error('fetch não mockado: ' + url);
  };
  return mundo;
}

function instalar(mundo) {
  global.fetch = mundo.fetch;
  console.warn = (...a) => mundo.avisos.push(a.join(' '));
  console.error = (...a) => mundo.avisos.push(a.join(' '));
}

function usuario(mundo, token, dados) {
  mundo.usuarios[token] = Object.assign({ id: 'id-' + token, email: token + '@exemplo.com', email_confirmed_at: '2026-01-01T00:00:00Z' }, dados || {});
  return mundo.usuarios[token];
}

// req/res no formato das funções da Vercel
function req(token, body) {
  return { method: 'POST', headers: token ? { authorization: `Bearer ${token}` } : {}, body };
}
function res() {
  const r = { statusCode: null, body: null };
  r.status = (c) => { r.statusCode = c; return r; };
  r.json = (b) => { r.body = b; return r; };
  return r;
}
async function chamar(handler, token, body) {
  const out = res();
  await handler(req(token, body), out);
  return out;
}

function usoDe(mundo, userId) {
  const { mesAtual } = require('../lib/usage');
  return mundo.uso[`${userId}|${mesAtual()}`] || { roteiros_count: 0, imagens_count: 0, auxiliares_count: 0 };
}

process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-de-teste';
process.env.ANTHROPIC_API_KEY = 'chave-falsa';
process.env.GEMINI_API_KEY = 'chave-falsa';

module.exports = { criarMundo, instalar, usuario, chamar, usoDe };
