// Proxy server-side para a API da Anthropic (Claude).
// A chave nunca é exposta ao navegador — fica só na variável de ambiente ANTHROPIC_API_KEY.
const { getAuthenticatedUser, getUsage, incrementUsage, LIMITE_ROTEIROS } = require('../lib/usage');

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

    const { prompt, images, image, kind } = req.body || {};
    if (!prompt) {
      res.status(400).json({ error: 'prompt é obrigatório' });
      return;
    }

    // Só roteiros novos contam pro limite mensal — dicas, ajustes e regeneração não.
    if (kind === 'roteiro') {
      const uso = await getUsage(me.id);
      if (uso.roteiros_count >= LIMITE_ROTEIROS) {
        res.status(429).json({ error: `Vocês atingiram o limite de ${LIMITE_ROTEIROS} roteiros este mês. O limite renova no início do próximo mês.` });
        return;
      }
    }

    const content = [];
    const fileList = (images && images.length) ? images : (image ? [image] : []);
    for (const file of fileList) {
      if (!file || !file.base64) continue;
      if (file.isPdf) {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: file.base64 } });
      } else {
        content.push({ type: 'image', source: { type: 'base64', media_type: file.mediaType || 'image/jpeg', data: file.base64 } });
      }
    }
    content.push({ type: 'text', text: prompt });

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        messages: [{ role: 'user', content }]
      })
    });
    const data = await r.json();
    if (data.error) {
      console.error('Erro da Anthropic:', JSON.stringify(data.error));
      res.status(500).json({ error: typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error)) });
      return;
    }
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');

    if (kind === 'roteiro') {
      await incrementUsage(me.id, 'roteiros_count');
    }

    res.status(200).json({ text });
  } catch (e) {
    console.error('Erro inesperado em /api/claude:', e);
    res.status(500).json({ error: e.message });
  }
};