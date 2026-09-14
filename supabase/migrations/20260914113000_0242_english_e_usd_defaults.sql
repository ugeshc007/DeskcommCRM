-- 0242 — Novas organizações começam na interface internacional.
--
-- Muda somente os defaults. Organizações existentes preservam idioma, moeda e
-- fuso escolhidos; o onboarding continua podendo substituí-los explicitamente.

alter table public.organizations alter column locale set default 'en';
alter table public.organizations alter column timezone set default 'UTC';
alter table public.organizations alter column currency set default 'USD';
