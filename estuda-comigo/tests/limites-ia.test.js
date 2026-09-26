// Limites de uso de IA no servidor: api/claude.js, api/image.js, api/proofread.js e lib/usage.js.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { criarMundo, instalar, usuario, chamar, usoDe } = require('./helpers');
const claude = require('../api/claude');
const image = require('../api/image');
const proofread = require('../api/proofread');
const { LIMITE_ROTEIROS, LIMITE_IMAGENS, LIMITE_AUXILIARES } = require('../lib/usage');

let m;
beforeEach(() => { m = criarMundo(); instalar(m); process.env.ADMIN_EMAILS = 'admin@exemplo.com'; });

const roteiro = { operacao: 'roteiro', prompt: 'gere um roteiro' };

test('roteiro conta e, no limite, devolve 429 sem chamar a Anthropic', async () => {
  const u = usuario(m, 'ana');
  for (let i = 0; i < LIMITE_ROTEIROS; i++) {
    assert.equal((await chamar(claude, 'ana', roteiro)).statusCode, 200);
  }
  assert.equal(usoDe(m, u.id).roteiros_count, LIMITE_ROTEIROS);
  const r = await chamar(claude, 'ana', roteiro);
  assert.equal(r.statusCode, 429);
  assert.match(r.body.error, /limite de 10 roteiros/);
  assert.equal(m.chamadas.anthropic.length, LIMITE_ROTEIROS);
});

test('regenerar roteiro conta no limite de roteiros', async () => {
  const u = usuario(m, 'ana');
  await chamar(claude, 'ana', { operacao: 'regenerar_roteiro', prompt: 'refaça' });
  assert.equal(usoDe(m, u.id).roteiros_count, 1);
});

test('dica, verificação, questões extras e proofread contam em "auxiliares", com limite próprio', async () => {
  const u = usuario(m, 'ana');
  await chamar(claude, 'ana', { operacao: 'dica', prompt: 'dica' });
  await chamar(claude, 'ana', { operacao: 'verificar_imagem', prompt: 'ok?', images: [{ base64: 'AAAA', mediaType: 'image/jpeg' }] });
  await chamar(claude, 'ana', { operacao: 'regenerar_questao', prompt: 'nova questão' });
  await chamar(claude, 'ana', { operacao: 'questoes_foco', prompt: 'questões' });
  await chamar(proofread, 'ana', { items: ['texto'] });
  assert.deepEqual(usoDe(m, u.id), { roteiros_count: 0, imagens_count: 0, auxiliares_count: 5 });
  m.uso[Object.keys(m.uso)[0]].auxiliares_count = LIMITE_AUXILIARES;
  assert.equal((await chamar(claude, 'ana', { operacao: 'dica', prompt: 'dica' })).statusCode, 429);
  assert.equal((await chamar(proofread, 'ana', { items: ['texto'] })).statusCode, 429);
});

test('cada operação usa o max_tokens definido no servidor (disfarçar roteiro de dica não compensa)', async () => {
  usuario(m, 'ana');
  await chamar(claude, 'ana', { operacao: 'dica', prompt: 'gere um roteiro completo com 30 questões' });
  assert.equal(m.chamadas.anthropic[0].max_tokens, 400);
});

test('kind/operação ausente, forjada ou herdada de Object.prototype => 400 e nada é gerado', async () => {
  usuario(m, 'ana');
  for (const body of [
    { prompt: 'x' },
    { prompt: 'x', kind: 'nao_conta' },
    { prompt: 'x', operacao: 'gratis' },
    { prompt: 'x', operacao: '__proto__' },
    { prompt: 'x', operacao: 'toString' },
    { prompt: 'x', operacao: ['roteiro'] },
    { prompt: 'x', operacao: '' }
  ]) {
    const r = await chamar(claude, 'ana', body);
    assert.equal(r.statusCode, 400, JSON.stringify(body));
  }
  assert.equal(m.chamadas.anthropic.length, 0);
  assert.equal(m.chamadas.rpc, 0);
});

test('frontend antigo (kind:"roteiro") continua funcionando e conta como roteiro', async () => {
  const u = usuario(m, 'ana');
  assert.equal((await chamar(claude, 'ana', { kind: 'roteiro', prompt: 'x' })).statusCode, 200);
  assert.equal(usoDe(m, u.id).roteiros_count, 1);
});

test('arquivos fora do permitido pela operação => 400', async () => {
  usuario(m, 'ana');
  assert.equal((await chamar(claude, 'ana', { operacao: 'dica', prompt: 'x', images: [{ base64: 'A' }] })).statusCode, 400);
  assert.equal((await chamar(claude, 'ana', { operacao: 'verificar_imagem', prompt: 'x' })).statusCode, 400);
  assert.equal((await chamar(claude, 'ana', { operacao: 'verificar_imagem', prompt: 'x', images: [{ base64: 'A', isPdf: true }] })).statusCode, 400);
  assert.equal(m.chamadas.anthropic.length, 0);
});

test('conta com permissions.unlimited passa do limite (e continua sendo contada)', async () => {
  const u = usuario(m, 'vip');
  m.permissions[u.id] = { unlimited: true };
  for (let i = 0; i < LIMITE_ROTEIROS + 3; i++) {
    assert.equal((await chamar(claude, 'vip', roteiro)).statusCode, 200);
  }
  assert.equal(usoDe(m, u.id).roteiros_count, LIMITE_ROTEIROS + 3);
});

test('admin (ADMIN_EMAILS, email confirmado) passa do limite; email de admin NÃO confirmado não', async () => {
  usuario(m, 'adm', { email: 'Admin@Exemplo.com' });
  for (let i = 0; i < LIMITE_ROTEIROS + 2; i++) {
    assert.equal((await chamar(claude, 'adm', roteiro)).statusCode, 200);
  }
  m.usuarios.adm.email_confirmed_at = null;
  assert.equal((await chamar(claude, 'adm', roteiro)).statusCode, 429);
});

test('chamadas paralelas não passam do limite (RPC atômica)', async () => {
  const u = usuario(m, 'ana');
  const resultados = await Promise.all(Array.from({ length: 30 }, () => chamar(claude, 'ana', roteiro)));
  const ok = resultados.filter(r => r.statusCode === 200).length;
  const barradas = resultados.filter(r => r.statusCode === 429).length;
  assert.equal(ok, LIMITE_ROTEIROS);
  assert.equal(barradas, 30 - LIMITE_ROTEIROS);
  assert.equal(m.chamadas.anthropic.length, LIMITE_ROTEIROS);
  assert.equal(usoDe(m, u.id).roteiros_count, LIMITE_ROTEIROS);
});

test('imagens em paralelo também respeitam o limite de 100', async () => {
  usuario(m, 'ana');
  const rs = await Promise.all(Array.from({ length: LIMITE_IMAGENS + 20 }, () => chamar(image, 'ana', { prompt: 'pôster' })));
  assert.equal(rs.filter(r => r.statusCode === 200).length, LIMITE_IMAGENS);
  assert.equal(rs.filter(r => r.statusCode === 429).length, 20);
});

test('se a geração falhar, a unidade reservada é estornada', async () => {
  const u = usuario(m, 'ana');
  m.falharAnthropic = true;
  assert.equal((await chamar(claude, 'ana', roteiro)).statusCode, 500);
  assert.equal(usoDe(m, u.id).roteiros_count, 0);
});

test('fallback sem a RPC (PGRST202): usa ler/gravar, continua barrando no limite e avisa no log', async () => {
  m.rpc = false;
  const u = usuario(m, 'ana');
  for (let i = 0; i < LIMITE_ROTEIROS; i++) {
    assert.equal((await chamar(claude, 'ana', roteiro)).statusCode, 200);
  }
  assert.equal((await chamar(claude, 'ana', roteiro)).statusCode, 429);
  assert.equal(usoDe(m, u.id).roteiros_count, LIMITE_ROTEIROS);
  assert.ok(m.avisos.some(a => /consumir_uso não existe/.test(a)));
  // estorno no caminho antigo também funciona
  m.falharAnthropic = true;
  m.uso[Object.keys(m.uso)[0]].roteiros_count = 3;
  assert.equal((await chamar(claude, 'ana', roteiro)).statusCode, 500);
  assert.equal(usoDe(m, u.id).roteiros_count, 3);
});

test('fallback: erro 42883 também é tratado como "função inexistente"', async () => {
  usuario(m, 'ana');
  const fetchOriginal = m.fetch;
  global.fetch = async (url, opts) => url.includes('/rpc/')
    ? { ok: false, status: 404, json: async () => ({}), text: async () => JSON.stringify({ code: '42883', message: 'function does not exist' }) }
    : fetchOriginal(url, opts);
  assert.equal((await chamar(claude, 'ana', roteiro)).statusCode, 200);
  assert.ok(m.chamadas.legado > 0);
});

test('antes da migration 007 (sem RPC e sem auxiliares_count): uso de apoio passa sem contar, roteiro segue limitado', async () => {
  m.rpc = false; m.colunaAux = false;
  usuario(m, 'ana');
  assert.equal((await chamar(claude, 'ana', { operacao: 'dica', prompt: 'x' })).statusCode, 200);
  assert.ok(m.avisos.some(a => /auxiliares_count não existe/.test(a)));
});

test('antes da migration 006 (sem coluna unlimited): conta comum fica limitada, admin segue ilimitado', async () => {
  m.colunaUnlimited = false;
  const u = usuario(m, 'ana');
  m.uso[`${u.id}|${require('../lib/usage').mesAtual()}`] = { roteiros_count: LIMITE_ROTEIROS, imagens_count: 0, auxiliares_count: 0 };
  assert.equal((await chamar(claude, 'ana', roteiro)).statusCode, 429);
  assert.ok(m.avisos.some(a => /permissions.unlimited não existe/.test(a)));
  usuario(m, 'adm', { email: 'admin@exemplo.com' });
  assert.equal((await chamar(claude, 'adm', roteiro)).statusCode, 200);
});

test('erro inesperado na RPC: falha fechada (503) e nada é gerado', async () => {
  usuario(m, 'ana');
  m.falharRpcCom500 = true;
  const r = await chamar(claude, 'ana', roteiro);
  assert.equal(r.statusCode, 503);
  assert.equal(m.chamadas.anthropic.length, 0);
});

test('sem login: claude, image e proofread devolvem 401', async () => {
  assert.equal((await chamar(claude, null, roteiro)).statusCode, 401);
  assert.equal((await chamar(image, null, { prompt: 'x' })).statusCode, 401);
  assert.equal((await chamar(proofread, null, { items: ['a'] })).statusCode, 401);
  assert.equal((await chamar(proofread, 'token-invalido', { items: ['a'] })).statusCode, 401);
  assert.equal(m.chamadas.gemini.length + m.chamadas.anthropic.length, 0);
});

test('proofread logado revisa, valida entrada e conta 1 uso de apoio', async () => {
  const u = usuario(m, 'ana');
  const r = await chamar(proofread, 'ana', { items: ['a', 'b'] });
  assert.equal(r.statusCode, 200);
  assert.deepEqual(r.body.items, ['a ✓', 'b ✓']);
  assert.equal(usoDe(m, u.id).auxiliares_count, 1);
  assert.equal((await chamar(proofread, 'ana', { items: [123] })).statusCode, 400);
  assert.equal((await chamar(proofread, 'ana', { items: ['x'.repeat(7000)] })).statusCode, 400);
});
