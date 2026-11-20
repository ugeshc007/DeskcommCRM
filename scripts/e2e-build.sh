#!/usr/bin/env bash
#
# `next build` com o ambiente do E2E (Supabase LOCAL).
#
# ═══ POR QUE NÃO `node --env-file=.env.e2e next build` ═══
#
# Medido: o build morre com
#   ERR_WORKER_INVALID_EXEC_ARGV: --env-file= is not allowed in NODE_OPTIONS
# O `next build` cria Workers, e o Node recusa propagar `--env-file` para eles.
# Exportar no shell resolve porque aí são variáveis de ambiente de verdade, que
# os Workers herdam — e que têm precedência sobre os arquivos `.env*` que o Next
# carrega sozinho (é o que impede o `.env.local`, apontado para produção, de
# vencer).
#
# ═══ POR QUE O BUILD PRECISA DISTO E NÃO SÓ O START ═══
#
# As três `NEXT_PUBLIC_*` são embutidas no BUNDLE aqui. Buildar com o
# `.env.local` e depois trocar o env só no `next start` deixaria a URL de
# produção dentro do JavaScript que roda no browser: o servidor falaria com o
# banco local e o cliente com a nuvem, no mesmo teste.
set -euo pipefail

cd "$(dirname "$0")/.."

if [ ! -f .env.e2e ]; then
  echo "==> .env.e2e não existe. Rode 'pnpm e2e:env' (precisa do Supabase local de pé)." >&2
  exit 1
fi

# `set -a` exporta tudo que for atribuído até o `set +a`.
set -a
# shellcheck disable=SC1091
. ./.env.e2e
set +a

echo "==> Buildando contra ${NEXT_PUBLIC_SUPABASE_URL}"
node scripts/copy-maplibre-worker.mjs
build_next() {
  if command -v pnpm >/dev/null 2>&1; then
    pnpm exec next build
  else
    # Git Bash on Windows sees corepack but not the pnpm.cmd shim.
    corepack pnpm@9.15.9 exec next build
  fi
}

# Next 16.3.4 sometimes gets a stale Google font file from its remote source.
# Turbopack reports that specific fetch failure as an internal module error.
# Retry only that known transient failure; every other build error stops here.
BUILD_LOG="$(mktemp)"
trap 'rm -f "$BUILD_LOG"' EXIT
for attempt in 1 2 3; do
  if build_next > "$BUILD_LOG" 2>&1; then
    cat "$BUILD_LOG"
    break
  fi
  cat "$BUILD_LOG"
  if [ "$attempt" -eq 3 ] || ! grep -Eq 'next/font/google queries have exactly one entry|@vercel/turbopack-next/internal/font/google/font' "$BUILD_LOG"; then
    exit 1
  fi
  echo "==> Retrying transient Next font fetch failure ($attempt/3)."
  node -e 'const fs=require("fs"),path=require("path");const root=fs.realpathSync(process.cwd());const target=path.resolve(root,".next");if(path.dirname(target)!==root)throw Error("Unsafe build cache path");fs.rmSync(target,{recursive:true,force:true})'
done

# A PROVA, e não a suposição: se a URL de produção sobreviveu em qualquer
# artefato do bundle, o `.env.local` venceu e o teste falaria com a nuvem pela
# metade cliente. Falhar aqui é barato; descobrir depois de escrever no banco
# real, não.
#
# O host vem do PRÓPRIO .env.local, então a guarda continua valendo se alguém
# apontar aquele arquivo para outro projeto.
if [ -f .env.local ]; then
  HOST_PROD="$(grep -E '^NEXT_PUBLIC_SUPABASE_URL=' .env.local | cut -d= -f2- | sed -E 's#https?://##; s#/.*##' || true)"
  if [ -n "$HOST_PROD" ] && [ "$HOST_PROD" != "127.0.0.1:54321" ]; then
    if grep -rqF "$HOST_PROD" .next/static 2>/dev/null; then
      echo "==> FALHOU: o bundle do browser contém o host de produção ($HOST_PROD)." >&2
      echo "    O build pegou o .env.local. NÃO rode a suíte — ela escreveria em produção." >&2
      exit 1
    fi
    echo "==> OK: o host de produção ($HOST_PROD) não aparece no bundle do browser."
  fi
fi

# Controle POSITIVO do mesmo grep: se a URL local também não aparecesse, o
# "não achei produção" acima não valeria nada — seria um grep que não acha nada.
HOST_LOCAL="$(printf '%s' "$NEXT_PUBLIC_SUPABASE_URL" | sed -E 's#https?://##; s#/.*##')"
if grep -rqF "$HOST_LOCAL" .next/static 2>/dev/null; then
  echo "==> OK (controle): o host local ($HOST_LOCAL) ESTÁ no bundle — o grep está vivo."
else
  echo "==> FALHOU (controle): o host local não aparece no bundle." >&2
  echo "    Sem isto, a ausência de produção acima não prova nada." >&2
  exit 1
fi
