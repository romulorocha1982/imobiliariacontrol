-- =============================================================================
-- IMOBILIARIA CONTROL - Modelos de contrato
-- Execute DEPOIS de 008_resultado_imovel.sql
--
-- O sistema ja sabe tudo que um contrato de locacao precisa dizer -- nome e CPF
-- do inquilino, endereco do imovel, valor, vigencia, reajuste, garantia -- e
-- mesmo assim o contrato era redigido fora, no editor de texto. Este e o comeco
-- da geracao dentro do sistema.
--
-- CLAUSULAS EM JSONB, e nao uma tabela filha `clausulas`:
--
-- A ordem importa e muda o tempo todo (arrastar a clausula 7 para o 3), e um
-- array ja e ordenado -- com tabela filha seria uma coluna `ordem` e um punhado
-- de updates a cada arrastada. Alem disso a clausula nunca e consultada
-- isoladamente: ou se le o modelo inteiro, ou nada. Nao ha o que ganhar
-- normalizando.
--
-- MARCADORES: o texto usa {{inquilino.nome}}, {{imovel.endereco}} e afins,
-- resolvidos na hora de gerar. O modelo guarda o marcador, nunca o valor -- um
-- modelo com valor gravado deixaria de servir para o proximo contrato.
--
-- Idempotente.
-- =============================================================================

create table if not exists public.modelos_contrato (
  id             uuid primary key default gen_random_uuid(),
  imobiliaria_id uuid not null references public.imobiliarias(id) on delete cascade,

  nome           text not null,
  tipo           text not null default 'locacao_residencial',

  -- Texto antes das clausulas: qualificacao das partes, objeto.
  cabecalho      text,

  -- [{ "titulo": "DO PRAZO", "texto": "A locacao vigora de {{contrato.inicio}}..." }]
  clausulas      jsonb not null default '[]'::jsonb,

  -- Fecho: foro, local e data, linhas de assinatura.
  rodape         text,

  -- O que a tela sugere ao gerar um contrato novo. Um por imobiliaria, garantido
  -- pelo indice unico parcial mais abaixo.
  padrao         boolean not null default false,
  ativo          boolean not null default true,

  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id) on delete set null
);

alter table public.modelos_contrato alter column created_by set default auth.uid();

do $$
begin
  alter table public.modelos_contrato add constraint modelos_tipo_valido check (
    tipo in ('locacao_residencial','locacao_comercial','venda','outro')
  );
exception when duplicate_object then null;
end;
$$;

-- `clausulas` precisa ser um array de objetos. Sem isto, um `{}` ou um numero
-- entrariam e a tela quebraria so na hora de gerar o contrato.
do $$
begin
  alter table public.modelos_contrato add constraint modelos_clausulas_array check (
    jsonb_typeof(clausulas) = 'array'
  );
exception when duplicate_object then null;
end;
$$;

-- Um padrao por imobiliaria. Indice parcial em vez de constraint porque so as
-- linhas com padrao = true concorrem entre si.
create unique index if not exists uq_modelo_padrao_por_tenant
  on public.modelos_contrato (imobiliaria_id) where padrao;

create index if not exists idx_modelos_tenant
  on public.modelos_contrato (imobiliaria_id, ativo);

comment on table public.modelos_contrato is
  'Modelos de contrato com clausulas editaveis. O texto guarda marcadores {{...}}, resolvidos na geracao';


-- -----------------------------------------------------------------------------
-- updated_at
-- O loop do 002_functions.sql ja carimba as tabelas que existiam na epoca;
-- esta nasceu depois, entao ganha o trigger aqui, reusando a mesma funcao.
-- -----------------------------------------------------------------------------
drop trigger if exists trg_updated_at on public.modelos_contrato;
create trigger trg_updated_at before update on public.modelos_contrato
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- RLS
--
-- Leitura para qualquer usuario ativo: corretor precisa consultar a minuta que
-- vai apresentar. Escrita para admin e gerente -- mexer em clausula e decisao
-- juridica da imobiliaria, nao operacao de rotina.
-- -----------------------------------------------------------------------------
alter table public.modelos_contrato enable row level security;

drop policy if exists "modelos_select" on public.modelos_contrato;
create policy "modelos_select" on public.modelos_contrato
  for select to authenticated
  using (public.estou_ativo() and imobiliaria_id = (select public.minha_imobiliaria()));

drop policy if exists "modelos_write" on public.modelos_contrato;
create policy "modelos_write" on public.modelos_contrato
  for all to authenticated
  using (
    public.tem_cargo(array['admin','gerente']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  )
  with check (
    public.tem_cargo(array['admin','gerente']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  );


-- =============================================================================
-- VERIFICACAO
--
--   select policyname from pg_policies
--    where schemaname = 'public' and tablename = 'modelos_contrato';
--   -- esperado: modelos_select, modelos_write
--
--   select conname from pg_constraint
--    where conrelid = 'public.modelos_contrato'::regclass and contype = 'c';
--   -- esperado: modelos_tipo_valido, modelos_clausulas_array
-- =============================================================================
