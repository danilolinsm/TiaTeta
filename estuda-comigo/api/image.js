// Gera o pôster ilustrado (mapa mental) usando o Gemini Pro Image (Nano Banana Pro).
// A chave nunca é exposta ao navegador — fica só na variável de ambiente GEMINI_API_KEY.
// Sequência: auth → checagem de uso (reserva atômica) → geração → (estorno se falhar).
const { getAuthenticatedUser, reservarUso, estornarUso } = require('../lib/usage');

const MAX_PROMPT = 8000;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  let ticket = null;
  try {
    // 1. auth
    const me = await getAuthenticatedUser(req);
    if (!me) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }

    const { prompt } = req.body || {};
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'prompt é obrigatório' });
      return;
    }
    if (prompt.length > MAX_PROMPT) {
      res.status(400).json({ error: 'Pedido grande demais.' });
      return;
    }

    // 2. checagem de uso (checa e já reserva, atômico)
    ticket = await reservarUso(me, 'imagens');

    // 3. geração
    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await r.json();
    if (data.error) {
      console.error('Erro da API do Gemini (imagem):', JSON.stringify(data.error));
      await estornarUso(ticket);
      res.status(500).json({ error: typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error)) });
      return;
    }
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const imgPart = parts.find(p => p.inlineData);
    if (!imgPart) {
      await estornarUso(ticket);
      res.status(500).json({ error: 'Nenhuma imagem retornada pela API.' });
      return;
    }

    // 4. incremento: já feito na reserva
    res.status(200).json({ dataUrl: `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}` });
  } catch (e) {
    if (e && e.status) {
      res.status(e.status).json({ error: e.message });
      return;
    }
    await estornarUso(ticket);
    res.status(500).json({ error: e.message });
  }
};
