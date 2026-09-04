-- =============================================================================
-- IMOBILIARIA CONTROL - Trava de integridade entre imobiliarias
-- Execute DEPOIS de 004_multitenancy.sql
--
-- O QUE FAZ
--   Impede fisicamente, no banco, que um registro de uma imobiliaria aponte para
--   registro de outra - por exemplo um contrato da A usando um imovel da B.
--   Funciona MESMO SE a RLS falhar ou for mal configurada numa migracao futura.
--
--   Nao substitui a RLS: e a segunda rede. A RLS impede LER o dado do outro;
--   isto impede GRAVAR uma referencia cruzada.
--
-- POR QUE AGORA
--   So existe uma imobiliaria, entao e impossivel haver dado inconsistente e as
--   constraints entram sem validar nada de errado. Com varios clientes em uso,
--   qualquer linha torta bloquearia a migracao inteira.
--
-- COMO FUNCIONA
--   Para cada relacao, um `unique (id, imobiliaria_id)` na tabela pai e uma
--   chave estrangeira COMPOSTA na filha. Como imobiliaria_id e o mesmo dos dois
--   lados da FK, o banco so aceita o vinculo dentro da mesma imobiliaria.
--
--   As FKs originais do 001 sao PRESERVADAS, com o `on delete` que ja tinham.
--   As compostas entram como `no action deferrable initially deferred`: elas so
--   sao conferidas no COMMIT, ou seja, DEPOIS que o `set null` / `cascade` da FK
--   original ja rodou. Assim nada muda no comportamento de exclusao - apagar um
--   proprietario continua anulando o vinculo do imovel, apagar um imovel continua
--   apagando as fotos - e a checagem nao depende da ordem em que os gatilhos de
--   integridade disparam.
--
-- Idempotente: pode rodar de novo sem quebrar.
-- =============================================================================


-- -----------------------------------------------------------------------------
-- Chaves auxiliares nas tabelas PAI
-- (id ja e unico sozinho; o par e o que a FK composta precisa referenciar)
-- -----------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'profiles','proprietarios','imoveis','clientes','contratos','negociacoes'
  ]
  loop
    begin
      execute format(
        'alter table public.%I add constraint %I unique (id, imobiliaria_id)',
        t, t || '_id_tenant');
    exception when duplicate_object or duplicate_table then null;
    end;
  end loop;
end;
$$;


-- -----------------------------------------------------------------------------
-- Chaves estrangeiras compostas nas tabelas FILHAS
--
-- Colunas anulaveis (fiador_id, corretor_id, imovel_id em lancamentos...) seguem
-- funcionando: numa FK composta o Postgres usa MATCH SIMPLE por padrao, entao se
-- qualquer coluna da chave for NULL a restricao esta satisfeita.
-- -----------------------------------------------------------------------------
do $$
declare
  -- filha, coluna da filha, pai
  r  text[];
  rs text[][] := array[
    -- imoveis
    array['imoveis',      'proprietario_id', 'proprietarios'],
    -- fotos
    array['imovel_fotos', 'imovel_id',       'imoveis'],
    -- contratos
    array['contratos',    'imovel_id',       'imoveis'],
    array['contratos',    'inquilino_id',    'clientes'],
    array['contratos',    'fiador_id',       'clientes'],
    array['contratos',    'corretor_id',     'profiles'],
    -- lancamentos
    array['lancamentos',  'contrato_id',     'contratos'],
    array['lancamentos',  'imovel_id',       'imoveis'],
    array['lancamentos',  'cliente_id',      'clientes'],
    array['lancamentos',  'proprietario_id', 'proprietarios'],
    -- negociacoes
    array['negociacoes',  'cliente_id',      'clientes'],
    array['negociacoes',  'imovel_id',       'imoveis'],
    array['negociacoes',  'corretor_id',     'profiles'],
    -- visitas
    array['visitas',      'negociacao_id',   'negociacoes'],
    array['visitas',      'imovel_id',       'imoveis'],
    array['visitas',      'cliente_id',      'clientes'],
    array['visitas',      'corretor_id',     'profiles']
  ];
begin
  foreach r slice 1 in array rs
  loop
    begin
      execute format(
        'alter table public.%I add constraint %I
           foreign key (%I, imobiliaria_id)
           references public.%I (id, imobiliaria_id)
           on delete no action
           deferrable initially deferred',
        r[1], r[1] || '_' || r[2] || '_tenant', r[2], r[3]);
    exception when duplicate_object then null;
    end;
  end loop;
end;
$$;


-- =============================================================================
-- VERIFICACAO
-- =============================================================================
--
-- 1) As 17 constraints compostas foram criadas?
--
--   select conrelid::regclass as tabela, conname
--     from pg_constraint
--    where contype = 'f' and conname like '%\_tenant'
--    order by 1, 2;
--
-- 2) Teste pratico (rode e espere ERRO). Troque os uuids por ids reais de
--    imobiliarias diferentes:
--
--   insert into public.imoveis (imobiliaria_id, titulo, proprietario_id)
--   values ('<imobiliaria A>', 'teste', '<proprietario da imobiliaria B>');
--   -- esperado: violates foreign key constraint "imoveis_proprietario_id_tenant"
--
-- 3) Confirme que a exclusao continua se comportando como antes: apagar um
--    proprietario deve ANULAR imoveis.proprietario_id, nao dar erro.
-- =============================================================================
