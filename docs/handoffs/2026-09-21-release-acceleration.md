---
type: operational-memory
date: 2026-09-21
status: deployed-ct102-with-e2e-timeout
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
- `.github/workflows/ci.yml`: job `focused` como feedback de PR, independente do `verify`
  integral obrigatório. O job de invariantes de banco continua separado e paralelo.
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

CT102 ainda precisa de um adaptador automatizado para releases futuras e de uma forma segura
de entregar snapshots do código/migrations; não rodar `release-safe.sh` ali. O primeiro run
Android passou. O primeiro run E2E deste branch excedeu 30 minutos nas três partes; isso é
falha de capacidade do gate, **não** validação verde de navegador.

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

Em 2026-09-21, o código foi publicado no branch `codex/field-sales-tracking` e as imagens
imutáveis do commit `069001d4` foram ativadas no CT102. O app, worker e scheduler ficaram
`healthy`; o health público mostrou `version=069001d4`, Supabase e WAHA `ok`. O smoke local
do CRM, da borda Field Sales e da Live View passou. O dump PostgreSQL e o arquivo de sessão
WAHA foram preservados em `/opt/deskcommcrm/backups/`; o compose anterior ficou em
`/opt/deskcommcrm/backups/release-069001d4/docker-compose.ct102.yml` para rollback.
Nenhuma migration foi aplicada e os demais serviços não foram recriados. O CI integral,
invariantes, Android, imagens e build passaram no commit; E2E terminou vermelho por timeout
simultâneo das três partes no passo Playwright. Como o diff desde a versão viva anterior
alterou apenas CI/scripts/testes/docs (sem código runtime), a ativação foi feita com este
risco explicitamente registrado, sem chamar o E2E de verde. O staging ainda não foi criado.
