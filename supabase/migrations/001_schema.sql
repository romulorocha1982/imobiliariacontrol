-- =============================================================================
-- IMOBILIARIA CONTROL - Schema principal
-- Execute no Supabase: SQL Editor > New query > cole e RUN
-- =============================================================================

create extension if not exists "uuid-ossp";
create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- TIPOS ENUMERADOS
-- -----------------------------------------------------------------------------
do $$ begin
  create type user_role as enum ('admin', 'gerente', 'corretor', 'financeiro');
exception when duplicate_object then null; end $$;

do $$ begin
  create type imovel_tipo as enum (
    'apartamento','casa','sobrado','kitnet','terreno',
    'sala_comercial','loja','galpao','chacara','sitio','fazenda','outro'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type imovel_finalidade as enum ('venda','locacao','ambos');
exception when duplicate_object then null; end $$;

do $$ begin
  create type imovel_status as enum (
    'disponivel','alugado','vendido','reservado','manutencao','inativo'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type cliente_tipo as enum ('inquilino','comprador','interessado','fiador');
exception when duplicate_object then null; end $$;

do $$ begin
  create type contrato_status as enum ('pendente','ativo','encerrado','rescindido');
exception when duplicate_object then null; end $$;

do $$ begin
  create type garantia_tipo as enum (
    'fiador','caucao','seguro_fianca','titulo_capitalizacao','sem_garantia'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type lancamento_tipo as enum ('receita','despesa');
exception when duplicate_object then null; end $$;

do $$ begin
  create type lancamento_categoria as enum (
    'aluguel','repasse_proprietario','taxa_administracao','comissao_venda',
    'condominio','iptu','manutencao','multa_juros','caucao','venda','outros'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type lancamento_status as enum ('pendente','pago','atrasado','cancelado');
exception when duplicate_object then null; end $$;

do $$ begin
  create type negociacao_etapa as enum (
    'lead','contato','visita','proposta','negociacao','fechado','perdido'
  );
exception when duplicate_object then null; end $$;

-- -----------------------------------------------------------------------------
-- PROFILES (espelha auth.users com cargo e permissoes)
-- -----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null default 'Novo usuario',
  email       text,
  telefone    text,
  creci       text,
  cargo       user_role not null default 'corretor',
  ativo       boolean not null default true,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is 'Usuarios do sistema com cargo e status';

-- -----------------------------------------------------------------------------
-- PROPRIETARIOS
-- -----------------------------------------------------------------------------
create table if not exists public.proprietarios (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  cpf_cnpj     text,
  rg           text,
  email        text,
  telefone     text,
  telefone2    text,
  cep          text,
  logradouro   text,
  numero       text,
  complemento  text,
  bairro       text,
  cidade       text,
  estado       char(2),
  banco        text,
  agencia      text,
  conta        text,
  tipo_conta   text,
  pix          text,
  observacoes  text,
  ativo        boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  created_by   uuid references public.profiles(id) on delete set null
);

create index if not exists idx_proprietarios_nome on public.proprietarios using gin (to_tsvector('portuguese', nome));
create index if not exists idx_proprietarios_cpf on public.proprietarios (cpf_cnpj);

-- -----------------------------------------------------------------------------
-- IMOVEIS
-- -----------------------------------------------------------------------------
create table if not exists public.imoveis (
  id                  uuid primary key default gen_random_uuid(),
  codigo              text unique,
  titulo              text not null,
  tipo                imovel_tipo not null default 'apartamento',
  finalidade          imovel_finalidade not null default 'locacao',
  status              imovel_status not null default 'disponivel',
  proprietario_id     uuid references public.proprietarios(id) on delete set null,
  cep                 text,
  logradouro          text,
  numero              text,
  complemento         text,
  bairro              text,
  cidade              text,
  estado              char(2),
  area_total          numeric(10,2),
  area_util           numeric(10,2),
  quartos             smallint default 0,
  suites              smallint default 0,
  banheiros           smallint default 0,
  vagas               smallint default 0,
  andar               smallint,
  mobiliado           boolean not null default false,
  aceita_pet          boolean not null default false,
  descricao           text,
  valor_venda         numeric(14,2),
  valor_aluguel       numeric(14,2),
  valor_condominio    numeric(14,2) default 0,
  valor_iptu          numeric(14,2) default 0,
  taxa_administracao  numeric(5,2) default 10.00,
  comissao_venda      numeric(5,2) default 6.00,
  matricula           text,
  inscricao_municipal text,
  observacoes         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id) on delete set null
);

create index if not exists idx_imoveis_status on public.imoveis (status);
create index if not exists idx_imoveis_finalidade on public.imoveis (finalidade);
create index if not exists idx_imoveis_tipo on public.imoveis (tipo);
create index if not exists idx_imoveis_proprietario on public.imoveis (proprietario_id);
create index if not exists idx_imoveis_cidade on public.imoveis (cidade, bairro);

-- fotos dos imoveis (arquivos no Supabase Storage)
create table if not exists public.imovel_fotos (
  id         uuid primary key default gen_random_uuid(),
  imovel_id  uuid not null references public.imoveis(id) on delete cascade,
  url        text not null,
  path       text,
  ordem      smallint not null default 0,
  capa       boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists idx_fotos_imovel on public.imovel_fotos (imovel_id, ordem);

-- -----------------------------------------------------------------------------
-- CLIENTES (inquilinos, compradores, interessados, fiadores)
-- -----------------------------------------------------------------------------
create table if not exists public.clientes (
  id               uuid primary key default gen_random_uuid(),
  nome             text not null,
  tipo             cliente_tipo not null default 'interessado',
  cpf_cnpj         text,
  rg               text,
  email            text,
  telefone         text,
  telefone2        text,
  data_nascimento  date,
  estado_civil     text,
  profissao        text,
  renda            numeric(14,2),
  cep              text,
  logradouro       text,
  numero           text,
  complemento      text,
  bairro           text,
  cidade           text,
  estado           char(2),
  observacoes      text,
  ativo            boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  created_by       uuid references public.profiles(id) on delete set null
);

create index if not exists idx_clientes_tipo on public.clientes (tipo);
create index if not exists idx_clientes_cpf on public.clientes (cpf_cnpj);
create index if not exists idx_clientes_nome on public.clientes using gin (to_tsvector('portuguese', nome));

-- -----------------------------------------------------------------------------
-- CONTRATOS DE LOCACAO
-- -----------------------------------------------------------------------------
create table if not exists public.contratos (
  id                  uuid primary key default gen_random_uuid(),
  numero              text unique,
  imovel_id           uuid not null references public.imoveis(id) on delete restrict,
  inquilino_id        uuid not null references public.clientes(id) on delete restrict,
  fiador_id           uuid references public.clientes(id) on delete set null,
  corretor_id         uuid references public.profiles(id) on delete set null,
  data_inicio         date not null,
  data_fim            date not null,
  dia_vencimento      smallint not null default 5 check (dia_vencimento between 1 and 31),
  valor_aluguel       numeric(14,2) not null,
  valor_condominio    numeric(14,2) default 0,
  valor_iptu          numeric(14,2) default 0,
  taxa_administracao  numeric(5,2) not null default 10.00,
  indice_reajuste     text default 'IGPM',
  mes_reajuste        smallint check (mes_reajuste between 1 and 12),
  garantia            garantia_tipo not null default 'fiador',
  valor_caucao        numeric(14,2),
  status              contrato_status not null default 'ativo',
  data_rescisao       date,
  motivo_rescisao     text,
  observacoes         text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  created_by          uuid references public.profiles(id) on delete set null,
  constraint contrato_datas_validas check (data_fim > data_inicio)
);

create index if not exists idx_contratos_status on public.contratos (status);
create index if not exists idx_contratos_imovel on public.contratos (imovel_id);
create index if not exists idx_contratos_inquilino on public.contratos (inquilino_id);
create index if not exists idx_contratos_vencimento on public.contratos (data_fim);

-- -----------------------------------------------------------------------------
-- FINANCEIRO (contas a pagar e a receber)
-- -----------------------------------------------------------------------------
create table if not exists public.lancamentos (
  id              uuid primary key default gen_random_uuid(),
  tipo            lancamento_tipo not null,
  categoria       lancamento_categoria not null default 'outros',
  status          lancamento_status not null default 'pendente',
  descricao       text not null,
  valor           numeric(14,2) not null,
  competencia     date,
  vencimento      date not null,
  data_pagamento  date,
  valor_pago      numeric(14,2),
  forma_pagamento text,
  contrato_id     uuid references public.contratos(id) on delete cascade,
  imovel_id       uuid references public.imoveis(id) on delete set null,
  cliente_id      uuid references public.clientes(id) on delete set null,
  proprietario_id uuid references public.proprietarios(id) on delete set null,
  observacoes     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  created_by      uuid references public.profiles(id) on delete set null
);

create index if not exists idx_lanc_status on public.lancamentos (status);
create index if not exists idx_lanc_vencimento on public.lancamentos (vencimento);
create index if not exists idx_lanc_tipo on public.lancamentos (tipo, categoria);
create index if not exists idx_lanc_contrato on public.lancamentos (contrato_id);
create index if not exists idx_lanc_competencia on public.lancamentos (competencia);

-- -----------------------------------------------------------------------------
-- CRM: NEGOCIACOES (funil)
-- -----------------------------------------------------------------------------
create table if not exists public.negociacoes (
  id                       uuid primary key default gen_random_uuid(),
  cliente_id               uuid not null references public.clientes(id) on delete cascade,
  imovel_id                uuid references public.imoveis(id) on delete set null,
  corretor_id              uuid references public.profiles(id) on delete set null,
  etapa                    negociacao_etapa not null default 'lead',
  valor_proposta           numeric(14,2),
  origem                   text,
  data_prevista_fechamento date,
  motivo_perda             text,
  observacoes              text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  created_by               uuid references public.profiles(id) on delete set null
);

create index if not exists idx_negoc_etapa on public.negociacoes (etapa);
create index if not exists idx_negoc_corretor on public.negociacoes (corretor_id);
create index if not exists idx_negoc_cliente on public.negociacoes (cliente_id);

-- -----------------------------------------------------------------------------
-- VISITAS
-- -----------------------------------------------------------------------------
create table if not exists public.visitas (
  id             uuid primary key default gen_random_uuid(),
  negociacao_id  uuid references public.negociacoes(id) on delete cascade,
  imovel_id      uuid not null references public.imoveis(id) on delete cascade,
  cliente_id     uuid not null references public.clientes(id) on delete cascade,
  corretor_id    uuid references public.profiles(id) on delete set null,
  data_hora      timestamptz not null,
  realizada      boolean not null default false,
  feedback       text,
  created_at     timestamptz not null default now(),
  created_by     uuid references public.profiles(id) on delete set null
);

create index if not exists idx_visitas_data on public.visitas (data_hora);
create index if not exists idx_visitas_corretor on public.visitas (corretor_id);

-- -----------------------------------------------------------------------------
-- AUDITORIA (quem alterou o que, quando)
-- -----------------------------------------------------------------------------
create table if not exists public.auditoria (
  id           bigserial primary key,
  tabela       text not null,
  registro_id  text,
  acao         text not null,
  usuario_id   uuid,
  usuario_nome text,
  dados_antes  jsonb,
  dados_depois jsonb,
  created_at   timestamptz not null default now()
);

create index if not exists idx_auditoria_tabela on public.auditoria (tabela, created_at desc);
create index if not exists idx_auditoria_usuario on public.auditoria (usuario_id, created_at desc);
