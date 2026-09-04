-- =============================================================================
-- DIAGNOSTICO - ate onde as migracoes do multi-tenancy chegaram neste projeto
-- Somente leitura. Pode rodar em qualquer projeto (teste ou producao).
-- Cole tudo de uma vez no SQL Editor e clique em Run.
-- =============================================================================
create temp table if not exists _diag(ordem int, etapa text, verificacao text, resultado text);
truncate _diag;

do $do$
declare
  v_n     bigint;
  v_txt   text;
  t       text;
  v_falta text := '';
begin
  -- ---------- 004a: o valor novo do enum ----------
  select count(*) into v_n
    from pg_enum e join pg_type ty on ty.oid = e.enumtypid
   where ty.typname = 'user_role' and e.enumlabel = 'super_admin';
  insert into _diag values (1, '004a', 'cargo super_admin no enum user_role',
    case when v_n = 1 then 'SIM' else 'NAO -- o 004a ainda nao rodou' end);

  select string_agg(e.enumlabel, ', ' order by e.enumsortorder) into v_txt
    from pg_enum e join pg_type ty on ty.oid = e.enumtypid
   where ty.typname = 'user_role';
  insert into _diag values (2, '004a', 'valores do enum user_role',
    coalesce(v_txt, '(tipo user_role nao existe)'));

  -- ---------- 004: estrutura ----------
  insert into _diag values (3, '004', 'tabela public.imobiliarias',
    case when to_regclass('public.imobiliarias') is null then 'NAO' else 'SIM' end);
  insert into _diag values (4, '004', 'tabela public.contadores',
    case when to_regclass('public.contadores') is null then 'NAO' else 'SIM' end);

  select count(*) into v_n
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema and tb.table_name = c.table_name
     and tb.table_type = 'BASE TABLE'
   where c.table_schema = 'public' and c.column_name = 'imobiliaria_id';
  insert into _diag values (5, '004', 'tabelas com coluna imobiliaria_id',
    v_n || ' de 10 esperadas');

  select count(*) into v_n
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public'
     and p.proname in ('minha_imobiliaria','meu_vinculo_imobiliaria',
                       'sou_super_admin','proximo_numero','painel_imobiliarias');
  insert into _diag values (6, '004', 'funcoes de tenant', v_n || ' de 5');

  -- ---------- 004: qual versao do arquivo foi executada ----------
  select prosrc into v_txt
    from pg_proc p join pg_namespace ns on ns.oid = p.pronamespace
   where ns.nspname = 'public' and p.proname = 'gerar_codigo_imobiliaria';
  insert into _diag values (7, '004', 'versao de gerar_codigo_imobiliaria',
    case when v_txt is null                      then '(funcao ausente - 004 nao rodou)'
         when v_txt like '%gen_random_bytes%'    then 'ANTIGA (gen_random_bytes) -- reaplicar o 004 corrigido'
         when v_txt like '%gen_random_uuid%'     then 'CORRIGIDA (gen_random_uuid)'
         else '(desconhecida)' end);

  -- ---------- 004: dados ----------
  if to_regclass('public.imobiliarias') is not null then
    execute 'select string_agg(nome || '' / cod '' || codigo, ''  |  '' order by nome)
               from public.imobiliarias' into v_txt;
    insert into _diag values (8, '004', 'imobiliarias cadastradas',
      coalesce(v_txt, '(nenhuma)'));

    foreach t in array array['proprietarios','imoveis','imovel_fotos','clientes',
                             'contratos','lancamentos','negociacoes','visitas','auditoria']
    loop
      if exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = t
                    and column_name = 'imobiliaria_id') then
        execute format('select count(*) from public.%I where imobiliaria_id is null', t) into v_n;
        if v_n > 0 then v_falta := v_falta || t || '=' || v_n || '  '; end if;
      end if;
    end loop;
    insert into _diag values (9, '004', 'linhas orfas (imobiliaria_id nulo)',
      case when v_falta = '' then 'nenhuma' else v_falta end);
  end if;

  if to_regclass('public.profiles') is not null then
    execute 'select count(*) from public.profiles where cargo::text = ''super_admin''' into v_n;
    insert into _diag values (10, '004', 'contas com cargo super_admin', v_n::text);
  end if;

  select count(*) into v_n from pg_policies where schemaname = 'public';
  insert into _diag values (11, '004', 'policies no schema public', v_n::text);

  select string_agg(id, ', ' order by id) into v_txt from storage.buckets;
  insert into _diag values (12, '004', 'buckets do Storage',
    coalesce(v_txt, '(nenhum)') || '  -- esperado: documentos, imoveis');

  -- ---------- 005: integridade cruzada ----------
  select count(*) into v_n from pg_constraint
   where right(conname, 7) = '_tenant' and contype = 'u';
  insert into _diag values (13, '005', 'chaves unicas (id, imobiliaria_id)', v_n || ' de 6');

  select count(*) into v_n from pg_constraint
   where right(conname, 7) = '_tenant' and contype = 'f';
  insert into _diag values (14, '005', 'FKs compostas de tenant', v_n || ' de 17');
end;
$do$;

select etapa, verificacao, resultado from _diag order by ordem;
