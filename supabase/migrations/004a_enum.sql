-- =============================================================================
-- IMOBILIARIA CONTROL - Multi-tenancy, parte A: o valor novo do enum
-- Execute DEPOIS de 003_rls.sql e ANTES de 004_multitenancy.sql
--
-- !!! RODE ESTE ARQUIVO SOZINHO NO SQL EDITOR !!!
--
-- Por que separado: o SQL Editor do Supabase executa o script inteiro dentro de
-- uma transacao, e o Postgres proibe REFERENCIAR um valor de enum criado na
-- mesma transacao. Se este comando estivesse dentro do 004, todo
-- `cargo = 'super_admin'` de la falharia com:
--     unsafe use of new value "super_admin" of enum type user_role
-- =============================================================================

alter type user_role add value if not exists 'super_admin';

-- Confira antes de seguir para o 004: devem aparecer 5 valores
--   (admin, gerente, corretor, financeiro, super_admin)
--
--   select unnest(enum_range(null::user_role));
