// Proxy server-side para a API da Anthropic (Claude).
// A chave nunca é exposta ao navegador — fica só na variável de ambiente ANTHROPIC_API_KEY.
//
// Toda chamada precisa dizer QUAL operação é (campo `operacao`), e o servidor só aceita as
// operações da lista fechada abaixo. Cada operação:
//   - sempre conta em alguma categoria de uso (não existe operação "grátis");
//   - tem limites próprios validados aqui (tamanho do prompt, arquivos, max_tokens), então
//     disfarçar um roteiro de "dica" não compensa: a resposta sai cortada em poucas frases.
// Operação ausente ou desconhecida => 400.
const { getAuthenticatedUser, reservarUso, estornarUso } = require('../lib/usage');

const OPERACOES = {
  roteiro:           { categoria: 'roteiros',   maxTokens: 8000, maxPrompt: 20000, maxArquivos: 20 },
  regenerar_roteiro: { categoria: 'roteiros',   maxTokens: 3000, maxPrompt: 15000, maxArquivos: 0 },
  regenerar_questao: { categoria: 'auxiliares', maxTokens: 1000, maxPrompt: 15000, maxArquivos: 0 },
  questoes_foco:     { categoria: 'auxiliares', maxTokens: 4000, maxPrompt: 15000, maxArquivos: 0 },
  dica:              { categoria: 'auxiliares', maxTokens: 400,  maxPrompt: 5000,  maxArquivos: 0 },
  verificar_imagem:  { categoria: 'auxiliares', maxTokens: 300,  maxPrompt: 5000,  maxArquivos: 1, soImagem: true, exigeArquivo: true }
};

// Frontend antigo (aba aberta antes do deploy) mandava kind:'roteiro' na geração principal.
function operacaoDoPedido(body) {
  if (typeof body.operacao === 'string') return body.operacao;
  if (body.kind === 'roteiro') return 'roteiro';
  return null;
}

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

    // validação da operação e do pedido (antes de contar qualquer coisa)
    const body = req.body || {};
    const nomeOp = operacaoDoPedido(body);
    const op = nomeOp && Object.prototype.hasOwnProperty.call(OPERACOES, nomeOp) ? OPERACOES[nomeOp] : null;
    if (!op) {
      res.status(400).json({ error: 'Operação inválida ou ausente. Atualize a página e tente de novo.' });
      return;
    }
    const { prompt, images, image } = body;
    if (!prompt || typeof prompt !== 'string') {
      res.status(400).json({ error: 'prompt é obrigatório' });
      return;
    }
    if (prompt.length > op.maxPrompt) {
      res.status(400).json({ error: 'Pedido grande demais para esta operação.' });
      return;
    }
    const fileList = ((Array.isArray(images) && images.length) ? images : (image ? [image] : []))
      .filter(f => f && typeof f.base64 === 'string' && f.base64);
    if (fileList.length > op.maxArquivos) {
      res.status(400).json({ error: `Esta operação aceita no máximo ${op.maxArquivos} arquivo(s).` });
      return;
    }
    if (op.exigeArquivo && !fileList.length) {
      res.status(400).json({ error: 'Esta operação precisa de uma imagem.' });
      return;
    }
    if (op.soImagem && fileList.some(f => f.isPdf)) {
      res.status(400).json({ error: 'Esta operação aceita só imagem.' });
      return;
    }

    // 2. checagem de uso (atômica: checa e já reserva)
    ticket = await reservarUso(me, op.categoria);

    // 3. geração
    const content = [];
    for (const file of fileList) {
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
        max_tokens: op.maxTokens,
        messages: [{ role: 'user', content }]
      })
    });
    const data = await r.json();
    if (data.error) {
      console.error('Erro da Anthropic:', JSON.stringify(data.error));
      await estornarUso(ticket); // geração falhou: não conta
      res.status(500).json({ error: typeof data.error === 'string' ? data.error : (data.error.message || JSON.stringify(data.error)) });
      return;
    }
    const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('\n');

    // 4. incremento: já feito na reserva (passo 2)
    res.status(200).json({ text });
  } catch (e) {
    if (e && e.status) { // UsageError: 429 limite, 503 falha ao checar
      res.status(e.status).json({ error: e.message });
      return;
    }
    await estornarUso(ticket);
    console.error('Erro inesperado em /api/claude:', e);
    res.status(500).json({ error: e.message });
  }
};

module.exports.OPERACOES = OPERACOES;
