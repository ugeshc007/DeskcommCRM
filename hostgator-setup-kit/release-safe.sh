#!/usr/bin/env bash
# Release versionada para o kit self-host com checkout Git. CT102 usa um
# snapshot sem .git e NAO deve executar este caminho (ver runbook).
set -euo pipefail

KIT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" && pwd)"
source "$KIT_DIR/_common.sh"
enter_project
[ -d .git ] || die "Esta instalacao nao tem checkout Git; release-safe.sh exige uma tag imutavel."

TARGET=""
while [ $# -gt 0 ]; do
  case "$1" in
    --to) shift; TARGET="${1:-}" ;;
    *) die "Uso: bash hostgator-setup-kit/release-safe.sh [--to vX.Y.Z]" ;;
  esac
  shift
done

recusar_projeto_de_outra_arvore || die "Release interrompida: esta arvore nao e dona dos containers."
command -v flock >/dev/null 2>&1 || die "Instale util-linux (flock) antes da release."
exec 9>"$PROJECT_DIR/.release-safe.lock"
flock -n 9 || die "Ja existe uma release em andamento nesta instalacao."

previous=""
# O HEAD pode ja ter sido trocado por uma atualizacao interrompida. A imagem
# pinada no .env e a fonte do rollback, nao o checkout do codigo.
current_image="$(valor_do_env .env APP_IMAGE)"
running_container="$(dc ps -q app)"
[ -n "$running_container" ] || die "App nao esta em execucao; nao ha imagem anterior verificavel para rollback."
running_image="$(docker inspect "$running_container" --format '{{.Config.Image}}')"
[ "$running_image" = "$current_image" ] || die "A imagem em execucao difere da .env; nao posso escolher rollback com seguranca."
current_version="$(tag_da_imagem "$current_image")"
case "$current_version" in
  [0-9]*.[0-9]*.[0-9]*)
    git rev-parse --verify --quiet "v${current_version}^{commit}" >/dev/null \
      && previous="v${current_version}"
    ;;
esac
[ -n "$previous" ] || die "A versao atual nao e uma release imutavel conhecida; nao ha rollback automatico seguro."

step "Preparando utilitario PostgreSQL 17"
docker pull postgres:17-alpine >/dev/null
c_grn "✓ postgres:17-alpine mantido localmente para backup e migrations"

step "Backup obrigatorio"
bash "$KIT_DIR/backup.sh"
c_grn "✓ backup verificado antes de qualquer troca"

args=(--skip-backup)
[ -n "$TARGET" ] && args+=(--to "$TARGET")

if bash "$KIT_DIR/update.sh" "${args[@]}" && bash "$KIT_DIR/smoke-postdeploy.sh"; then
  c_grn "✓ release concluida e smoke aprovado"
  exit 0
fi

c_red "✗ release ou smoke falhou; iniciando rollback do app para $previous"
if bash "$KIT_DIR/update.sh" --to "$previous" --force --skip-backup && bash "$KIT_DIR/smoke-postdeploy.sh"; then
  c_ylw "⚠ rollback do app concluido. O backup anterior foi preservado para restauracao do banco, se necessaria."
  exit 1
fi

c_red "✗ rollback automatico nao ficou saudavel. Nao apague backups."
c_red "  Rode: bash hostgator-setup-kit/restore.sh"
exit 2
