// Gera o pôster ilustrado (mapa mental) usando o Gemini Pro Image (Nano Banana Pro).
// A chave nunca é exposta ao navegador — fica só na variável de ambiente GEMINI_API_KEY.
const { getAuthenticatedUser, getUsage, incrementUsage, LIMITE_IMAGENS } = require('../lib/usage');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const me = await getAuthenticatedUser(req);
    if (!me) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }

    const uso = await getUsage(me.id);
    if (uso.imagens_count >= LIMITE_IMAGENS) {
      res.status(429).json({ error: `Vocês atingiram o limite de ${LIMITE_IMAGENS} imagens este mês. O limite renova no início do próximo mês.` });
      return;
    }

    const { prompt } = req.body || {};
    if (!prompt) {
      res.status(400).json({ error: 'prompt é obrigatório' });
      return;
    }

    const model = process.env.GEMINI_IMAGE_MODEL || 'gemini-3-pro-image-preview';
    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    });
    const data = await r.json();
    if (data.error) {
      console.error('Erro da API do Gemini (imagem):', JSON.stringify(data.error));
      res.status(500).json({ error: typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error)) });
      return;
    }
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const imgPart = parts.find(p => p.inlineData);
    if (!imgPart) {
      res.status(500).json({ error: 'Nenhuma imagem retornada pela API.' });
      return;
    }

    await incrementUsage(me.id, 'imagens_count');

    res.status(200).json({ dataUrl: `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};