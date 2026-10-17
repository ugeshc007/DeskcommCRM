---
impacto: nada_mudou
secao: corrigido
titulo: Resolução de versão estável sem falha intermitente de pipe
---

O instalador consome a lista inteira de tags ao escolher a primeira versão estável.
Isso evita SIGPIPE sob pipefail descartar uma versão válida e cair num canal móvel.
Teste sintético com 20 mil tags e prerelease cobre a regressão sem acessar a rede.
