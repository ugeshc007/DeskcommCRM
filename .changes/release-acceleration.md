---
impacto: capacidade_nova
secao: alterado
titulo: Releases ganham feedback rapido, staging e rollback verificado
---
O desenvolvimento passa a testar primeiro os módulos alterados, sem remover os gates integrais de unidade, isolamento de banco, navegador e imagens. O kit self-host ganha um comando de release protegido por backup obrigatório, migrations com PostgreSQL 17, smoke de CRM/WhatsApp/Field Sales e rollback automático do aplicativo. Android roda em uma faixa própria com caches de Gradle e emulador, e um workflow manual permite provar a mesma versão imutável em staging antes da produção.
