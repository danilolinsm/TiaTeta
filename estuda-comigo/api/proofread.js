// Usa o Gemini para revisar/corrigir erros de ortografia e gramática
// nos textos que a Claude gerou, antes de mostrar para a mãe.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { items } = req.body || {};
    if (!Array.isArray(items) || !items.length) {
      res.status(400).json({ error: 'items é obrigatório (array de textos)' });
      return;
    }

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
      res.status(500).json({ error: data.error.message });
      return;
    }
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
    // Nunca deixa a revisão quebrar o fluxo: devolve os textos originais em caso de erro
    const { items } = req.body || {};
    res.status(200).json({ items: items || [] });
  }
};
