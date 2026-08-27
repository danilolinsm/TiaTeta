// Proxy server-side para a API da Anthropic (Claude).
// A chave nunca é exposta ao navegador — fica só na variável de ambiente ANTHROPIC_API_KEY.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { prompt, image } = req.body || {};
    if (!prompt) {
      res.status(400).json({ error: 'prompt é obrigatório' });
      return;
    }

    const content = [];
    if (image && image.base64) {
      if (image.isPdf) {
        content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: image.base64 } });
      } else {
        content.push({ type: 'image', source: { type: 'base64', media_type: image.mediaType || 'image/jpeg', data: image.base64 } });
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
        max_tokens: 2000,
        messages: [{ role: 'user', content }]
      })
    });
    const data = await r.json();
    if (data.error) {
      res.status(500).json({ error: data.error.message });
      return;
    }
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');
    res.status(200).json({ text });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
};
