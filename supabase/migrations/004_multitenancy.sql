-- =============================================================================
-- IMOBILIARIA CONTROL - Multi-tenancy
-- Execute DEPOIS de 004a_enum.sql (que roda sozinho)
--
-- O QUE ESTE ARQUIVO FAZ
--   Cada linha do banco passa a pertencer a uma imobiliaria, e o Postgres passa
--   a recusar as demais na propria RLS. O isolamento vale para qualquer caminho
--   de acesso - site, Postman ou a anon key que esta publica no bundle.
--
-- ALEM DISSO, CORRIGE TRES FALHAS QUE JA EXISTEM HOJE
--   1. As 3 views ignoram a RLS (criadas sem security_invoker) - e sao elas que
--      Imoveis, Contratos, Financeiro e Dashboard leem.
--   2. dashboard_resumo/marcar_atrasados/baixar_lancamento sao SECURITY DEFINER
--      sem filtro nenhum.
--   3. profiles_select usa `using (true)` e profiles_update_proprio deixa o
--      usuario editar o proprio cargo e se promover a admin.
--
-- SEGURO DE RODAR COM O SITE NO AR: o passo (l) define
-- `default public.minha_imobiliaria()` nas colunas novas, entao o front que ja
-- esta publicado continua inserindo corretamente ate o deploy do codigo novo.
--
-- Tudo idempotente: pode rodar de novo sem quebrar.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- (0) SNAPSHOT REVERSIVEL
-- Copia das 10 tabelas dentro do proprio banco. Se algo sair errado, restaurar
-- e `truncate` + `insert ... select` - segundos, sem depender do suporte.
-- Faca TAMBEM o backup pelo painel: Database > Backups.
-- -----------------------------------------------------------------------------
create schema if not exists backup_pre_mt;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','proprietarios','imoveis','imovel_fotos','clientes',
    'contratos','lancamentos','negociacoes','visitas','auditoria'
  ]
  loop
    execute format(
      'create table if not exists backup_pre_mt.%I as table public.%I', t, t);
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
-- (a) ESTRUTURA NOVA
-- -----------------------------------------------------------------------------
create table if not exists public.imobiliarias (
  id           uuid primary key default gen_random_uuid(),
  nome         text not null,
  razao_social text,
  cpf_cnpj     text,
  codigo       char(6) not null unique check (codigo ~ '^[0-9]{6}$'),
  email        text,
  telefone     text,
  cidade       text,
  estado       char(2),
  plano        text not null default 'basico',
  ativa        boolean not null default true,
  observacoes  text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists idx_imobiliarias_ativa on public.imobiliarias (ativa);

alter table public.imobiliarias enable row level security;

-- Codigo de acesso de 6 digitos.
--
-- A entropia vem de gen_random_uuid(), e nao de random(): o codigo e credencial
-- de cadastro e precisa ser imprevisivel. gen_random_uuid() e do proprio nucleo
-- do Postgres (13+) e usa gerador criptografico.
--
-- Nao usar gen_random_bytes() do pgcrypto aqui: no Supabase as extensoes ficam
-- no schema `extensions`, invisivel para o `set search_path = public` que estas
-- funcoes precisam ter. Daria "function gen_random_bytes(integer) does not exist"
-- so na hora de criar a primeira imobiliaria.
--
-- Faixa 100000..999999 - nunca comeca com zero, que some ao colar em planilha.
create or replace function public.gerar_codigo_imobiliaria()
returns char(6)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_codigo char(6);
  v_i      int := 0;
begin
  loop
    v_i := v_i + 1;
    v_codigo := lpad(
      ((('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint
        & 2147483647) % 900000 + 100000)::text, 6, '0');
    exit when not exists (select 1 from public.imobiliarias where codigo = v_codigo);
    if v_i > 50 then
      raise exception 'Nao foi possivel gerar um codigo de acesso unico';
    end if;
  end loop;
  return v_codigo;
end;
$$;

create or replace function public.trg_codigo_imobiliaria()
returns trigger
language plpgsql
as $$
begin
  if new.codigo is null or new.codigo = '' then
    new.codigo := public.gerar_codigo_imobiliaria();
  end if;
  return new;
end;
$$;

drop trigger if exists trg_codigo on public.imobiliarias;
create trigger trg_codigo before insert on public.imobiliarias
  for each row execute function public.trg_codigo_imobiliaria();

-- Contador por imobiliaria. Substitui as sequences globais: sem isso, A receberia
-- IM-0001/IM-0002 e B comecaria em IM-0003.
create table if not exists public.contadores (
  imobiliaria_id uuid   not null references public.imobiliarias(id) on delete cascade,
  escopo         text   not null,           -- 'imovel' | 'contrato:2026'
  valor          bigint not null default 0,
  primary key (imobiliaria_id, escopo)
);

-- RLS ligada e NENHUMA policy: so funcao security definer entra aqui.
alter table public.contadores enable row level security;

-- `insert ... on conflict do update ... returning` e atomico em um unico
-- statement: o do update pega row lock na linha do contador e a transacao
-- concorrente espera o commit. Vantagem sobre nextval: e transacional, entao um
-- rollback DEVOLVE o numero - a numeracao de contrato nao fica com buracos, o
-- que importa num documento juridico.
create or replace function public.proximo_numero(p_imobiliaria uuid, p_escopo text)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare v bigint;
begin
  insert into public.contadores (imobiliaria_id, escopo, valor)
  values (p_imobiliaria, p_escopo, 1)
  on conflict (imobiliaria_id, escopo)
    do update set valor = public.contadores.valor + 1
  returning valor into v;
  return v;
end;
$$;

revoke execute on function public.proximo_numero(uuid, text) from public;
revoke execute on function public.proximo_numero(uuid, text) from anon;
revoke execute on function public.proximo_numero(uuid, text) from authenticated;

-- updated_at tambem na tabela nova (mesmo trigger do 002)
drop trigger if exists trg_updated_at on public.imobiliarias;
create trigger trg_updated_at before update on public.imobiliarias
  for each row execute function public.set_updated_at();


-- -----------------------------------------------------------------------------
-- (b) A MATRIZ - recebe todos os dados que ja existem
-- Renomeie depois pela tela do super admin.
-- -----------------------------------------------------------------------------
insert into public.imobiliarias (nome, razao_social, ativa, plano, observacoes)
select 'Matriz', 'Matriz', true, 'basico',
       'Criada pela migracao 004 para receber os dados anteriores ao multi-tenancy'
where not exists (select 1 from public.imobiliarias);


-- -----------------------------------------------------------------------------
-- (c) COLUNAS - nullable primeiro, para nao quebrar as linhas existentes
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','proprietarios','imoveis','imovel_fotos','clientes',
    'contratos','lancamentos','negociacoes','visitas','auditoria'
  ]
  loop
    execute format(
      'alter table public.%I add column if not exists imobiliaria_id uuid', t);
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
-- (d) BACKFILL - tudo que existe hoje vai para a Matriz
-- -----------------------------------------------------------------------------
do $$
declare
  v_matriz uuid;
  t        text;
begin
  select id into v_matriz from public.imobiliarias order by created_at limit 1;

  foreach t in array array[
    'profiles','proprietarios','imoveis','imovel_fotos','clientes',
    'contratos','lancamentos','negociacoes','visitas','auditoria'
  ]
  loop
    execute format(
      'update public.%I set imobiliaria_id = $1 where imobiliaria_id is null', t)
      using v_matriz;
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
-- (e) NOT NULL + CHAVES ESTRANGEIRAS
--
-- `on delete cascade` existe para purge de LGPD, nao para o dia a dia: nao ha
-- nenhuma policy de DELETE em imobiliarias. A tela so ativa/desativa; apagar de
-- verdade e operacao manual aqui no SQL Editor.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'proprietarios','imoveis','imovel_fotos','clientes',
    'contratos','lancamentos','negociacoes','visitas','auditoria'
  ]
  loop
    execute format(
      'alter table public.%I alter column imobiliaria_id set not null', t);

    begin
      execute format(
        'alter table public.%I add constraint %I foreign key (imobiliaria_id)
           references public.imobiliarias(id) on delete cascade',
        t, t || '_imobiliaria_id_fkey');
    exception when duplicate_object then null;
    end;
  end loop;
end;
$$;

-- profiles e a excecao: nullable, porque o super admin NAO pertence a nenhuma
-- imobiliaria. E o `restrict` impede apagar uma imobiliaria que ainda tem gente.
do $$
begin
  alter table public.profiles add constraint profiles_imobiliaria_id_fkey
    foreign key (imobiliaria_id) references public.imobiliarias(id) on delete restrict;
exception when duplicate_object then null;
end;
$$;

-- NULL so e permitido para super_admin; todo o resto obrigatoriamente tem tenant.
do $$
begin
  alter table public.profiles add constraint profiles_tenant_coerente check (
    (cargo =  'super_admin' and imobiliaria_id is null) or
    (cargo <> 'super_admin' and imobiliaria_id is not null)
  );
exception when duplicate_object then null;
end;
$$;


-- -----------------------------------------------------------------------------
-- (f) INDICES - todo predicado passa a comecar por imobiliaria_id
-- Os GIN de nome do 001 ficam como estao: a busca e feita no cliente.
-- -----------------------------------------------------------------------------
create index if not exists idx_profiles_tenant      on public.profiles      (imobiliaria_id);
create index if not exists idx_imoveis_tenant_criado on public.imoveis      (imobiliaria_id, created_at desc);
create index if not exists idx_imoveis_tenant_status on public.imoveis      (imobiliaria_id, status);
create index if not exists idx_proprietarios_tenant  on public.proprietarios (imobiliaria_id, ativo);
create index if not exists idx_clientes_tenant       on public.clientes      (imobiliaria_id, ativo);
create index if not exists idx_contratos_tenant_status on public.contratos   (imobiliaria_id, status);
create index if not exists idx_contratos_tenant_fim  on public.contratos     (imobiliaria_id, data_fim);
create index if not exists idx_lanc_tenant_venc      on public.lancamentos   (imobiliaria_id, vencimento desc);
create index if not exists idx_lanc_tenant_status    on public.lancamentos   (imobiliaria_id, status, tipo);
create index if not exists idx_lanc_tenant_comp      on public.lancamentos   (imobiliaria_id, competencia);
create index if not exists idx_negoc_tenant_etapa    on public.negociacoes   (imobiliaria_id, etapa);
create index if not exists idx_visitas_tenant_data   on public.visitas       (imobiliaria_id, data_hora);
create index if not exists idx_fotos_tenant          on public.imovel_fotos  (imobiliaria_id);
create index if not exists idx_auditoria_tenant      on public.auditoria     (imobiliaria_id, created_at desc);


-- -----------------------------------------------------------------------------
-- (g) NUMERACAO POR IMOBILIARIA
-- codigo e numero eram UNIQUE GLOBAL. Agora sao unicos dentro de cada tenant.
-- -----------------------------------------------------------------------------
alter table public.imoveis   drop constraint if exists imoveis_codigo_key;
alter table public.contratos drop constraint if exists contratos_numero_key;

create unique index if not exists uq_imoveis_tenant_codigo
  on public.imoveis (imobiliaria_id, codigo) where codigo is not null;
create unique index if not exists uq_contratos_tenant_numero
  on public.contratos (imobiliaria_id, numero) where numero is not null;

-- Seed: o contador continua de onde a sequence global parou, por tenant.
insert into public.contadores (imobiliaria_id, escopo, valor)
select imobiliaria_id, 'imovel',
       coalesce(max(nullif(regexp_replace(codigo, '\D', '', 'g'), ''))::bigint, 0)
  from public.imoveis
 where codigo like 'IM-%'
 group by imobiliaria_id
on conflict (imobiliaria_id, escopo)
  do update set valor = greatest(public.contadores.valor, excluded.valor);

insert into public.contadores (imobiliaria_id, escopo, valor)
select imobiliaria_id, 'contrato:' || split_part(numero, '-', 2),
       coalesce(max(nullif(split_part(numero, '-', 3), ''))::bigint, 0)
  from public.contratos
 where numero like 'CT-%-%'
 group by imobiliaria_id, split_part(numero, '-', 2)
on conflict (imobiliaria_id, escopo)
  do update set valor = greatest(public.contadores.valor, excluded.valor);


-- -----------------------------------------------------------------------------
-- (h1) HELPERS DE TENANT
-- Mesmo padrao `stable security definer` de meu_cargo()/tem_cargo() no 002 - e
-- isso que evita recursao infinita da RLS ao ler profiles dentro de uma policy.
-- -----------------------------------------------------------------------------

-- ATENCAO as duas funcoes parecidas abaixo. A diferenca importa:
--
--   minha_imobiliaria()        -> tenant EFETIVO. E a base de TODAS as policies.
--                                 Devolve NULL se o usuario esta inativo, se a
--                                 imobiliaria esta suspensa, ou se e super_admin.
--   meu_vinculo_imobiliaria()  -> vinculo CRU, ignora suspensao. Usado SO na
--                                 policy da tabela imobiliarias, para o usuario
--                                 de um tenant suspenso conseguir ler
--                                 `ativa = false` e ver a tela certa em vez de
--                                 listas vazias sem explicacao.

-- Por que o gate de `ativa` mora aqui dentro: suspender um cliente passa a valer
-- em todas as ~40 policies de uma vez, sem depender de logout. Checar so no
-- login nao bastaria - o refresh token dura meses.
create or replace function public.minha_imobiliaria()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select p.imobiliaria_id
    from public.profiles p
    join public.imobiliarias im on im.id = p.imobiliaria_id
   where p.id = auth.uid()
     and p.ativo
     and im.ativa;
$$;

create or replace function public.meu_vinculo_imobiliaria()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select imobiliaria_id from public.profiles where id = auth.uid();
$$;

create or replace function public.sou_super_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select ativo and cargo = 'super_admin' from public.profiles where id = auth.uid()),
    false);
$$;


-- -----------------------------------------------------------------------------
-- (h2) GERADORES DE CODIGO - agora por imobiliaria
-- Viraram security definer porque escrevem em contadores, que tem RLS sem policy.
-- -----------------------------------------------------------------------------
create or replace function public.gerar_codigo_imovel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.imobiliaria_id is null then
    raise exception 'Imovel sem imobiliaria definida';
  end if;
  if new.codigo is null or new.codigo = '' then
    new.codigo := 'IM-' || lpad(
      public.proximo_numero(new.imobiliaria_id, 'imovel')::text, 4, '0');
  end if;
  return new;
end;
$$;

create or replace function public.gerar_numero_contrato()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_ano text := to_char(now(), 'YYYY');
begin
  if new.imobiliaria_id is null then
    raise exception 'Contrato sem imobiliaria definida';
  end if;
  if new.numero is null or new.numero = '' then
    new.numero := 'CT-' || v_ano || '-' || lpad(
      public.proximo_numero(new.imobiliaria_id, 'contrato:' || v_ano)::text, 4, '0');
  end if;
  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- (h3) AUDITORIA - passa a gravar de qual imobiliaria e o registro
-- -----------------------------------------------------------------------------
create or replace function public.fn_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome   text;
  v_tenant uuid;
begin
  select nome into v_nome from public.profiles where id = auth.uid();

  -- Cada ramo escreve o proprio insert: misturar old/new num `case` da problema
  -- de rowtype no plpgsql.
  if tg_op = 'DELETE' then
    v_tenant := coalesce((to_jsonb(old) ->> 'imobiliaria_id')::uuid,
                         public.minha_imobiliaria());
    insert into public.auditoria
      (imobiliaria_id, tabela, registro_id, acao, usuario_id, usuario_nome, dados_antes)
    values
      (v_tenant, tg_table_name, old.id::text, tg_op, auth.uid(), v_nome, to_jsonb(old));
    return old;
  end if;

  v_tenant := coalesce((to_jsonb(new) ->> 'imobiliaria_id')::uuid,
                       public.minha_imobiliaria());

  if tg_op = 'UPDATE' then
    -- so registra se algo realmente mudou (ignora o proprio updated_at)
    if to_jsonb(old) - 'updated_at' is distinct from to_jsonb(new) - 'updated_at' then
      insert into public.auditoria
        (imobiliaria_id, tabela, registro_id, acao, usuario_id, usuario_nome,
         dados_antes, dados_depois)
      values
        (v_tenant, tg_table_name, new.id::text, tg_op, auth.uid(), v_nome,
         to_jsonb(old), to_jsonb(new));
    end if;
  else
    insert into public.auditoria
      (imobiliaria_id, tabela, registro_id, acao, usuario_id, usuario_nome, dados_depois)
    values
      (v_tenant, tg_table_name, new.id::text, tg_op, auth.uid(), v_nome, to_jsonb(new));
  end if;

  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- (h4) CRIACAO DE USUARIO - a trava de servidor
--
-- Regra de ouro: a trigger NUNCA confia no `cargo` do metadata. Hoje ela aceita
-- raw_user_meta_data->>'cargo', que e auto-declarado pelo cliente - qualquer um
-- com a anon key se cadastraria como admin. Agora cria sempre como corretor;
-- quem define o cargo real e a Edge Function, com service_role, num UPDATE
-- posterior.
--
-- PASSO OBRIGATORIO NO PAINEL, e a PRIMEIRA linha de defesa:
--   Authentication > Providers > Email > desmarcar "Enable Sign Ups".
-- A anon key e publica e esta no bundle do site.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_tenant uuid;
begin
  -- Super admin: criado a mao no painel Auth > Add user, com
  -- User Metadata = {"nome": "...", "super_admin": "true"}
  if coalesce(new.raw_user_meta_data ->> 'super_admin', '') = 'true' then
    insert into public.profiles (id, nome, email, cargo, ativo, imobiliaria_id)
    values (
      new.id,
      coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)),
      new.email, 'super_admin', true, null
    )
    on conflict (id) do nothing;
    return new;
  end if;

  v_tenant := nullif(new.raw_user_meta_data ->> 'imobiliaria_id', '')::uuid;

  -- Segunda barreira: alem do tenant, o codigo de 6 digitos tem que bater.
  -- Mesmo que o signup publico volte a ser ligado por engano, ninguem entra
  -- sem conhecer o codigo de uma imobiliaria ativa.
  if v_tenant is null
     or not exists (
       select 1 from public.imobiliarias
        where id = v_tenant
          and ativa
          and codigo = nullif(new.raw_user_meta_data ->> 'codigo_acesso', '')
     ) then
    -- raise em trigger `after insert on auth.users` aborta a criacao inteira
    raise exception 'Cadastro invalido: informe o codigo de acesso de uma imobiliaria ativa.'
      using errcode = 'check_violation';
  end if;

  insert into public.profiles (id, nome, email, telefone, cargo, ativo, imobiliaria_id)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'telefone',
    'corretor',                      -- NUNCA vem do metadata
    true,
    v_tenant
  )
  on conflict (id) do nothing;

  return new;
end;
$$;


-- -----------------------------------------------------------------------------
-- (h5) PROTECAO DO PROFILE
-- Reforca em trigger o que a policy ja barra, com mensagem clara, e cobre o que
-- policy nenhuma consegue: nunca deixar a imobiliaria sem administrador ativo.
-- -----------------------------------------------------------------------------
create or replace function public.fn_proteger_profile()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- service_role (Edge Function) e o SQL Editor passam direto: auth.uid() e NULL.
  -- Sem esta linha, o UPDATE de cargo que a Edge Function faz logo apos criar o
  -- usuario seria bloqueado por ela mesma.
  if auth.uid() is null then
    return new;
  end if;

  if new.imobiliaria_id is distinct from old.imobiliaria_id then
    raise exception 'Nao e permitido mover um usuario de imobiliaria';
  end if;

  if new.id = auth.uid() and new.cargo is distinct from old.cargo then
    raise exception 'Voce nao pode alterar o proprio cargo';
  end if;

  if (new.cargo is distinct from old.cargo or new.ativo is distinct from old.ativo)
     and not (public.tem_cargo(array['admin']::user_role[]) or public.sou_super_admin()) then
    raise exception 'Somente um administrador pode alterar cargo ou situacao';
  end if;

  if old.cargo = 'admin' and old.ativo
     and (new.cargo <> 'admin' or not new.ativo)
     and not exists (
       select 1 from public.profiles
        where imobiliaria_id = old.imobiliaria_id
          and cargo = 'admin' and ativo and id <> old.id
     ) then
    raise exception 'A imobiliaria ficaria sem nenhum administrador ativo';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_proteger_profile on public.profiles;
create trigger trg_proteger_profile before update on public.profiles
  for each row execute function public.fn_proteger_profile();


-- -----------------------------------------------------------------------------
-- (h6) REGRAS DE NEGOCIO COM ESCOPO DE TENANT
--
-- Criterio para SECURITY DEFINER: manter so onde a funcao precisa escrever numa
-- tabela que o chamador legitimamente nao pode escrever. Fora disso, remover -
-- ai a RLS e a unica fonte de verdade e e impossivel esquecer um filtro.
-- -----------------------------------------------------------------------------

-- Sincroniza o status do imovel. Ganha o filtro de tenant por seguranca, ainda
-- que a FK composta do 005 ja garanta contrato e imovel na mesma imobiliaria.
create or replace function public.fn_sincronizar_status_imovel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ativo' then
    update public.imoveis set status = 'alugado'
     where id = new.imovel_id and imobiliaria_id = new.imobiliaria_id;
  elsif new.status in ('encerrado','rescindido') then
    update public.imoveis set status = 'disponivel'
     where id = new.imovel_id
       and imobiliaria_id = new.imobiliaria_id
       and not exists (
         select 1 from public.contratos
          where imovel_id = new.imovel_id
            and imobiliaria_id = new.imobiliaria_id
            and status = 'ativo' and id <> new.id
       );
  end if;
  return new;
end;
$$;

-- MANTEM definer: precisa rodar para corretor, que nao tem update em lancamentos.
-- Antes era um UPDATE GLOBAL sem where de tenant, disparado no boot do Dashboard
-- por qualquer usuario - reescrevia o status financeiro de todas as imobiliarias.
create or replace function public.marcar_atrasados()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_qtd    integer;
  v_tenant uuid;
begin
  v_tenant := public.minha_imobiliaria();
  if v_tenant is null then
    return 0;                       -- super admin, inativo ou tenant suspenso
  end if;

  update public.lancamentos
     set status = 'atrasado'
   where imobiliaria_id = v_tenant
     and status = 'pendente'
     and vencimento < current_date;

  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

-- PERDE o definer: lancamentos_write ja exige cargo E tenant, entao a RLS
-- resolve sozinha. O IDOR (baixar lancamento de outra imobiliaria pelo id)
-- morre junto, sem precisar de checagem manual.
create or replace function public.baixar_lancamento(
  p_id     uuid,
  p_valor  numeric default null,
  p_data   date default current_date,
  p_forma  text default null
)
returns void
language plpgsql
set search_path = public
as $$
declare v_afetadas int;
begin
  update public.lancamentos
     set status          = 'pago',
         valor_pago      = coalesce(p_valor, valor),
         data_pagamento  = p_data,
         forma_pagamento = coalesce(p_forma, forma_pagamento)
   where id = p_id;

  get diagnostics v_afetadas = row_count;
  if v_afetadas = 0 then
    -- mensagem generica de proposito: nao revela se o id existe em outro tenant
    raise exception 'Lancamento nao encontrado ou sem permissao';
  end if;
end;
$$;

-- MANTEM definer (insere em lote), mas ganha gate de cargo e filtro de tenant
-- em todos os selects, nos not exists e nos 3 inserts.
create or replace function public.gerar_parcelas_contrato(p_contrato_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c              record;
  v_tenant       uuid;
  v_competencia  date;
  v_vencimento   date;
  v_total        numeric(14,2);
  v_taxa         numeric(14,2);
  v_repasse      numeric(14,2);
  v_criadas      integer := 0;
  v_proprietario uuid;
begin
  v_tenant := public.minha_imobiliaria();
  if v_tenant is null
     or not public.tem_cargo(array['admin','gerente','financeiro']::user_role[]) then
    raise exception 'Sem permissao para gerar parcelas';
  end if;

  select * into c from public.contratos
   where id = p_contrato_id and imobiliaria_id = v_tenant;
  if not found then
    raise exception 'Contrato nao encontrado';
  end if;

  select proprietario_id into v_proprietario from public.imoveis
   where id = c.imovel_id and imobiliaria_id = v_tenant;

  v_total   := coalesce(c.valor_aluguel,0) + coalesce(c.valor_condominio,0) + coalesce(c.valor_iptu,0);
  v_taxa    := round(coalesce(c.valor_aluguel,0) * coalesce(c.taxa_administracao,0) / 100.0, 2);
  v_repasse := coalesce(c.valor_aluguel,0) - v_taxa;

  v_competencia := date_trunc('month', c.data_inicio)::date;

  while v_competencia <= c.data_fim loop
    v_vencimento := v_competencia + (least(
      c.dia_vencimento,
      extract(day from (date_trunc('month', v_competencia) + interval '1 month - 1 day'))::int
    ) - 1);

    -- 1) aluguel a receber do inquilino
    if not exists (
      select 1 from public.lancamentos
      where imobiliaria_id = v_tenant and contrato_id = c.id
        and categoria = 'aluguel' and competencia = v_competencia
    ) then
      insert into public.lancamentos
        (imobiliaria_id, tipo, categoria, status, descricao, valor, competencia, vencimento,
         contrato_id, imovel_id, cliente_id, proprietario_id)
      values
        (v_tenant, 'receita','aluguel','pendente',
         'Aluguel ' || to_char(v_competencia,'MM/YYYY') || ' - contrato ' || coalesce(c.numero,''),
         v_total, v_competencia, v_vencimento,
         c.id, c.imovel_id, c.inquilino_id, v_proprietario);
      v_criadas := v_criadas + 1;
    end if;

    -- 2) repasse ao proprietario
    if not exists (
      select 1 from public.lancamentos
      where imobiliaria_id = v_tenant and contrato_id = c.id
        and categoria = 'repasse_proprietario' and competencia = v_competencia
    ) then
      insert into public.lancamentos
        (imobiliaria_id, tipo, categoria, status, descricao, valor, competencia, vencimento,
         contrato_id, imovel_id, proprietario_id)
      values
        (v_tenant, 'despesa','repasse_proprietario','pendente',
         'Repasse ' || to_char(v_competencia,'MM/YYYY') || ' - contrato ' || coalesce(c.numero,''),
         v_repasse, v_competencia, v_vencimento + 5,
         c.id, c.imovel_id, v_proprietario);
      v_criadas := v_criadas + 1;
    end if;

    -- 3) taxa de administracao (receita da imobiliaria)
    if v_taxa > 0 and not exists (
      select 1 from public.lancamentos
      where imobiliaria_id = v_tenant and contrato_id = c.id
        and categoria = 'taxa_administracao' and competencia = v_competencia
    ) then
      insert into public.lancamentos
        (imobiliaria_id, tipo, categoria, status, descricao, valor, competencia, vencimento,
         contrato_id, imovel_id, proprietario_id)
      values
        (v_tenant, 'receita','taxa_administracao','pendente',
         'Taxa adm ' || to_char(v_competencia,'MM/YYYY') || ' - contrato ' || coalesce(c.numero,''),
         v_taxa, v_competencia, v_vencimento,
         c.id, c.imovel_id, v_proprietario);
      v_criadas := v_criadas + 1;
    end if;

    v_competencia := (v_competencia + interval '1 month')::date;
  end loop;

  return v_criadas;
end;
$$;

-- PERDE o definer. Corpo identico ao 002 - as 15 agregacoes passam a ser
-- filtradas pela RLS automaticamente, sem nenhum `where` novo para esquecer.
create or replace function public.dashboard_resumo()
returns json
language sql
stable
set search_path = public
as $$
  select json_build_object(
    'imoveis_total',       (select count(*) from public.imoveis where status <> 'inativo'),
    'imoveis_disponiveis', (select count(*) from public.imoveis where status = 'disponivel'),
    'imoveis_alugados',    (select count(*) from public.imoveis where status = 'alugado'),
    'imoveis_vendidos',    (select count(*) from public.imoveis where status = 'vendido'),
    'contratos_ativos',    (select count(*) from public.contratos where status = 'ativo'),
    'contratos_vencendo',  (select count(*) from public.contratos
                             where status = 'ativo'
                               and data_fim between current_date and current_date + 90),
    'clientes_total',      (select count(*) from public.clientes where ativo),
    'proprietarios_total', (select count(*) from public.proprietarios where ativo),
    'a_receber_mes',       (select coalesce(sum(valor),0) from public.lancamentos
                             where tipo = 'receita' and status in ('pendente','atrasado')
                               and date_trunc('month', vencimento) = date_trunc('month', current_date)),
    'a_pagar_mes',         (select coalesce(sum(valor),0) from public.lancamentos
                             where tipo = 'despesa' and status in ('pendente','atrasado')
                               and date_trunc('month', vencimento) = date_trunc('month', current_date)),
    'recebido_mes',        (select coalesce(sum(coalesce(valor_pago, valor)),0) from public.lancamentos
                             where tipo = 'receita' and status = 'pago'
                               and date_trunc('month', data_pagamento) = date_trunc('month', current_date)),
    'inadimplencia',       (select coalesce(sum(valor),0) from public.lancamentos
                             where tipo = 'receita' and status = 'atrasado'),
    'inadimplentes_qtd',   (select count(*) from public.lancamentos
                             where tipo = 'receita' and status = 'atrasado'),
    'negociacoes_abertas', (select count(*) from public.negociacoes
                             where etapa not in ('fechado','perdido')),
    'visitas_semana',      (select count(*) from public.visitas
                             where data_hora between current_date and current_date + 7)
  );
$$;

-- Painel do super admin: SO agregados, nenhuma linha operacional.
-- A trava mora DENTRO da funcao definer, nao em policy.
create or replace function public.painel_imobiliarias()
-- Os contadores usam prefixo `total_` para nao colidirem com os nomes das
-- tabelas consultadas no corpo (uma coluna de saida chamada `imoveis` dentro de
-- uma funcao que le `public.imoveis` e pedido de ambiguidade).
returns table (
  id uuid, nome text, razao_social text, cpf_cnpj text, codigo char(6),
  plano text, ativa boolean, email text, telefone text, cidade text, estado char(2),
  created_at timestamptz,
  total_usuarios int, total_imoveis int, total_contratos_ativos int,
  ultimo_acesso timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select im.id, im.nome, im.razao_social, im.cpf_cnpj, im.codigo,
         im.plano, im.ativa, im.email, im.telefone, im.cidade, im.estado, im.created_at,
         (select count(*) from public.profiles  p where p.imobiliaria_id = im.id)::int,
         (select count(*) from public.imoveis   i where i.imobiliaria_id = im.id)::int,
         (select count(*) from public.contratos c
           where c.imobiliaria_id = im.id and c.status = 'ativo')::int,
         (select max(u.last_sign_in_at) from auth.users u
           join public.profiles p on p.id = u.id where p.imobiliaria_id = im.id)
    from public.imobiliarias im
   where public.sou_super_admin()
   order by im.nome;
$$;


-- -----------------------------------------------------------------------------
-- (i) VIEWS - drop + create, com security_invoker
--
-- `create or replace view` NAO serve aqui: `add column` poe imobiliaria_id no fim
-- da tabela, mas dentro da view ela entra no meio da saida (i.* vem antes de
-- proprietario_nome), e o Postgres so permite acrescentar coluna no fim num
-- replace - daria "cannot change name of view column".
--
-- security_invoker = true e o que faz a view respeitar a RLS de quem consulta.
-- Sem ele (situacao de hoje) as views rodam como o dono e devolvem TUDO - e sao
-- justamente elas que Imoveis, Contratos, Financeiro e Dashboard leem.
-- A igualdade de tenant nos joins e redundante com isso, mas e defesa em
-- profundidade de custo zero e ajuda o planner a usar os indices compostos.
-- -----------------------------------------------------------------------------
drop view if exists public.vw_imoveis_completo;
create view public.vw_imoveis_completo with (security_invoker = true) as
select
  i.*,
  p.nome     as proprietario_nome,
  p.telefone as proprietario_telefone,
  (select f.url from public.imovel_fotos f
    where f.imovel_id = i.id and f.imobiliaria_id = i.imobiliaria_id
    order by f.capa desc, f.ordem asc limit 1) as foto_capa
from public.imoveis i
left join public.proprietarios p
       on p.id = i.proprietario_id
      and p.imobiliaria_id = i.imobiliaria_id;

drop view if exists public.vw_contratos_completo;
create view public.vw_contratos_completo with (security_invoker = true) as
select
  c.*,
  i.codigo    as imovel_codigo,
  i.titulo    as imovel_titulo,
  i.bairro    as imovel_bairro,
  i.cidade    as imovel_cidade,
  cl.nome     as inquilino_nome,
  cl.telefone as inquilino_telefone,
  f.nome      as fiador_nome,
  pr.nome     as proprietario_nome,
  (c.data_fim - current_date) as dias_para_vencer
from public.contratos c
join public.imoveis  i  on i.id  = c.imovel_id    and i.imobiliaria_id  = c.imobiliaria_id
join public.clientes cl on cl.id = c.inquilino_id and cl.imobiliaria_id = c.imobiliaria_id
left join public.clientes      f  on f.id  = c.fiador_id       and f.imobiliaria_id  = c.imobiliaria_id
left join public.proprietarios pr on pr.id = i.proprietario_id and pr.imobiliaria_id = i.imobiliaria_id;

drop view if exists public.vw_lancamentos_completo;
create view public.vw_lancamentos_completo with (security_invoker = true) as
select
  l.*,
  i.codigo  as imovel_codigo,
  i.titulo  as imovel_titulo,
  cl.nome   as cliente_nome,
  pr.nome   as proprietario_nome,
  ct.numero as contrato_numero,
  (current_date - l.vencimento) as dias_atraso
from public.lancamentos l
left join public.imoveis       i  on i.id  = l.imovel_id       and i.imobiliaria_id  = l.imobiliaria_id
left join public.clientes      cl on cl.id = l.cliente_id      and cl.imobiliaria_id = l.imobiliaria_id
left join public.proprietarios pr on pr.id = l.proprietario_id and pr.imobiliaria_id = l.imobiliaria_id
left join public.contratos     ct on ct.id = l.contrato_id     and ct.imobiliaria_id = l.imobiliaria_id;


-- -----------------------------------------------------------------------------
-- (j) POLICIES
--
-- CRITICO: policies permissivas se combinam com OR. Uma unica policy antiga que
-- sobreviva anula o isolamento inteiro. Por isso todo `drop policy if exists`
-- abaixo repete EXATAMENTE o nome usado no 003_rls.sql.
--
-- Escrever sempre `imobiliaria_id = (select public.minha_imobiliaria())` COM os
-- parenteses: a subquery escalar nao-correlacionada vira InitPlan e e avaliada
-- uma vez por query. Sem eles, a funcao security definer (que o Postgres nao
-- consegue inline) e chamada POR LINHA - diferenca real numa lista de 600
-- lancamentos.
-- -----------------------------------------------------------------------------

-- IMOBILIARIAS ................................................................
drop policy if exists "imobiliarias_minha" on public.imobiliarias;
create policy "imobiliarias_minha" on public.imobiliarias
  for select to authenticated
  -- vinculo CRU de proposito: o usuario de um tenant suspenso precisa conseguir
  -- ler `ativa = false` para o front mostrar a tela de suspensao
  using (id = (select public.meu_vinculo_imobiliaria()));

drop policy if exists "imobiliarias_super_select" on public.imobiliarias;
create policy "imobiliarias_super_select" on public.imobiliarias
  for select to authenticated using (public.sou_super_admin());

drop policy if exists "imobiliarias_super_insert" on public.imobiliarias;
create policy "imobiliarias_super_insert" on public.imobiliarias
  for insert to authenticated with check (public.sou_super_admin());

drop policy if exists "imobiliarias_super_update" on public.imobiliarias;
create policy "imobiliarias_super_update" on public.imobiliarias
  for update to authenticated
  using (public.sou_super_admin()) with check (public.sou_super_admin());
-- sem policy de DELETE: ninguem apaga imobiliaria pela API, nem o super admin

-- PROFILES ....................................................................
-- O `id = auth.uid()` isolado no primeiro OR nao e detalhe: sem ele um usuario
-- desativado nao le o proprio perfil, `perfil` fica null e o app trava para
-- sempre em "Carregando seu perfil..." (App.tsx) em vez de cair na tela
-- ContaDesativada.
drop policy if exists "profiles_select" on public.profiles;
create policy "profiles_select" on public.profiles
  for select to authenticated
  using (
    id = auth.uid()
    or public.sou_super_admin()
    or (public.estou_ativo() and imobiliaria_id = (select public.minha_imobiliaria()))
  );

-- Corrige a auto-promocao de cargo (falha ATIVA hoje: o `with check` era so
-- `id = auth.uid()`, entao qualquer um se tornava admin).
-- Funciona porque meu_cargo() e `stable security definer` e le o snapshot do
-- inicio do comando - o valor ANTIGO - sem disparar a RLS de profiles de novo.
drop policy if exists "profiles_update_proprio" on public.profiles;
create policy "profiles_update_proprio" on public.profiles
  for update to authenticated
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and cargo = (select public.meu_cargo())
    and ativo = (select public.estou_ativo())
    and imobiliaria_id is not distinct from (select public.meu_vinculo_imobiliaria())
  );

-- O nome antigo tem que sumir: era `for all` sem tenant, entao o admin de A
-- lia e editava os profiles de B.
drop policy if exists "profiles_admin_all" on public.profiles;
drop policy if exists "profiles_admin_gerencia" on public.profiles;
create policy "profiles_admin_gerencia" on public.profiles
  for update to authenticated
  using (
    public.tem_cargo(array['admin']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  )
  with check (
    public.tem_cargo(array['admin']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
    and cargo <> 'super_admin'
  );
-- NENHUMA policy de INSERT ou DELETE em profiles:
-- criacao = trigger handle_new_user; exclusao = Auth Admin API (cascade).

-- PROPRIETARIOS ...............................................................
drop policy if exists "proprietarios_select" on public.proprietarios;
create policy "proprietarios_select" on public.proprietarios
  for select to authenticated
  using (public.estou_ativo() and imobiliaria_id = (select public.minha_imobiliaria()));

drop policy if exists "proprietarios_write" on public.proprietarios;
create policy "proprietarios_write" on public.proprietarios
  for all to authenticated
  using (
    public.tem_cargo(array['admin','gerente','corretor']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  )
  with check (
    public.tem_cargo(array['admin','gerente','corretor']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  );

-- IMOVEIS .....................................................................
drop policy if exists "imoveis_select" on public.imoveis;
create policy "imoveis_select" on public.imoveis
  for select to authenticated
  using (public.estou_ativo() and imobiliaria_id = (select public.minha_imobiliaria()));

drop policy if exists "imoveis_write" on public.imoveis;
create policy "imoveis_write" on public.imoveis
  for all to authenticated
  using (
    public.tem_cargo(array['admin','gerente','corretor']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  )
  with check (
    public.tem_cargo(array['admin','gerente','corretor']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  );

-- FOTOS .......................................................................
drop policy if exists "fotos_select" on public.imovel_fotos;
create policy "fotos_select" on public.imovel_fotos
  for select to authenticated
  using (public.estou_ativo() and imobiliaria_id = (select public.minha_imobiliaria()));

drop policy if exists "fotos_write" on public.imovel_fotos;
create policy "fotos_write" on public.imovel_fotos
  for all to authenticated
  using (
    public.tem_cargo(array['admin','gerente','corretor']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  )
  with check (
    public.tem_cargo(array['admin','gerente','corretor']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  );

-- CLIENTES ....................................................................
drop policy if exists "clientes_select" on public.clientes;
create policy "clientes_select" on public.clientes
  for select to authenticated
  using (public.estou_ativo() and imobiliaria_id = (select public.minha_imobiliaria()));

drop policy if exists "clientes_write" on public.clientes;
create policy "clientes_write" on public.clientes
  for all to authenticated
  using (
    public.tem_cargo(array['admin','gerente','corretor']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  )
  with check (
    public.tem_cargo(array['admin','gerente','corretor']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  );

-- CONTRATOS ...................................................................
drop policy if exists "contratos_select" on public.contratos;
create policy "contratos_select" on public.contratos
  for select to authenticated
  using (public.estou_ativo() and imobiliaria_id = (select public.minha_imobiliaria()));

drop policy if exists "contratos_write" on public.contratos;
create policy "contratos_write" on public.contratos
  for all to authenticated
  using (
    public.tem_cargo(array['admin','gerente','financeiro']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  )
  with check (
    public.tem_cargo(array['admin','gerente','financeiro']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  );

-- LANCAMENTOS .................................................................
drop policy if exists "lancamentos_select" on public.lancamentos;
create policy "lancamentos_select" on public.lancamentos
  for select to authenticated
  using (public.estou_ativo() and imobiliaria_id = (select public.minha_imobiliaria()));

drop policy if exists "lancamentos_write" on public.lancamentos;
create policy "lancamentos_write" on public.lancamentos
  for all to authenticated
  using (
    public.tem_cargo(array['admin','gerente','financeiro']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  )
  with check (
    public.tem_cargo(array['admin','gerente','financeiro']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  );

-- NEGOCIACOES .................................................................
-- update e delete nao tinham `with check` no 003: um corretor conseguia
-- reatribuir a negociacao para fora do proprio escopo.
-- Efeito visivel: corretor deixa de passar negociacao para outro corretor -
-- so admin e gerente reatribuem.
drop policy if exists "negociacoes_select" on public.negociacoes;
create policy "negociacoes_select" on public.negociacoes
  for select to authenticated
  using (public.estou_ativo() and imobiliaria_id = (select public.minha_imobiliaria()));

drop policy if exists "negociacoes_insert" on public.negociacoes;
create policy "negociacoes_insert" on public.negociacoes
  for insert to authenticated
  with check (
    public.tem_cargo(array['admin','gerente','corretor']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  );

drop policy if exists "negociacoes_update" on public.negociacoes;
create policy "negociacoes_update" on public.negociacoes
  for update to authenticated
  using (
    imobiliaria_id = (select public.minha_imobiliaria())
    and (
      public.tem_cargo(array['admin','gerente']::user_role[])
      or (public.tem_cargo(array['corretor']::user_role[]) and corretor_id = auth.uid())
    )
  )
  with check (
    imobiliaria_id = (select public.minha_imobiliaria())
    and (
      public.tem_cargo(array['admin','gerente']::user_role[])
      or (public.tem_cargo(array['corretor']::user_role[]) and corretor_id = auth.uid())
    )
  );

drop policy if exists "negociacoes_delete" on public.negociacoes;
create policy "negociacoes_delete" on public.negociacoes
  for delete to authenticated
  using (
    imobiliaria_id = (select public.minha_imobiliaria())
    and (
      public.tem_cargo(array['admin','gerente']::user_role[])
      or (public.tem_cargo(array['corretor']::user_role[]) and corretor_id = auth.uid())
    )
  );

-- VISITAS .....................................................................
drop policy if exists "visitas_select" on public.visitas;
create policy "visitas_select" on public.visitas
  for select to authenticated
  using (public.estou_ativo() and imobiliaria_id = (select public.minha_imobiliaria()));

drop policy if exists "visitas_write" on public.visitas;
create policy "visitas_write" on public.visitas
  for all to authenticated
  using (
    public.tem_cargo(array['admin','gerente','corretor']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  )
  with check (
    public.tem_cargo(array['admin','gerente','corretor']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  );

-- AUDITORIA ...................................................................
-- Sem policy de insert: fn_auditoria e security definer.
drop policy if exists "auditoria_select" on public.auditoria;
create policy "auditoria_select" on public.auditoria
  for select to authenticated
  using (
    public.tem_cargo(array['admin','gerente']::user_role[])
    and imobiliaria_id = (select public.minha_imobiliaria())
  );


-- -----------------------------------------------------------------------------
-- (k) STORAGE
-- Convencao de path: {imobiliaria_id}/{recurso}/{registro_id}/{arquivo}
-- O primeiro segmento e sempre o tenant, o que torna a policy trivial.
-- Fixar isso agora e de graca: nao existe nenhum call site de .upload() no front.
-- -----------------------------------------------------------------------------

-- Bucket privado para documentos (contrato assinado, RG, comprovante de renda).
-- Nasce aqui com as policies prontas; a tela vem depois.
insert into storage.buckets (id, name, public)
values ('documentos', 'documentos', false)
on conflict (id) do nothing;

-- Leitura publica das FOTOS continua: sao imagens de anuncio, e o path com uuid
-- nao e enumeravel. Documentos ficam no bucket privado, com signed URL.
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
    and (storage.foldername(name))[1] = (select public.minha_imobiliaria())::text
  );

drop policy if exists "fotos_update" on storage.objects;
create policy "fotos_update" on storage.objects
  for update to authenticated
  using (
    bucket_id = 'imoveis'
    and public.tem_cargo(array['admin','gerente','corretor']::user_role[])
    and (storage.foldername(name))[1] = (select public.minha_imobiliaria())::text
  )
  with check (
    bucket_id = 'imoveis'
    and public.tem_cargo(array['admin','gerente','corretor']::user_role[])
    and (storage.foldername(name))[1] = (select public.minha_imobiliaria())::text
  );

drop policy if exists "fotos_delete" on storage.objects;
create policy "fotos_delete" on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'imoveis'
    and public.tem_cargo(array['admin','gerente','corretor']::user_role[])
    and (storage.foldername(name))[1] = (select public.minha_imobiliaria())::text
  );

drop policy if exists "documentos_ler" on storage.objects;
create policy "documentos_ler" on storage.objects
  for select to authenticated
  using (
    bucket_id = 'documentos'
    and public.estou_ativo()
    and (storage.foldername(name))[1] = (select public.minha_imobiliaria())::text
  );

drop policy if exists "documentos_escrever" on storage.objects;
create policy "documentos_escrever" on storage.objects
  for all to authenticated
  using (
    bucket_id = 'documentos'
    and public.tem_cargo(array['admin','gerente','financeiro']::user_role[])
    and (storage.foldername(name))[1] = (select public.minha_imobiliaria())::text
  )
  with check (
    bucket_id = 'documentos'
    and public.tem_cargo(array['admin','gerente','financeiro']::user_role[])
    and (storage.foldername(name))[1] = (select public.minha_imobiliaria())::text
  );


-- -----------------------------------------------------------------------------
-- (l) DEFAULTS - o que elimina a janela de indisponibilidade
--
-- E isto que permite rodar a migracao com o site no ar: o front ANTIGO, que nao
-- conhece imobiliaria_id, continua inserindo corretamente ate o deploy do codigo
-- novo. Nao existe intervalo em que o sistema fique quebrado.
--
-- O default nao pode ser abusado: preenche com o tenant de QUEM CHAMA, e o
-- `with check` da RLS barra qualquer tentativa de mandar outro valor.
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'proprietarios','imoveis','imovel_fotos','clientes',
    'contratos','lancamentos','negociacoes','visitas'
  ]
  loop
    execute format(
      'alter table public.%I alter column imobiliaria_id set default public.minha_imobiliaria()', t);
  end loop;

  -- Brinde: created_by existe em 7 tabelas desde o 001 e esta SEMPRE NULL,
  -- porque nenhuma tela preenche. Agora passa a registrar quem cadastrou.
  foreach t in array array[
    'proprietarios','imoveis','clientes','contratos',
    'lancamentos','negociacoes','visitas'
  ]
  loop
    execute format(
      'alter table public.%I alter column created_by set default auth.uid()', t);
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
-- (m) SUPER ADMIN
--
-- Converte a conta do dono da plataforma. Passa pelo trg_proteger_profile
-- porque auth.uid() e NULL aqui no SQL Editor.
--
-- ATENCAO: depois disto a conta NAO ve mais imovel, contrato, cliente nem
-- financeiro de ninguem - inclusive da Matriz. E o objetivo do desenho (LGPD),
-- mas significa que a Matriz pode ficar SEM ADMINISTRADOR.
-- Resolva logo apos o deploy, na tela do super admin: "Criar administrador".
-- -----------------------------------------------------------------------------
update public.profiles
   set cargo = 'super_admin', imobiliaria_id = null
 where email = 'romulorocha@gmail.com';


-- =============================================================================
-- VERIFICACAO - rode DEPOIS, num editor separado, antes de seguir para o 005
-- =============================================================================
--
-- 1) Nenhuma linha orfa. sem_tenant deve ser 0 em tudo
--    (profiles pode ter 1: o super admin).
--
--   select 'profiles' t, count(*) total, count(*) filter (where imobiliaria_id is null) sem_tenant from public.profiles
--   union all select 'proprietarios', count(*), count(*) filter (where imobiliaria_id is null) from public.proprietarios
--   union all select 'imoveis',       count(*), count(*) filter (where imobiliaria_id is null) from public.imoveis
--   union all select 'imovel_fotos',  count(*), count(*) filter (where imobiliaria_id is null) from public.imovel_fotos
--   union all select 'clientes',      count(*), count(*) filter (where imobiliaria_id is null) from public.clientes
--   union all select 'contratos',     count(*), count(*) filter (where imobiliaria_id is null) from public.contratos
--   union all select 'lancamentos',   count(*), count(*) filter (where imobiliaria_id is null) from public.lancamentos
--   union all select 'negociacoes',   count(*), count(*) filter (where imobiliaria_id is null) from public.negociacoes
--   union all select 'visitas',       count(*), count(*) filter (where imobiliaria_id is null) from public.visitas
--   union all select 'auditoria',     count(*), count(*) filter (where imobiliaria_id is null) from public.auditoria;
--
-- 2) Nada se perdeu - a contagem bate com o snapshot.
--
--   select (select count(*) from public.imoveis)     = (select count(*) from backup_pre_mt.imoveis)     as imoveis_ok,
--          (select count(*) from public.contratos)   = (select count(*) from backup_pre_mt.contratos)   as contratos_ok,
--          (select count(*) from public.lancamentos) = (select count(*) from backup_pre_mt.lancamentos) as lancamentos_ok,
--          (select count(*) from public.clientes)    = (select count(*) from backup_pre_mt.clientes)    as clientes_ok;
--
-- 3) Nenhum vinculo cruzando tenant - tudo 0.
--
--   select 'imovel->proprietario' rel, count(*) from public.imoveis i join public.proprietarios p on p.id=i.proprietario_id where p.imobiliaria_id<>i.imobiliaria_id
--   union all select 'contrato->imovel',  count(*) from public.contratos c   join public.imoveis i    on i.id=c.imovel_id     where i.imobiliaria_id<>c.imobiliaria_id
--   union all select 'contrato->cliente', count(*) from public.contratos c   join public.clientes k   on k.id=c.inquilino_id  where k.imobiliaria_id<>c.imobiliaria_id
--   union all select 'lanc->contrato',    count(*) from public.lancamentos l join public.contratos c  on c.id=l.contrato_id   where c.imobiliaria_id<>l.imobiliaria_id
--   union all select 'negoc->cliente',    count(*) from public.negociacoes n join public.clientes k   on k.id=n.cliente_id    where k.imobiliaria_id<>n.imobiliaria_id;
--
-- 4) Contadores coerentes com o que ja existe.
--
--   select c.*, (select max(codigo) from public.imoveis i where i.imobiliaria_id = c.imobiliaria_id) ultimo_codigo
--     from public.contadores c;
--
-- 5) O codigo de acesso da Matriz - anote, e o que voce entrega a equipe.
--
--   select nome, codigo, ativa from public.imobiliarias;
--
-- 6) As views respeitam a RLS - cada uma deve mostrar {security_invoker=true}.
--
--   select relname, reloptions from pg_class
--    where relname in ('vw_imoveis_completo','vw_contratos_completo','vw_lancamentos_completo');
--
-- Só depois de tudo conferido (e o site testado), limpe o que sobrou:
--   drop sequence if exists public.seq_codigo_imovel;
--   drop sequence if exists public.seq_numero_contrato;
-- E, depois de uma semana de uso estavel:
--   drop schema backup_pre_mt cascade;
-- =============================================================================
