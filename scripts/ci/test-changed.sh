#!/usr/bin/env bash
# Feedback rapido para o que mudou. O gate final continua rodando a suite inteira.
set -euo pipefail

base="${CHANGED_BASE_REF:-}"
if [ -z "$base" ]; then
  if [ -n "${GITHUB_BASE_REF:-}" ] && git rev-parse --verify --quiet "origin/${GITHUB_BASE_REF}^{commit}" >/dev/null; then
    base="origin/${GITHUB_BASE_REF}"
  elif git rev-parse --verify --quiet 'HEAD^' >/dev/null; then
    base='HEAD^'
  else
    echo "Sem commit-base: executando a suite unitaria completa."
    exec pnpm test:unit
  fi
fi

mapfile -t changed < <(git diff --name-only --diff-filter=ACMR "${base}...HEAD")
if [ "${#changed[@]}" -eq 0 ]; then
  echo "Nenhum arquivo alterado desde ${base}."
  exit 0
fi

printf 'Arquivos alterados desde %s: %s\n' "$base" "${#changed[@]}"

# Configuracao global, lockfile ou harness pode afetar qualquer modulo. Nao
# repetimos a suite inteira no feedback curto; o `verify` final ja a executa.
global_change=""
for file in "${changed[@]}"; do
  case "$file" in
    package.json|pnpm-lock.yaml|vitest.config.*|tsconfig*.json|tests/setup.*|.github/actions/*)
      global_change="$file"
      break
      ;;
  esac
done

mapfile -t sources < <(printf '%s\n' "${changed[@]}" | grep -E '\.(ts|tsx|js|jsx)$' || true)
if [ -n "$global_change" ]; then
  echo "Mudanca transversal ($global_change): unitarios completos ficam no gate final."
elif [ "${#sources[@]}" -gt 0 ]; then
  echo "Executando Vitest relacionado a ${#sources[@]} arquivo(s) de codigo."
  pnpm exec vitest related --run "${sources[@]}"
else
  echo "Nenhum modulo TypeScript/JavaScript mudou."
fi

if printf '%s\n' "${changed[@]}" | grep -qE '^(hostgator-setup-kit/|tests/shell/|docker-compose.*\.ya?ml$|Dockerfile)'; then
  echo "Superficie self-host alterada: executando harness shell."
  pnpm test:shell
fi
