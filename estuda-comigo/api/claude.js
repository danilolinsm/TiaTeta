// Proxy server-side para a API da Anthropic (Claude).
// A chave nunca é exposta ao navegador — fica só na variável de ambiente ANTHROPIC_API_KEY.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { prompt, images, image } = req.body || {};
    if (!prompt) {
      res.status(400).json({ error: 'prompt é obrigatório' });
      return;
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
    res.status(200).json({ text });
  } catch (e) {
    console.error('Erro inesperado em /api/claude:', e);
    res.status(500).json({ error: e.message });
  }
};
