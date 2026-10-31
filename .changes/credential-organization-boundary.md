---
impacto: nada_mudou
secao: corrigido
titulo: Restrict credential lookup to its organization
---
AI credential loading now filters by organization before fetching encrypted data,
while retaining the defensive ownership check before decryption. Database and
crypto diagnostics no longer propagate raw error text. No operator action, schema
change or credential replacement is required.
