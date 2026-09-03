"""
Teste isolado da Fase 1 (triagem com Haiku).

Roda só a Fase 1 contra o arquivo de exemplo, com um teto de gasto minusculo.
Uso:
    export ANTHROPIC_API_KEY=sk-...
    python testar_fase1.py

Depois de calibrar o prompt no dia 5, troque o arquivo de exemplo pelo
preflight.json real do seu projeto (extraia a lista de falhas de la).
"""

import asyncio
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from agent import fase1_triagem, Orcamento  # noqa: E402

ARQUIVO_TESTE = Path(__file__).parent / "testes-exemplo" / "falhas-exemplo.json"


async def main():
    falhas = json.loads(ARQUIVO_TESTE.read_text())
    preflight_falso = {
        "etapas": [{"etapa": "testes", "codigo": 1,
                     "saida": json.dumps({"failures": falhas})}]
    }

    orcamento = Orcamento(teto=0.20)  # teto minusculo, e so um teste
    resolvidos, escalados = await fase1_triagem(preflight_falso, orcamento)

    print(f"\n{len(resolvidos)} resolvidos, {len(escalados)} escalados "
          f"de {len(falhas)} falhas totais")
    print(f"custo: ${orcamento.gasto:.4f}\n")

    print("--- resolvidos ---")
    for r in resolvidos:
        print(json.dumps(r, ensure_ascii=False, indent=2))

    print("\n--- escalados (iriam para a Fase 2 / Sonnet) ---")
    for e in escalados:
        print(json.dumps(e, ensure_ascii=False, indent=2))

    taxa = len(escalados) / len(falhas)
    print(f"\ntaxa de escalonamento: {taxa:.0%}")
    if taxa > 0.30:
        print("acima de 30% — ajuste o prompt TRIAGEM_SISTEMA em agent.py "
              "antes de considerar o dia 5 concluido")


if __name__ == "__main__":
    asyncio.run(main())
