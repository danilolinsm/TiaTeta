// api/request-access.js: login, validação, escape de HTML, honeypot e limite por usuário.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { criarMundo, instalar, usuario, chamar } = require('./helpers');
const requestAccess = require('../api/request-access');

let m;
beforeEach(() => {
  m = criarMundo(); instalar(m);
  process.env.ADMIN_EMAILS = 'admin@exemplo.com';
  process.env.RESEND_API_KEY = 'chave-falsa';
});

test('sem login => 401, nada gravado nem enviado', async () => {
  const r = await chamar(requestAccess, null, { email: 'x@y.com', name: 'X' });
  assert.equal(r.statusCode, 401);
  assert.equal(m.accessRequests.length + m.chamadas.resend.length, 0);
});

test('pedido válido grava em access_requests e manda email com o email VERIFICADO (não o do corpo)', async () => {
  usuario(m, 'ana', { email: 'ana@exemplo.com' });
  const r = await chamar(requestAccess, 'ana', { name: 'Ana', email: 'outra@exemplo.com' });
  assert.equal(r.statusCode, 200);
  assert.equal(m.accessRequests.length, 1);
  assert.equal(m.accessRequests[0].email, 'ana@exemplo.com');
  assert.match(m.chamadas.resend[0].html, /ana@exemplo\.com/);
  assert.doesNotMatch(m.chamadas.resend[0].html, /outra@exemplo\.com/);
});

test('escapa HTML do nome no email', async () => {
  usuario(m, 'ana', { email: 'ana@exemplo.com' });
  await chamar(requestAccess, 'ana', { name: '<img src=x onerror=alert(1)> "Ana" & <b>' });
  const html = m.chamadas.resend[0].html;
  assert.doesNotMatch(html, /<img|<b>/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; &quot;Ana&quot; &amp; &lt;b&gt;/);
});

test('rejeita entrada inválida com 400', async () => {
  usuario(m, 'ana');
  for (const body of [{ name: 'x'.repeat(101) }, { name: 42 }, { name: { a: 1 } }, { email: 'nao-e-email' }, { email: 'a@b.c'.repeat(60) }]) {
    assert.equal((await chamar(requestAccess, 'ana', body)).statusCode, 400, JSON.stringify(body));
  }
  assert.equal(m.accessRequests.length + m.chamadas.resend.length, 0);
});

test('honeypot preenchido => 200 falso, nada gravado nem enviado', async () => {
  usuario(m, 'ana');
  const r = await chamar(requestAccess, 'ana', { name: 'Robô', website: 'http://spam' });
  assert.equal(r.statusCode, 200);
  assert.equal(m.accessRequests.length + m.chamadas.resend.length, 0);
});

test('limite: no máximo 3 pedidos/emails por usuário em 24h, depois 429', async () => {
  usuario(m, 'ana');
  const codigos = [];
  for (let i = 0; i < 6; i++) codigos.push((await chamar(requestAccess, 'ana', { name: 'Ana' })).statusCode);
  assert.deepEqual(codigos, [200, 200, 200, 429, 429, 429]);
  assert.equal(m.chamadas.resend.length, 3);
  assert.equal(m.accessRequests.length, 3);
  // pedidos antigos (> 24h) não contam
  m.accessRequests.forEach(r => { r.requested_at = new Date(Date.now() - 25 * 3600e3).toISOString(); });
  assert.equal((await chamar(requestAccess, 'ana', { name: 'Ana' })).statusCode, 200);
});

test('se não conseguir gravar o pedido => 503 e nenhum email', async () => {
  usuario(m, 'ana');
  m.falharInsertPedido = true;
  assert.equal((await chamar(requestAccess, 'ana', { name: 'Ana' })).statusCode, 503);
  assert.equal(m.chamadas.resend.length, 0);
});
