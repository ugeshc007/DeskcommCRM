---
impacto: nada_mudou
secao: corrigido
titulo: Reject untested integration connections before publishing a flow
---
Publishing a flow now requires each integration connection to have a successful
validation timestamp and no recorded failure, in addition to being active,
organization-owned and at the revision selected in the builder. An unavailable
connection lookup fails closed without publishing a version.
