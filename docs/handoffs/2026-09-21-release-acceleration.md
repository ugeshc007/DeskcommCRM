---
type: operational-memory
date: 2026-09-21
status: implemented-not-deployed
branch: codex/field-sales-tracking
---

# Memória operacional — aceleração segura de build e release

Este registro é o ponto de retomada datado. Ele não afirma estado futuro do CI nem da VPS;
o que não foi medido está marcado como pendente.

## Decisões permanentes

- Backups, isolamento de banco/RLS, health checks e rollback nunca são removidos para ganhar tempo.
- O caminho normal de instalações versionadas publica imagens Linux `amd64` no GitHub
  Actions e o host apenas puxa e reinicia. CT102 ainda usa um snapshot sem `.git`
  e exige um adaptador de deploy próprio antes de migrar para esse caminho.
- Feedback local/PR começa com módulos alterados (`pnpm test:changed`). O gate final continua
  com typecheck, lint e todos os unitários; banco, navegador, imagens e Android são lanes
  independentes que o GitHub Actions executa em paralelo.
- PostgreSQL 17 é a ferramenta pinada para dump e aplicação do baseline. O release seguro
  faz `docker pull postgres:17-alpine`, mantendo-a no cache local do host.
- O staging proposto para instalações versionadas usa o mesmo `release-safe.sh`,
  compose e imagens da produção. Ainda não foi provisionado nem exercitado.

## Implementado nesta data — CONFIRMADO por código

- `scripts/ci/test-changed.sh`: seleciona testes Vitest relacionados; mudanças transversais
  deixam a suíte inteira para o gate final, e mudanças self-host acionam o harness shell.
- `.github/workflows/ci.yml`: job `focused` antes do `verify` integral. O job de invariantes
  de banco continua separado e paralelo.
- `.github/workflows/android.yml`: unitários, lint, APK e instrumentação em emulador, com
  caches de Gradle e snapshot AVD.
- `.github/workflows/staging-release.yml`: promoção manual de uma tag `vX.Y.Z` para o
  GitHub Environment `staging-ct102-parity` por SSH com host key pinada.
- `hostgator-setup-kit/release-safe.sh`: para instalação com checkout Git e tag
  imutável; lock exclusivo, PostgreSQL 17, backup obrigatório, `update.sh`, smoke e
  rollback do aplicativo para a versão anterior. Recusa CT102 sem `.git`.
- `hostgator-setup-kit/smoke-postdeploy.sh`: entrada/login, health Supabase+WAHA, proteção ou
  autenticação da API Field Sales e rota Live View.

## Configuração externa ainda necessária — PENDENTE

No GitHub Environment `staging-ct102-parity`, cadastrar apenas no cofre de secrets:
`STAGING_SSH_KEY`, `STAGING_SSH_HOST_KEY`, `STAGING_HOST`, `STAGING_USER` e `STAGING_PATH`.
Nenhum deles pertence ao repositório. O host staging deve ser uma instalação separada, com
o mesmo compose/proxy e uma base descartável/restaurável; nunca apontar para o banco de CT102.

CT102 ainda precisa de uma release por digest das três imagens e de uma forma segura de
entregar o snapshot do código/migrations; não rodar `release-safe.sh` ali. O workflow Android pode precisar de ajuste de capacidade caso o runner público não ofereça
aceleração KVM. Isso só pode ser confirmado pelo primeiro run; não é evidência desta sessão.

## Comandos do operador

Feedback rápido local:

```bash
pnpm test:changed
```

Release protegida numa instalação versionada com checkout Git, depois que a tag e as três
imagens existirem:

```bash
cd /var/www/crm
bash hostgator-setup-kit/release-safe.sh --to vX.Y.Z
```

Smoke isolado:

```bash
bash hostgator-setup-kit/smoke-postdeploy.sh
```

## Estado de implantação

Em 2026-09-21 estas mudanças estão no branch de trabalho e **não foram implantadas** por
este registro. Publicação continua condicionada aos testes relevantes, revisão do diff,
push e existência das imagens versionadas. Dados vivos não foram modificados. O job de CI
e o Android ainda precisam da primeira execução real; código presente não equivale a gate verde.
