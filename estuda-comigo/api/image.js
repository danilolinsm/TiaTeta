// Gera o pôster ilustrado (mapa mental) usando o Gemini Pro Image (Nano Banana Pro).
// A chave nunca é exposta ao navegador — fica só na variável de ambiente GEMINI_API_KEY.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
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
      res.status(500).json({ error: data.error.message });
      return;
    }
    const parts = (data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts) || [];
    const imgPart = parts.find(p => p.inlineData);
    if (!imgPart) {
      res.status(500).json({ error: 'Nenhuma imagem retornada pela API.' });
      return;
    }
    res.status(200).json({ dataUrl: `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
