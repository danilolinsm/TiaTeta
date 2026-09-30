// Usa o Gemini para revisar/corrigir erros de ortografia e gramática
// nos textos que a Claude gerou, antes de mostrar para a mãe.
// Sequência: auth → checagem de uso (categoria "auxiliares") → geração → (estorno se a API falhar).
// Se a revisão falhar DEPOIS de liberada, devolve os textos originais (nunca quebra o fluxo).
const { getAuthenticatedUser, reservarUso, estornarUso } = require('../lib/usage');

const MAX_ITENS = 40;
const MAX_CHARS_ITEM = 6000;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  const { items } = req.body || {};
  let ticket = null;
  try {
    // 1. auth
    const me = await getAuthenticatedUser(req);
    if (!me) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }

    if (!Array.isArray(items) || !items.length) {
      res.status(400).json({ error: 'items é obrigatório (array de textos)' });
      return;
    }
    if (items.length > MAX_ITENS || items.some(t => typeof t !== 'string' || t.length > MAX_CHARS_ITEM)) {
      res.status(400).json({ error: `items deve ter até ${MAX_ITENS} textos de até ${MAX_CHARS_ITEM} caracteres` });
      return;
    }

    // 2. checagem de uso (reserva atômica)
    ticket = await reservarUso(me, 'auxiliares');

    // 3. geração
    const prompt = `Revise os textos abaixo em português do Brasil. Corrija apenas erros de ortografia, gramática e digitação, sem mudar o sentido, o tamanho ou o tom.
Mantenha exatamente a mesma quantidade de itens e a mesma ordem.
Devolva APENAS um JSON válido no formato {"items":["texto revisado 1","texto revisado 2"]}, sem markdown, sem texto antes ou depois.

Textos:
${items.map((t, i) => `${i + 1}. ${t}`).join('\n')}`;

    const model = process.env.GEMINI_TEXT_MODEL || 'gemini-2.5-flash';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await r.json();
    if (data.error) {
      await estornarUso(ticket); // a API não gerou nada: não conta
      ticket = null;
      res.status(200).json({ items }); // fallback: textos originais
      return;
    }
    // 4. incremento: já feito na reserva. Daqui pra baixo a revisão já foi paga, então conta mesmo se vier malformada.
    ticket = null;
    const text = ((data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [])
      .map(p => p.text || '').join('\n');
    const clean = text.replace(/```json|```/g, '').trim();
    const parsed = JSON.parse(clean);
    if (!Array.isArray(parsed.items) || parsed.items.length !== items.length) {
      // fallback de segurança: se a revisão vier malformada, devolve os textos originais
      res.status(200).json({ items });
      return;
    }
    res.status(200).json(parsed);
  } catch (e) {
    if (e && e.status) { // 429 limite / 503 falha ao checar uso — o frontend mantém o texto original
      res.status(e.status).json({ error: e.message });
      return;
    }
    await estornarUso(ticket);
    // Nunca deixa a revisão quebrar o fluxo: devolve os textos originais em caso de erro
    res.status(200).json({ items: Array.isArray(items) ? items : [] });
  }
};
