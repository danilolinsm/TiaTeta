"""
Agente de QA e release do Tia Teta.

Regra central: o modelo e escolhido pelo custo de estar errado, nao pelo custo
da chamada. Triagem de teste erra barato -> Haiku. Conformidade de loja erra
caro (dias de espera de revisao) -> Sonnet.

A API do Claude Agent SDK muda com frequencia. Confira a assinatura atual em
https://docs.claude.com antes de rodar em producao.
"""

import asyncio
import json
import os
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path

from claude_agent_sdk import ClaudeAgentOptions, query

# Precos por milhao de tokens, verificados em setembro de 2026.
# Batch corta 50%. Leitura de cache custa 10% do input.
PRECOS = {
    "claude-haiku-4-5": {"in": 1.00, "out": 5.00},
    "claude-sonnet-5": {"in": 3.00, "out": 15.00},
    "claude-opus-5": {"in": 5.00, "out": 25.00},
}

TETO_USD = float(os.environ.get("QA_TETO_USD", "2.00"))
LIMIAR_CONFIANCA = 0.7
LIMIAR_ESCALONAMENTO = 0.30


@dataclass
class Orcamento:
    """Teto rigido. Um loop de agente sem isso e a unica forma real de tomar
    um susto na fatura."""

    teto: float
    gasto: float = 0.0
    por_modelo: dict = field(default_factory=dict)

    def cobrar(self, modelo: str, tokens_in: int, tokens_out: int, batch=False):
        p = PRECOS[modelo]
        custo = (tokens_in / 1e6) * p["in"] + (tokens_out / 1e6) * p["out"]
        if batch:
            custo *= 0.5
        self.gasto += custo
        self.por_modelo[modelo] = self.por_modelo.get(modelo, 0.0) + custo
        if self.gasto > self.teto:
            raise BudgetExceeded(
                f"teto de ${self.teto:.2f} estourado (${self.gasto:.2f}). "
                f"Execucao abortada."
            )
        return custo


class BudgetExceeded(RuntimeError):
    pass


async def chamar(prompt: str, modelo: str, orcamento: Orcamento,
                 sistema: str = "", ferramentas=None) -> str:
    """Uma chamada, um modelo, contabilizada."""
    partes = []
    tin = tout = 0

    async for msg in query(
        prompt=prompt,
        options=ClaudeAgentOptions(
            model=modelo,
            system_prompt=sistema,
            allowed_tools=ferramentas or ["Read"],
            max_turns=6,
        ),
    ):
        texto = getattr(msg, "text", None)
        if texto:
            partes.append(texto)
        uso = getattr(msg, "usage", None)
        if uso:
            tin += getattr(uso, "input_tokens", 0)
            tout += getattr(uso, "output_tokens", 0)

    orcamento.cobrar(modelo, tin, tout)
    return "".join(partes)


# ---------------------------------------------------------------- fase 0

def fase0_preflight() -> dict:
    """Determinístico. Nenhum token gasto aqui, e essa e a maior economia
    do pipeline inteiro."""
    r = subprocess.run(["bash", "preflight.sh"], capture_output=True, text=True)
    dados = json.loads(Path("preflight.json").read_text())
    dados["preflight_returncode"] = r.returncode
    return dados


# ---------------------------------------------------------------- fase 1

TRIAGEM_SISTEMA = """Voce classifica falhas de teste. Responda SOMENTE com JSON
valido, sem markdown, sem preambulo.

Categorias: regressao_real, flake, teste_desatualizado, indeterminado.

Se nao tiver certeza, use indeterminado com confianca baixa. Marcar um flake
como regressao_real faz um humano perder uma hora investigando nada. Chutar alto
e pior que admitir duvida."""


async def fase1_triagem(preflight: dict, orcamento: Orcamento):
    falhas = extrair_falhas(preflight)
    if not falhas:
        return [], []

    classificados = []
    for f in falhas:
        bruto = await chamar(
            prompt=json.dumps(f, ensure_ascii=False),
            modelo="claude-haiku-4-5",
            sistema=TRIAGEM_SISTEMA,
            orcamento=orcamento,
        )
        try:
            classificados.append(json.loads(bruto.strip().strip("`")))
        except json.JSONDecodeError:
            classificados.append({"teste": f.get("nome"), "categoria": "indeterminado",
                                  "confianca": 0.0, "motivo": "saida ilegivel"})

    escalar = [c for c in classificados
               if c.get("confianca", 0) < LIMIAR_CONFIANCA
               or c.get("categoria") == "indeterminado"]
    resolvidos = [c for c in classificados if c not in escalar]

    taxa = len(escalar) / len(classificados)
    if taxa > LIMIAR_ESCALONAMENTO:
        print(f"[aviso] {taxa:.0%} escalado. O prompt da triagem esta ruim — "
              f"corrija o prompt em vez de subir o modelo.", file=sys.stderr)

    return resolvidos, escalar


# ---------------------------------------------------------------- fase 2

CONFORMIDADE_SISTEMA = """Voce revisa um candidato a release contra as diretrizes
da App Store e do Google Play.

Contexto do produto: app de preparacao para o ENEM. O publico e majoritariamente
estudante de ensino medio, boa parte menor de 18 anos. Classificacao etaria,
politica de privacidade e formulario de seguranca de dados do Play precisam
bater exatamente com o que o app coleta. Divergencia ai e rejeicao certa.

Sinalize alegacoes de eficacia ("aumente sua nota", "garanta sua aprovacao") —
elas costumam ser barradas na revisao.

Para cada achado: severidade (bloqueante ou aviso), a diretriz aplicavel e a
correcao concreta. Sem hedging: se e bloqueante, diga bloqueante."""


async def fase2_conformidade(metadados: dict, escalados: list, orcamento: Orcamento):
    """Aqui nao se economiza. Uma rejeicao custa dias de espera; a diferenca de
    preco entre Haiku e Sonnet nesta fase e de centavos."""
    payload = {"metadados": metadados, "falhas_escaladas": escalados}
    saida = await chamar(
        prompt=json.dumps(payload, ensure_ascii=False),
        modelo="claude-sonnet-5",
        sistema=CONFORMIDADE_SISTEMA,
        orcamento=orcamento,
        ferramentas=["Read", "Grep"],
    )
    return saida


# ---------------------------------------------------------------- fase 3

async def fase3_empacotar(conformidade: str, preflight: dict, orcamento: Orcamento):
    """Transformacao mecanica de conteudo ja validado. Haiku basta."""
    return await chamar(
        prompt=f"Monte CHECKLIST.md e RELATORIO.md a partir de:\n{conformidade}",
        modelo="claude-haiku-4-5",
        sistema="Escreva markdown direto, sem preambulo. Cada linha do checklist "
                "e uma acao com o caminho do arquivo ja resolvido.",
        orcamento=orcamento,
        ferramentas=["Read", "Write"],
    )


# ---------------------------------------------------------------- main

def extrair_falhas(preflight: dict) -> list:
    for etapa in preflight.get("etapas", []):
        if etapa.get("etapa") == "testes" and etapa.get("codigo") != 0:
            try:
                return json.loads(etapa["saida"]).get("failures", [])
            except (json.JSONDecodeError, KeyError):
                return [{"nome": "saida de teste ilegivel", "detalhe": etapa["saida"][:2000]}]
    return []


async def main():
    orcamento = Orcamento(teto=TETO_USD)

    preflight = fase0_preflight()
    if not preflight.get("build_ok"):
        escrever_issue("Build quebrado — nenhum token gasto", preflight, orcamento)
        return 2

    if preflight["commit"] == preflight.get("commit_anterior"):
        print("[skip] nada mudou desde a ultima execucao", file=sys.stderr)
        return 0

    try:
        resolvidos, escalados = await fase1_triagem(preflight, orcamento)
        metadados = json.loads(Path("store-metadata.json").read_text())
        conformidade = await fase2_conformidade(metadados, escalados, orcamento)
        await fase3_empacotar(conformidade, preflight, orcamento)
    except BudgetExceeded as e:
        escrever_issue(f"Abortado: {e}", preflight, orcamento)
        return 3

    Path(".last-qa-commit").write_text(preflight["commit"])
    print(f"[custo] ${orcamento.gasto:.4f} — {orcamento.por_modelo}", file=sys.stderr)
    escrever_issue("Release candidate pronto", preflight, orcamento)
    return 0


def escrever_issue(titulo: str, preflight: dict, orcamento: Orcamento):
    corpo = (f"{titulo}\n\ncommit: {preflight.get('commit','?')[:8]}\n"
             f"custo: ${orcamento.gasto:.4f}\ndetalhe: {orcamento.por_modelo}\n")
    subprocess.run(["gh", "issue", "create", "--title", titulo,
                    "--body", corpo, "--label", "release-candidate"])


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
