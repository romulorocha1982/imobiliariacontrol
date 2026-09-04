-- =============================================================================
-- IMOBILIARIA CONTROL - Documentos anexados
-- Execute DEPOIS de 005_integridade_tenant.sql
--
-- Uma tabela so para todo arquivo que nao e foto de anuncio: vistoria, contrato
-- assinado, aditivo, identidade, comprovante de renda, matricula. O arquivo em
-- si vive no bucket privado `documentos`, criado no 004; aqui ficam os metadados
-- e o vinculo com o registro.
--
-- Foto de anuncio NAO passa por aqui: continua em `imovel_fotos`, no bucket
-- publico `imoveis`. Sao coisas diferentes - uma e vitrine, a outra e prova.
--
-- Idempotente: pode rodar de novo sem quebrar.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- A TABELA
--
-- `tipo` e text com check, e nao enum, de proposito. Adicionar valor a um enum
-- no Postgres exige transacao separada (foi o que obrigou a existir o
-- 004a_enum.sql). Tipo de documento e uma lista que vai crescer com o uso; com
-- check basta um `alter table ... drop constraint / add constraint` num arquivo
-- so.
-- -----------------------------------------------------------------------------
create table if not exists public.documentos (
  id             uuid primary key default gen_random_uuid(),
  imobiliaria_id uuid not null references public.imobiliarias(id) on delete cascade,

  tipo           text not null default 'outro',
  titulo         text,
  observacoes    text,

  -- Onde o arquivo esta no bucket `documentos`. Unico porque dois registros
  -- apontando para o mesmo objeto fariam a exclusao de um apagar o arquivo do
  -- outro.
  path           text not null unique,
  nome_arquivo   text not null,
  mime           text,
  tamanho        bigint,

  -- O vinculo. Tres colunas anulaveis em vez de um par (entidade, entidade_id)
  -- generico: assim cada uma e uma FK de verdade, o banco garante que o
  -- registro existe, e o 005 consegue amarrar tambem a imobiliaria.
  imovel_id      uuid references public.imoveis(id)    on delete cascade,
  contrato_id    uuid references public.contratos(id)  on delete cascade,
  cliente_id     uuid references public.clientes(id)   on delete cascade,

  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id) on delete set null
);

alter table public.documentos alter column created_by set default auth.uid();

do $$
begin
  alter table public.documentos add constraint documentos_tipo_valido check (
    tipo in ('vistoria','contrato_assinado','aditivo','identidade',
             'comprovante_renda','matricula','outro')
  );
exception when duplicate_object then null;
end;
$$;

-- Exatamente um vinculo. Sem isso um documento poderia ficar solto (invisivel
-- em todas as telas) ou pendurado em dois lugares ao mesmo tempo.
do $$
begin
  alter table public.documentos add constraint documentos_um_vinculo check (
    (imovel_id   is not null)::int +
    (contrato_id is not null)::int +
    (cliente_id  is not null)::int = 1
  );
exception when duplicate_object then null;
end;
$$;

create index if not exists idx_documentos_imovel
  on public.documentos (imobiliaria_id, imovel_id)   where imovel_id   is not null;
create index if not exists idx_documentos_contrato
  on public.documentos (imobiliaria_id, contrato_id) where contrato_id is not null;
create index if not exists idx_documentos_cliente
  on public.documentos (imobiliaria_id, cliente_id)  where cliente_id  is not null;
create index if not exists idx_documentos_tipo
  on public.documentos (imobiliaria_id, tipo);

comment on table public.documentos is
  'Arquivos anexados a imovel, contrato ou cliente. Binario no bucket privado documentos';


-- -----------------------------------------------------------------------------
-- INTEGRIDADE DE TENANT - mesma ideia do 005
--
-- A FK simples acima garante que o imovel existe. Estas garantem que ele e da
-- MESMA imobiliaria do documento - sem isso, um insert malicioso poderia
-- pendurar um arquivo no imovel de outro cliente.
--
-- MATCH SIMPLE: como duas das tres colunas sao sempre NULL, a restricao delas
-- fica satisfeita automaticamente. So a que estiver preenchida e verificada.
-- -----------------------------------------------------------------------------
do $$
declare
  r  text[];
  rs text[][] := array[
    array['imovel_id',   'imoveis'],
    array['contrato_id', 'contratos'],
    array['cliente_id',  'clientes']
  ];
begin
  foreach r slice 1 in array rs
  loop
    begin
      execute format(
        'alter table public.documentos add constraint %I
           foreign key (%I, imobiliaria_id)
           references public.%I (id, imobiliaria_id)
           on delete no action
           deferrable initially deferred',
        'documentos_' || r[1] || '_tenant', r[1], r[2]);
    exception when duplicate_object then null;
    end;
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
-- RLS
--
-- Leitura para qualquer usuario ativo da imobiliaria; escrita para admin,
-- gerente e financeiro. Os cargos da escrita sao os MESMOS da policy
-- `documentos_escrever` do Storage, criada no 004 - se divergissem, um corretor
-- criaria a linha e o upload do arquivo falharia depois, deixando registro
-- apontando para arquivo inexistente.
-- -----------------------------------------------------------------------------
alter table public.documentos enable row level security;

drop policy if exists "documentos_select" on public.documentos;
create policy "documentos_select" on public.documentos
  for select to authenticated
  using (public.estou_ativo() and imobiliaria_id = (select public.minha_imobiliaria()));

drop policy if exists "documentos_write" on public.documentos;
create policy "documentos_write" on public.documentos
  for all to authenticated
  using (
    public.tem_cargo(array['admin','gerente','financeiro']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  )
  with check (
    public.tem_cargo(array['admin','gerente','financeiro']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  );


-- =============================================================================
-- VERIFICACAO - rode depois, num editor separado
--
--   select count(*) as constraints_tenant from pg_constraint
--    where conrelid = 'public.documentos'::regclass and right(conname,7) = '_tenant';
--   -- esperado: 3
--
--   select policyname from pg_policies
--    where schemaname = 'public' and tablename = 'documentos';
--   -- esperado: documentos_select, documentos_write
-- =============================================================================
