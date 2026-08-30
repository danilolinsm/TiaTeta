# Tia Teta

Protótipo de site para mães ajudarem os filhos (até 13 anos) a estudar: resumo fácil,
mapa mental ilustrado (pôster A4) e simulado, gerados por IA a partir de uma foto ou PDF
do material escolar.

## Como está organizado

```
estuda-comigo/
├── public/
│   └── index.html      ← frontend (tudo em um arquivo: HTML + CSS + JS)
├── api/
│   ├── claude.js        ← gera resumo, mapa mental e simulado (Claude/Anthropic)
│   ├── proofread.js      ← revisa erros de escrita do texto gerado (Gemini)
│   └── image.js          ← gera o pôster ilustrado A4 (Gemini Pro / Nano Banana Pro)
├── package.json
└── .env.example
```

**Importante:** as chaves de API (Anthropic e Google) ficam só nessas três funções em
`api/`, que rodam no servidor. O `public/index.html` nunca vê nem tem acesso às chaves —
ele só chama `/api/claude`, `/api/proofread` e `/api/image`, que o navegador de uma mãe
usando o site jamais consegue inspecionar para descobrir a chave.

## Deploy na Vercel (recomendado)

1. Crie uma conta gratuita em https://vercel.com (pode entrar com GitHub).
2. Suba esta pasta para um repositório no GitHub (ou use a CLI da Vercel — veja opção B).
3. Na Vercel, clique em **Add New → Project** e importe esse repositório.
4. Antes de finalizar o deploy (ou depois, em *Project Settings → Environment Variables*),
   adicione:
   - `ANTHROPIC_API_KEY` — sua chave da Anthropic (https://console.anthropic.com)
   - `GEMINI_API_KEY` — sua chave do Google AI Studio (https://aistudio.google.com/app/apikey), a mesma conta com acesso ao Gemini Pro
   - (opcional) `GEMINI_TEXT_MODEL` e `GEMINI_IMAGE_MODEL` — só se quiser trocar os modelos padrão
5. Clique em **Deploy**. Em ~1 minuto você recebe um link tipo `estuda-comigo.vercel.app`.
6. Pronto — esse link já pode ser testado no celular de verdade, com câmera funcionando normalmente (fora do modo de pré-visualização do Claude, essa restrição não existe mais).

### Opção B — deploy via linha de comando (sem GitHub)

```bash
npm i -g vercel
cd estuda-comigo
vercel
# siga as perguntas, depois:
vercel env add ANTHROPIC_API_KEY
vercel env add GEMINI_API_KEY
vercel --prod
```

## Testando localmente antes do deploy (opcional)

```bash
npm i -g vercel
cd estuda-comigo
cp .env.example .env   # e preencha suas chaves no .env
vercel dev
```

Isso sobe o site em `http://localhost:3000` já com as funções de API funcionando.

## Limitações desta versão (fase de teste com mães reais)

- Os dados (filhos, histórico) ficam salvos no navegador de cada mãe (`localStorage`),
  não num banco de dados compartilhado. Bom o suficiente para o teste inicial; para
  produção de verdade (várias contas, acesso de vários dispositivos), seria necessário
  um banco de dados e login.
- Sem autenticação — qualquer pessoa com o link acessa o site, mas os dados de cada uma
  ficam isolados no próprio navegador.
- O pôster ilustrado depende da cota da sua conta Gemini Pro — monitore o uso no Google
  AI Studio para não estourar limites durante o teste com várias mães.
