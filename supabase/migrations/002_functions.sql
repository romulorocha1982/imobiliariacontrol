-- =============================================================================
-- IMOBILIARIA CONTROL - Funcoes, triggers e automacoes
-- Execute DEPOIS de 001_schema.sql
-- =============================================================================

-- -----------------------------------------------------------------------------
-- updated_at automatico
-- -----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','proprietarios','imoveis','clientes',
    'contratos','lancamentos','negociacoes'
  ]
  loop
    execute format('drop trigger if exists trg_updated_at on public.%I', t);
    execute format(
      'create trigger trg_updated_at before update on public.%I
       for each row execute function public.set_updated_at()', t
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Cargo do usuario logado (SECURITY DEFINER evita recursao infinita na RLS)
-- -----------------------------------------------------------------------------
create or replace function public.meu_cargo()
returns user_role
language sql
stable
security definer
set search_path = public
as $$
  select cargo from public.profiles where id = auth.uid();
$$;

create or replace function public.estou_ativo()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((select ativo from public.profiles where id = auth.uid()), false);
$$;

-- Atalho: o usuario tem algum dos cargos informados?
create or replace function public.tem_cargo(cargos user_role[])
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.estou_ativo() and public.meu_cargo() = any(cargos);
$$;

-- -----------------------------------------------------------------------------
-- Criacao automatica do profile ao cadastrar usuario no Auth
-- O primeiro usuario do sistema vira admin automaticamente.
-- -----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  total_usuarios int;
  cargo_inicial  user_role;
begin
  select count(*) into total_usuarios from public.profiles;

  if total_usuarios = 0 then
    cargo_inicial := 'admin';
  else
    cargo_inicial := coalesce(
      (new.raw_user_meta_data ->> 'cargo')::user_role,
      'corretor'
    );
  end if;

  insert into public.profiles (id, nome, email, telefone, cargo, ativo)
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'nome', split_part(new.email, '@', 1)),
    new.email,
    new.raw_user_meta_data ->> 'telefone',
    cargo_inicial,
    true
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- -----------------------------------------------------------------------------
-- Codigo sequencial dos imoveis: IM-0001, IM-0002...
-- -----------------------------------------------------------------------------
create sequence if not exists public.seq_codigo_imovel start 1;

create or replace function public.gerar_codigo_imovel()
returns trigger
language plpgsql
as $$
begin
  if new.codigo is null or new.codigo = '' then
    new.codigo := 'IM-' || lpad(nextval('public.seq_codigo_imovel')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_codigo_imovel on public.imoveis;
create trigger trg_codigo_imovel
  before insert on public.imoveis
  for each row execute function public.gerar_codigo_imovel();

-- -----------------------------------------------------------------------------
-- Numero do contrato: CT-2026-0001
-- -----------------------------------------------------------------------------
create sequence if not exists public.seq_numero_contrato start 1;

create or replace function public.gerar_numero_contrato()
returns trigger
language plpgsql
as $$
begin
  if new.numero is null or new.numero = '' then
    new.numero := 'CT-' || to_char(now(), 'YYYY') || '-' ||
                  lpad(nextval('public.seq_numero_contrato')::text, 4, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists trg_numero_contrato on public.contratos;
create trigger trg_numero_contrato
  before insert on public.contratos
  for each row execute function public.gerar_numero_contrato();

-- -----------------------------------------------------------------------------
-- AUDITORIA generica: registra INSERT / UPDATE / DELETE
-- -----------------------------------------------------------------------------
create or replace function public.fn_auditoria()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_nome text;
  v_id   text;
begin
  select nome into v_nome from public.profiles where id = auth.uid();

  if tg_op = 'DELETE' then
    v_id := old.id::text;
    insert into public.auditoria (tabela, registro_id, acao, usuario_id, usuario_nome, dados_antes)
    values (tg_table_name, v_id, tg_op, auth.uid(), v_nome, to_jsonb(old));
    return old;
  elsif tg_op = 'UPDATE' then
    v_id := new.id::text;
    -- so registra se algo realmente mudou (ignora o proprio updated_at)
    if to_jsonb(old) - 'updated_at' is distinct from to_jsonb(new) - 'updated_at' then
      insert into public.auditoria (tabela, registro_id, acao, usuario_id, usuario_nome, dados_antes, dados_depois)
      values (tg_table_name, v_id, tg_op, auth.uid(), v_nome, to_jsonb(old), to_jsonb(new));
    end if;
    return new;
  else
    v_id := new.id::text;
    insert into public.auditoria (tabela, registro_id, acao, usuario_id, usuario_nome, dados_depois)
    values (tg_table_name, v_id, tg_op, auth.uid(), v_nome, to_jsonb(new));
    return new;
  end if;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'proprietarios','imoveis','clientes','contratos','lancamentos','negociacoes'
  ]
  loop
    execute format('drop trigger if exists trg_auditoria on public.%I', t);
    execute format(
      'create trigger trg_auditoria after insert or update or delete on public.%I
       for each row execute function public.fn_auditoria()', t
    );
  end loop;
end;
$$;

-- -----------------------------------------------------------------------------
-- Ao ativar um contrato, o imovel passa a "alugado".
-- Ao encerrar/rescindir, volta para "disponivel".
-- -----------------------------------------------------------------------------
create or replace function public.fn_sincronizar_status_imovel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'ativo' then
    update public.imoveis set status = 'alugado' where id = new.imovel_id;
  elsif new.status in ('encerrado','rescindido') then
    update public.imoveis set status = 'disponivel' where id = new.imovel_id
      and not exists (
        select 1 from public.contratos
        where imovel_id = new.imovel_id and status = 'ativo' and id <> new.id
      );
  end if;
  return new;
end;
$$;

drop trigger if exists trg_status_imovel on public.contratos;
create trigger trg_status_imovel
  after insert or update of status on public.contratos
  for each row execute function public.fn_sincronizar_status_imovel();

-- -----------------------------------------------------------------------------
-- Gera as parcelas de aluguel de um contrato.
-- Para cada mes cria: receita do inquilino, repasse ao proprietario e
-- a taxa de administracao da imobiliaria.
--   select public.gerar_parcelas_contrato('<uuid-do-contrato>');
-- -----------------------------------------------------------------------------
create or replace function public.gerar_parcelas_contrato(p_contrato_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  c              record;
  v_competencia  date;
  v_vencimento   date;
  v_total        numeric(14,2);
  v_taxa         numeric(14,2);
  v_repasse      numeric(14,2);
  v_criadas      integer := 0;
  v_proprietario uuid;
begin
  select * into c from public.contratos where id = p_contrato_id;
  if not found then
    raise exception 'Contrato % nao encontrado', p_contrato_id;
  end if;

  select proprietario_id into v_proprietario from public.imoveis where id = c.imovel_id;

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
      where contrato_id = c.id and categoria = 'aluguel' and competencia = v_competencia
    ) then
      insert into public.lancamentos
        (tipo, categoria, status, descricao, valor, competencia, vencimento,
         contrato_id, imovel_id, cliente_id, proprietario_id)
      values
        ('receita','aluguel','pendente',
         'Aluguel ' || to_char(v_competencia,'MM/YYYY') || ' - contrato ' || coalesce(c.numero,''),
         v_total, v_competencia, v_vencimento,
         c.id, c.imovel_id, c.inquilino_id, v_proprietario);
      v_criadas := v_criadas + 1;
    end if;

    -- 2) repasse ao proprietario
    if not exists (
      select 1 from public.lancamentos
      where contrato_id = c.id and categoria = 'repasse_proprietario' and competencia = v_competencia
    ) then
      insert into public.lancamentos
        (tipo, categoria, status, descricao, valor, competencia, vencimento,
         contrato_id, imovel_id, proprietario_id)
      values
        ('despesa','repasse_proprietario','pendente',
         'Repasse ' || to_char(v_competencia,'MM/YYYY') || ' - contrato ' || coalesce(c.numero,''),
         v_repasse, v_competencia, v_vencimento + 5,
         c.id, c.imovel_id, v_proprietario);
      v_criadas := v_criadas + 1;
    end if;

    -- 3) taxa de administracao (receita da imobiliaria)
    if v_taxa > 0 and not exists (
      select 1 from public.lancamentos
      where contrato_id = c.id and categoria = 'taxa_administracao' and competencia = v_competencia
    ) then
      insert into public.lancamentos
        (tipo, categoria, status, descricao, valor, competencia, vencimento,
         contrato_id, imovel_id, proprietario_id)
      values
        ('receita','taxa_administracao','pendente',
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

-- -----------------------------------------------------------------------------
-- Marca como "atrasado" tudo que venceu e continua pendente.
--   select public.marcar_atrasados();
-- -----------------------------------------------------------------------------
create or replace function public.marcar_atrasados()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare v_qtd integer;
begin
  update public.lancamentos
     set status = 'atrasado'
   where status = 'pendente'
     and vencimento < current_date;
  get diagnostics v_qtd = row_count;
  return v_qtd;
end;
$$;

-- -----------------------------------------------------------------------------
-- Baixa de pagamento
-- -----------------------------------------------------------------------------
create or replace function public.baixar_lancamento(
  p_id     uuid,
  p_valor  numeric default null,
  p_data   date default current_date,
  p_forma  text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lancamentos
     set status          = 'pago',
         valor_pago      = coalesce(p_valor, valor),
         data_pagamento  = p_data,
         forma_pagamento = coalesce(p_forma, forma_pagamento)
   where id = p_id;
end;
$$;

-- -----------------------------------------------------------------------------
-- VIEWS de apoio ao dashboard
-- -----------------------------------------------------------------------------
create or replace view public.vw_imoveis_completo as
select
  i.*,
  p.nome  as proprietario_nome,
  p.telefone as proprietario_telefone,
  (select f.url from public.imovel_fotos f
    where f.imovel_id = i.id
    order by f.capa desc, f.ordem asc limit 1) as foto_capa
from public.imoveis i
left join public.proprietarios p on p.id = i.proprietario_id;

create or replace view public.vw_contratos_completo as
select
  c.*,
  i.codigo   as imovel_codigo,
  i.titulo   as imovel_titulo,
  i.bairro   as imovel_bairro,
  i.cidade   as imovel_cidade,
  cl.nome    as inquilino_nome,
  cl.telefone as inquilino_telefone,
  f.nome     as fiador_nome,
  pr.nome    as proprietario_nome,
  (c.data_fim - current_date) as dias_para_vencer
from public.contratos c
join public.imoveis i   on i.id  = c.imovel_id
join public.clientes cl on cl.id = c.inquilino_id
left join public.clientes f  on f.id  = c.fiador_id
left join public.proprietarios pr on pr.id = i.proprietario_id;

create or replace view public.vw_lancamentos_completo as
select
  l.*,
  i.codigo  as imovel_codigo,
  i.titulo  as imovel_titulo,
  cl.nome   as cliente_nome,
  pr.nome   as proprietario_nome,
  ct.numero as contrato_numero,
  (current_date - l.vencimento) as dias_atraso
from public.lancamentos l
left join public.imoveis i        on i.id  = l.imovel_id
left join public.clientes cl      on cl.id = l.cliente_id
left join public.proprietarios pr on pr.id = l.proprietario_id
left join public.contratos ct     on ct.id = l.contrato_id;

-- Numeros do dashboard em uma unica chamada
create or replace function public.dashboard_resumo()
returns json
language sql
stable
security definer
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
