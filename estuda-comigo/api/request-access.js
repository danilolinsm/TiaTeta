// Avisa o(s) administrador(es) por email quando alguém pede acesso
// para gerar imagens. Não trava o app caso o email falhe — o pedido
// já fica salvo no banco (tabela access_requests) e visível no painel
// de administrador de qualquer forma.
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }
  try {
    const { email, name } = req.body || {};
    const adminEmails = (process.env.ADMIN_EMAILS || '').split(',').map(e => e.trim()).filter(Boolean);

    if (!adminEmails.length) {
      res.status(200).json({ ok: true, note: 'ADMIN_EMAILS não configurado — pedido salvo, mas sem email enviado' });
      return;
    }
    if (!process.env.RESEND_API_KEY) {
      res.status(200).json({ ok: true, note: 'RESEND_API_KEY não configurado — pedido salvo, mas sem email enviado' });
      return;
    }

    await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
      body: JSON.stringify({
        from: process.env.RESEND_FROM || 'Tia Teta <onboarding@resend.dev>',
        to: adminEmails,
        subject: 'Novo pedido de acesso à geração de imagens — Tia Teta',
        html: `<p>O usuário <strong>${name || email}</strong> (${email}) pediu acesso para gerar imagens (pôster ilustrado e ilustração das questões) no app Tia Teta.</p><p>Acesse o painel de administrador do app (ícone 👤 → Área do administrador) para aprovar.</p>`
      })
    });
    res.status(200).json({ ok: true });
  } catch (e) {
    // não deixamos isso quebrar a experiência do usuário — o pedido já está salvo no banco
    res.status(200).json({ ok: true, note: 'falha ao enviar email: ' + e.message });
  }
};
