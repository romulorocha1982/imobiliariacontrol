-- =============================================================================
-- IMOBILIARIA CONTROL - Row Level Security (permissoes por cargo)
-- Execute DEPOIS de 002_functions.sql
--
-- REGRA GERAL DE CARGOS:
--   admin       -> tudo, inclusive gerenciar usuarios e ver auditoria
--   gerente     -> tudo operacional, sem gerenciar usuarios
--   financeiro  -> le tudo; escreve apenas no modulo financeiro
--   corretor    -> le tudo; escreve imoveis/clientes/CRM; NAO mexe no financeiro
-- =============================================================================

alter table public.profiles      enable row level security;
alter table public.proprietarios enable row level security;
alter table public.imoveis       enable row level security;
alter table public.imovel_fotos  enable row level security;
alter table public.clientes      enable row level security;
alter table public.contratos     enable row level security;
alter table public.lancamentos   enable row level security;
alter table public.negociacoes   enable row level security;
alter table public.visitas       enable row level security;
alter table public.auditoria     enable row level security;

-- -----------------------------------------------------------------------------
-- PROFILES
-- -----------------------------------------------------------------------------
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (true);

drop policy if exists "profiles_update_proprio" on public.profiles;
create policy "profiles_update_proprio" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (id = auth.uid());

drop policy if exists "profiles_admin_all" on public.profiles;
create policy "profiles_admin_all" on public.profiles
  for all to authenticated
  using (public.tem_cargo(array['admin']::user_role[]))
  with check (public.tem_cargo(array['admin']::user_role[]));

-- -----------------------------------------------------------------------------
-- PROPRIETARIOS  (leitura: todos | escrita: admin, gerente, corretor)
-- -----------------------------------------------------------------------------
drop policy if exists "proprietarios_select" on public.proprietarios;
create policy "proprietarios_select" on public.proprietarios
  for select to authenticated using (public.estou_ativo());

drop policy if exists "proprietarios_write" on public.proprietarios;
create policy "proprietarios_write" on public.proprietarios
  for all to authenticated
  using (public.tem_cargo(array['admin','gerente','corretor']::user_role[]))
  with check (public.tem_cargo(array['admin','gerente','corretor']::user_role[]));

-- -----------------------------------------------------------------------------
-- IMOVEIS
-- -----------------------------------------------------------------------------
drop policy if exists "imoveis_select" on public.imoveis;
create policy "imoveis_select" on public.imoveis
  for select to authenticated using (public.estou_ativo());

drop policy if exists "imoveis_write" on public.imoveis;
create policy "imoveis_write" on public.imoveis
  for all to authenticated
  using (public.tem_cargo(array['admin','gerente','corretor']::user_role[]))
  with check (public.tem_cargo(array['admin','gerente','corretor']::user_role[]));

-- FOTOS
drop policy if exists "fotos_select" on public.imovel_fotos;
create policy "fotos_select" on public.imovel_fotos
  for select to authenticated using (public.estou_ativo());

drop policy if exists "fotos_write" on public.imovel_fotos;
create policy "fotos_write" on public.imovel_fotos
  for all to authenticated
  using (public.tem_cargo(array['admin','gerente','corretor']::user_role[]))
  with check (public.tem_cargo(array['admin','gerente','corretor']::user_role[]));

-- -----------------------------------------------------------------------------
-- CLIENTES
-- -----------------------------------------------------------------------------
drop policy if exists "clientes_select" on public.clientes;
create policy "clientes_select" on public.clientes
  for select to authenticated using (public.estou_ativo());

drop policy if exists "clientes_write" on public.clientes;
create policy "clientes_write" on public.clientes
  for all to authenticated
  using (public.tem_cargo(array['admin','gerente','corretor']::user_role[]))
  with check (public.tem_cargo(array['admin','gerente','corretor']::user_role[]));

-- -----------------------------------------------------------------------------
-- CONTRATOS  (escrita restrita: admin, gerente, financeiro)
-- -----------------------------------------------------------------------------
drop policy if exists "contratos_select" on public.contratos;
create policy "contratos_select" on public.contratos
  for select to authenticated using (public.estou_ativo());

drop policy if exists "contratos_write" on public.contratos;
create policy "contratos_write" on public.contratos
  for all to authenticated
  using (public.tem_cargo(array['admin','gerente','financeiro']::user_role[]))
  with check (public.tem_cargo(array['admin','gerente','financeiro']::user_role[]));

-- -----------------------------------------------------------------------------
-- LANCAMENTOS  (dinheiro: so admin, gerente e financeiro escrevem)
-- -----------------------------------------------------------------------------
drop policy if exists "lancamentos_select" on public.lancamentos;
create policy "lancamentos_select" on public.lancamentos
  for select to authenticated using (public.estou_ativo());

drop policy if exists "lancamentos_write" on public.lancamentos;
create policy "lancamentos_write" on public.lancamentos
  for all to authenticated
  using (public.tem_cargo(array['admin','gerente','financeiro']::user_role[]))
  with check (public.tem_cargo(array['admin','gerente','financeiro']::user_role[]));

-- -----------------------------------------------------------------------------
-- NEGOCIACOES (CRM)
-- Corretor enxerga todas, mas so altera as proprias. Admin/gerente alteram tudo.
-- -----------------------------------------------------------------------------
drop policy if exists "negociacoes_select" on public.negociacoes;
create policy "negociacoes_select" on public.negociacoes
  for select to authenticated using (public.estou_ativo());

drop policy if exists "negociacoes_insert" on public.negociacoes;
create policy "negociacoes_insert" on public.negociacoes
  for insert to authenticated
  with check (public.tem_cargo(array['admin','gerente','corretor']::user_role[]));

drop policy if exists "negociacoes_update" on public.negociacoes;
create policy "negociacoes_update" on public.negociacoes
  for update to authenticated
  using (
    public.tem_cargo(array['admin','gerente']::user_role[])
    or (public.tem_cargo(array['corretor']::user_role[]) and corretor_id = auth.uid())
  );

drop policy if exists "negociacoes_delete" on public.negociacoes;
create policy "negociacoes_delete" on public.negociacoes
  for delete to authenticated
  using (
    public.tem_cargo(array['admin','gerente']::user_role[])
    or (public.tem_cargo(array['corretor']::user_role[]) and corretor_id = auth.uid())
  );

-- -----------------------------------------------------------------------------
-- VISITAS
-- -----------------------------------------------------------------------------
drop policy if exists "visitas_select" on public.visitas;
create policy "visitas_select" on public.visitas
  for select to authenticated using (public.estou_ativo());

drop policy if exists "visitas_write" on public.visitas;
create policy "visitas_write" on public.visitas
  for all to authenticated
  using (public.tem_cargo(array['admin','gerente','corretor']::user_role[]))
  with check (public.tem_cargo(array['admin','gerente','corretor']::user_role[]));

-- -----------------------------------------------------------------------------
-- AUDITORIA  (somente leitura, so admin e gerente. Ninguem edita ou apaga.)
-- -----------------------------------------------------------------------------
drop policy if exists "auditoria_select" on public.auditoria;
create policy "auditoria_select" on public.auditoria
  for select to authenticated
  using (public.tem_cargo(array['admin','gerente']::user_role[]));

-- -----------------------------------------------------------------------------
-- STORAGE: bucket publico de fotos dos imoveis
-- -----------------------------------------------------------------------------
insert into storage.buckets (id, name, public)
values ('imoveis', 'imoveis', true)
on conflict (id) do nothing;

drop policy if exists "fotos_leitura_publica" on storage.objects;
create policy "fotos_leitura_publica" on storage.objects
  for select to public
  using (bucket_id = 'imoveis');

drop policy if exists "fotos_upload" on storage.objects;
create policy "fotos_upload" on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'imoveis'
    and public.tem_cargo(array['admin','gerente','corretor']::user_role[])
  );

drop policy if exists "fotos_delete" on storage.objects;
create policy "fotos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'imoveis'
    and public.tem_cargo(array['admin','gerente','corretor']::user_role[])
  );
