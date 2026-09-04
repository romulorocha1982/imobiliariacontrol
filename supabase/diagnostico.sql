-- =============================================================================
-- DIAGNOSTICO - ate onde as migracoes do multi-tenancy chegaram neste projeto
--
-- Somente leitura: nao cria, nao altera e nao apaga nada.
-- E uma unica consulta - cole tudo e rode. Funciona antes e depois do 004.
--
-- As partes que leem dados (linhas 8, 9 e 10) usam query_to_xml para so tocarem
-- nas tabelas que realmente existem; por isso a consulta continua valida mesmo
-- num banco que ainda nao foi migrado.
-- =============================================================================
with cols as (
  select c.table_name
    from information_schema.columns c
    join information_schema.tables tb
      on tb.table_schema = c.table_schema
     and tb.table_name   = c.table_name
     and tb.table_type   = 'BASE TABLE'
   where c.table_schema = 'public'
     and c.column_name  = 'imobiliaria_id'
),
orfas as (
  select table_name,
         (xpath('/row/cnt/text()', query_to_xml(
            format('select count(*) as cnt from public.%I where imobiliaria_id is null%s',
                   table_name,
                   case when table_name = 'profiles'
                        then ' and cargo::text <> ''super_admin'''
                        else '' end),
            false, true, '')))[1]::text::bigint as n
    from cols
),
imob as (
  select (xpath('/row/v/text()', query_to_xml(
            $q$select coalesce(string_agg(nome || ' / cod ' || codigo, '   |   ' order by nome),
                               '(nenhuma)') as v from public.imobiliarias$q$,
            false, true, '')))[1]::text as v
   where to_regclass('public.imobiliarias') is not null
),
sadmin as (
  select (xpath('/row/cnt/text()', query_to_xml(
            $q$select count(*) as cnt from public.profiles where cargo::text = 'super_admin'$q$,
            false, true, '')))[1]::text as n
   where to_regclass('public.profiles') is not null
)
select 1 as ordem, '004a' as etapa, 'cargo super_admin no enum user_role' as verificacao,
       case when exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid
                          where t.typname = 'user_role' and e.enumlabel = 'super_admin')
            then 'SIM' else 'NAO -- o 004a ainda nao rodou' end as resultado
union all select 2, '004a', 'valores do enum user_role',
       coalesce((select string_agg(e.enumlabel, ', ' order by e.enumsortorder)
                   from pg_enum e join pg_type t on t.oid = e.enumtypid
                  where t.typname = 'user_role'), '(tipo user_role nao existe)')
union all select 3, '004', 'tabela public.imobiliarias',
       case when to_regclass('public.imobiliarias') is null then 'NAO' else 'SIM' end
union all select 4, '004', 'tabela public.contadores',
       case when to_regclass('public.contadores') is null then 'NAO' else 'SIM' end
union all select 5, '004', 'tabelas com coluna imobiliaria_id',
       (select count(*) from cols) || ' de 11 esperadas (as 10 do backfill + contadores)'
union all select 6, '004', 'funcoes de tenant',
       (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public'
           and p.proname in ('minha_imobiliaria','meu_vinculo_imobiliaria',
                             'sou_super_admin','proximo_numero','painel_imobiliarias')) || ' de 5'
union all select 7, '004', 'versao de gerar_codigo_imobiliaria',
       coalesce((select case when p.prosrc like '%gen_random_bytes%'
                               then 'ANTIGA (gen_random_bytes) -- reaplicar o 004 corrigido'
                             when p.prosrc like '%gen_random_uuid%'
                               then 'CORRIGIDA (gen_random_uuid)'
                             else '(desconhecida)' end
                   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                  where n.nspname = 'public' and p.proname = 'gerar_codigo_imobiliaria'),
                '(funcao ausente - o 004 ainda nao rodou)')
union all select 8, '004', 'imobiliarias cadastradas',
       coalesce((select v from imob), '(tabela ainda nao existe)')
union all select 9, '004', 'linhas orfas (super admin nao conta)',
       case when not exists (select 1 from cols) then '(coluna ainda nao existe)'
            else coalesce((select string_agg(table_name || '=' || n, '  ' order by table_name)
                             from orfas where n > 0), 'nenhuma') end
union all select 10, '004', 'contas com cargo super_admin',
       coalesce((select n from sadmin), '(tabela profiles nao existe)')
union all select 11, '004', 'policies no schema public',
       (select count(*)::text from pg_policies where schemaname = 'public')
union all select 12, '004', 'buckets do Storage',
       coalesce((select string_agg(id, ', ' order by id) from storage.buckets), '(nenhum)')
       || '   -- esperado: documentos, imoveis'
union all select 13, '005', 'chaves unicas (id, imobiliaria_id)',
       (select count(*) from pg_constraint
         where right(conname, 7) = '_tenant' and contype = 'u') || ' de 6'
union all select 14, '005', 'FKs compostas de tenant',
       (select count(*) from pg_constraint
         where right(conname, 7) = '_tenant' and contype = 'f') || ' de 17'
order by 1;
