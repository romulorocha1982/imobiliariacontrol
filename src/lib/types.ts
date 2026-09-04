/** Tipos do dominio - espelham o schema em supabase/migrations/001_schema.sql */

/**
 * `super_admin` e o dono da plataforma. Por desenho ele NAO enxerga dado
 * operacional de nenhuma imobiliaria: seu `imobiliaria_id` e null, e como toda
 * policy compara `imobiliaria_id = minha_imobiliaria()`, nenhuma linha casa.
 */
export type UserRole = 'admin' | 'gerente' | 'corretor' | 'financeiro' | 'super_admin'

/** Cargos que existem dentro de uma imobiliaria (exclui o super admin). */
export const CARGOS_EQUIPE: UserRole[] = ['admin', 'gerente', 'corretor', 'financeiro']

export type ImovelTipo =
  | 'apartamento' | 'casa' | 'sobrado' | 'kitnet' | 'terreno'
  | 'sala_comercial' | 'loja' | 'galpao' | 'chacara' | 'sitio' | 'fazenda' | 'outro'

export type ImovelFinalidade = 'venda' | 'locacao' | 'ambos'

export type ImovelStatus =
  | 'disponivel' | 'alugado' | 'vendido' | 'reservado' | 'manutencao' | 'inativo'

export type ClienteTipo = 'inquilino' | 'comprador' | 'interessado' | 'fiador'

export type ContratoStatus = 'pendente' | 'ativo' | 'encerrado' | 'rescindido'

export type GarantiaTipo =
  | 'fiador' | 'caucao' | 'seguro_fianca' | 'titulo_capitalizacao' | 'sem_garantia'

export type LancamentoTipo = 'receita' | 'despesa'

export type LancamentoCategoria =
  | 'aluguel' | 'repasse_proprietario' | 'taxa_administracao' | 'comissao_venda'
  | 'condominio' | 'iptu' | 'manutencao' | 'multa_juros' | 'caucao' | 'venda' | 'outros'

export type LancamentoStatus = 'pendente' | 'pago' | 'atrasado' | 'cancelado'

export type NegociacaoEtapa =
  | 'lead' | 'contato' | 'visita' | 'proposta' | 'negociacao' | 'fechado' | 'perdido'

// -----------------------------------------------------------------------------
// Registros
// -----------------------------------------------------------------------------

/** A imobiliaria e o tenant: e ela que isola os dados de um cliente do outro. */
export type Imobiliaria = {
  id: string
  nome: string
  razao_social: string | null
  cpf_cnpj: string | null
  /** Codigo de acesso de 6 digitos, usado no login e no cadastro da equipe. */
  codigo: string
  email: string | null
  telefone: string | null
  cidade: string | null
  estado: string | null
  plano: string
  ativa: boolean
  observacoes: string | null
  created_at: string
  updated_at: string
}

/** Retorno de painel_imobiliarias(): so agregados, nenhuma linha operacional. */
export type PainelImobiliaria = Omit<Imobiliaria, 'observacoes' | 'updated_at'> & {
  total_usuarios: number
  total_imoveis: number
  total_contratos_ativos: number
  /** Ultimo login de qualquer usuario da imobiliaria. */
  ultimo_acesso: string | null
}

export type Profile = {
  id: string
  /** null apenas para super_admin - garantido pelo check profiles_tenant_coerente */
  imobiliaria_id: string | null
  nome: string
  email: string | null
  telefone: string | null
  creci: string | null
  cargo: UserRole
  ativo: boolean
  avatar_url: string | null
  created_at: string
  updated_at: string
}

/** Perfil com a imobiliaria embutida - o que o AuthContext carrega no login. */
export type PerfilCompleto = Profile & {
  imobiliaria: Imobiliaria | null
}

type Endereco = {
  cep: string | null
  logradouro: string | null
  numero: string | null
  complemento: string | null
  bairro: string | null
  cidade: string | null
  estado: string | null
}

export type Proprietario = Endereco & {
  id: string
  imobiliaria_id: string
  nome: string
  cpf_cnpj: string | null
  rg: string | null
  email: string | null
  telefone: string | null
  telefone2: string | null
  banco: string | null
  agencia: string | null
  conta: string | null
  tipo_conta: string | null
  pix: string | null
  observacoes: string | null
  ativo: boolean
  created_at: string
  updated_at: string
  created_by: string | null
}

export type Imovel = Endereco & {
  id: string
  imobiliaria_id: string
  /** Unico dentro da imobiliaria, nao globalmente: A e B tem seu proprio IM-0001 */
  codigo: string | null
  titulo: string
  tipo: ImovelTipo
  finalidade: ImovelFinalidade
  status: ImovelStatus
  proprietario_id: string | null
  area_total: number | null
  area_util: number | null
  quartos: number | null
  suites: number | null
  banheiros: number | null
  vagas: number | null
  andar: number | null
  mobiliado: boolean
  aceita_pet: boolean
  descricao: string | null
  valor_venda: number | null
  valor_aluguel: number | null
  valor_condominio: number | null
  valor_iptu: number | null
  taxa_administracao: number | null
  comissao_venda: number | null
  matricula: string | null
  inscricao_municipal: string | null
  observacoes: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

/** Linha da view vw_imoveis_completo */
export type ImovelCompleto = Imovel & {
  proprietario_nome: string | null
  proprietario_telefone: string | null
  foto_capa: string | null
}

export type ImovelFoto = {
  id: string
  imobiliaria_id: string
  imovel_id: string
  url: string
  path: string | null
  ordem: number
  capa: boolean
  created_at: string
}

/**
 * Retorno de `gerar_parcelas_contrato`. O botao nao apenas cria: ele sincroniza
 * os lancamentos em aberto com os valores atuais do contrato, e remove o que
 * deixou de valer -- taxa de administracao zerada, meses que sairam da vigencia.
 * Lancamento pago ou cancelado nunca entra nessas contas.
 */
export type SincronizacaoParcelas = {
  criados: number
  atualizados: number
  removidos: number
}

/**
 * Tipos de documento aceitos. Espelha o check `documentos_tipo_valido` da
 * migracao 006 -- se acrescentar um aqui, acrescente la tambem.
 */
export type TipoDocumento =
  | 'vistoria'
  | 'contrato_assinado'
  | 'aditivo'
  | 'identidade'
  | 'comprovante_renda'
  | 'matricula'
  | 'outro'

/**
 * Arquivo anexado a um imovel, contrato ou cliente. Exatamente um dos tres
 * vinculos e preenchido -- o check `documentos_um_vinculo` garante.
 *
 * O binario vive no bucket privado `documentos`; `path` e a chave la dentro, e
 * so vira URL por meio de link assinado que expira.
 */
export type Documento = {
  id: string
  imobiliaria_id: string
  tipo: TipoDocumento
  titulo: string | null
  observacoes: string | null
  path: string
  nome_arquivo: string
  mime: string | null
  tamanho: number | null
  imovel_id: string | null
  contrato_id: string | null
  cliente_id: string | null
  created_at: string
  created_by: string | null
}

export type Cliente = Endereco & {
  id: string
  imobiliaria_id: string
  nome: string
  tipo: ClienteTipo
  cpf_cnpj: string | null
  rg: string | null
  email: string | null
  telefone: string | null
  telefone2: string | null
  data_nascimento: string | null
  estado_civil: string | null
  profissao: string | null
  renda: number | null
  observacoes: string | null
  ativo: boolean
  created_at: string
  updated_at: string
  created_by: string | null
}

export type Contrato = {
  id: string
  imobiliaria_id: string
  /** Unico dentro da imobiliaria: cada uma tem seu proprio CT-2026-0001 */
  numero: string | null
  imovel_id: string
  inquilino_id: string
  fiador_id: string | null
  corretor_id: string | null
  data_inicio: string
  data_fim: string
  dia_vencimento: number
  valor_aluguel: number
  valor_condominio: number | null
  valor_iptu: number | null
  taxa_administracao: number
  indice_reajuste: string | null
  mes_reajuste: number | null
  garantia: GarantiaTipo
  valor_caucao: number | null
  status: ContratoStatus
  data_rescisao: string | null
  motivo_rescisao: string | null
  observacoes: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

/** Linha da view vw_contratos_completo */
export type ContratoCompleto = Contrato & {
  imovel_codigo: string | null
  imovel_titulo: string
  imovel_bairro: string | null
  imovel_cidade: string | null
  inquilino_nome: string
  inquilino_telefone: string | null
  fiador_nome: string | null
  proprietario_nome: string | null
  dias_para_vencer: number
}

export type Lancamento = {
  id: string
  imobiliaria_id: string
  tipo: LancamentoTipo
  categoria: LancamentoCategoria
  status: LancamentoStatus
  descricao: string
  valor: number
  competencia: string | null
  vencimento: string
  data_pagamento: string | null
  valor_pago: number | null
  forma_pagamento: string | null
  contrato_id: string | null
  imovel_id: string | null
  cliente_id: string | null
  proprietario_id: string | null
  observacoes: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

/** Linha da view vw_lancamentos_completo */
export type LancamentoCompleto = Lancamento & {
  imovel_codigo: string | null
  imovel_titulo: string | null
  cliente_nome: string | null
  proprietario_nome: string | null
  contrato_numero: string | null
  dias_atraso: number
}

export type Negociacao = {
  id: string
  imobiliaria_id: string
  cliente_id: string
  imovel_id: string | null
  corretor_id: string | null
  etapa: NegociacaoEtapa
  valor_proposta: number | null
  origem: string | null
  data_prevista_fechamento: string | null
  motivo_perda: string | null
  observacoes: string | null
  created_at: string
  updated_at: string
  created_by: string | null
}

export type NegociacaoCompleta = Negociacao & {
  cliente?: { nome: string; telefone: string | null } | null
  imovel?: { codigo: string | null; titulo: string } | null
  corretor?: { nome: string } | null
}

export type Visita = {
  id: string
  imobiliaria_id: string
  negociacao_id: string | null
  imovel_id: string
  cliente_id: string
  corretor_id: string | null
  data_hora: string
  realizada: boolean
  feedback: string | null
  created_at: string
  created_by: string | null
}

export type Auditoria = {
  id: number
  imobiliaria_id: string
  tabela: string
  registro_id: string | null
  acao: string
  usuario_id: string | null
  usuario_nome: string | null
  dados_antes: Record<string, unknown> | null
  dados_depois: Record<string, unknown> | null
  created_at: string
}

export type DashboardResumo = {
  imoveis_total: number
  imoveis_disponiveis: number
  imoveis_alugados: number
  imoveis_vendidos: number
  contratos_ativos: number
  contratos_vencendo: number
  clientes_total: number
  proprietarios_total: number
  a_receber_mes: number
  a_pagar_mes: number
  recebido_mes: number
  inadimplencia: number
  inadimplentes_qtd: number
  negociacoes_abertas: number
  visitas_semana: number
}

// -----------------------------------------------------------------------------
// Tipo do banco para o createClient
// -----------------------------------------------------------------------------

/**
 * Formato esperado pelo supabase-js v2: cada tabela precisa de
 * Row / Insert / Update / Relationships; cada view, de Row / Relationships.
 * Sem essas chaves o cliente resolve os argumentos como `never`.
 */
type Tabela<Row> = {
  Row: Row
  Insert: Partial<Row>
  Update: Partial<Row>
  Relationships: []
}

/**
 * Tabela multi-tenant: o INSERT EXIGE imobiliaria_id, todo o resto continua
 * opcional.
 *
 * E de proposito que isso incomode. Como o projeto nao tem testes nem lint,
 * `npm run typecheck` e a unica rede de seguranca automatica - e assim ele
 * quebra a compilacao se alguem escrever um insert sem o tenant, em vez de o
 * erro aparecer so em producao como uma linha gravada na imobiliaria errada.
 *
 * Use `comTenant()` do AuthContext para preencher.
 */
type TabelaTenant<Row extends { imobiliaria_id: string }> = {
  Row: Row
  Insert: Partial<Omit<Row, 'imobiliaria_id'>> & Pick<Row, 'imobiliaria_id'>
  /** As telas mandam o registro inteiro no update; a RLS aprova por ser o mesmo
   *  tenant, e o trigger trg_proteger_profile barra qualquer troca. */
  Update: Partial<Row>
  Relationships: []
}

type Visao<Row> = {
  Row: Row
  Relationships: []
}

export type Database = {
  public: {
    Tables: {
      imobiliarias: Tabela<Imobiliaria>
      /** A relacao precisa ser declarada para o embed `imobiliaria:imobiliarias(*)`
       *  que o AuthContext usa ao carregar o perfil. */
      profiles: {
        Row: Profile
        Insert: Partial<Profile>
        Update: Partial<Profile>
        Relationships: [
          {
            foreignKeyName: 'profiles_imobiliaria_id_fkey'
            columns: ['imobiliaria_id']
            isOneToOne: false
            referencedRelation: 'imobiliarias'
            referencedColumns: ['id']
          },
        ]
      }
      proprietarios: TabelaTenant<Proprietario>
      imoveis: TabelaTenant<Imovel>
      imovel_fotos: TabelaTenant<ImovelFoto>
      documentos: TabelaTenant<Documento>
      clientes: TabelaTenant<Cliente>
      contratos: TabelaTenant<Contrato>
      lancamentos: TabelaTenant<Lancamento>
      /**
       * As relacoes precisam ser declaradas para o PostgREST tipar os embeds
       * usados no CRM: `cliente:clientes(...)`, `imovel:imoveis(...)`,
       * `corretor:profiles(...)`. Os nomes seguem o padrao do Postgres para
       * chaves estrangeiras declaradas inline: <tabela>_<coluna>_fkey.
       */
      negociacoes: {
        Row: Negociacao
        Insert: Partial<Omit<Negociacao, 'imobiliaria_id'>> & Pick<Negociacao, 'imobiliaria_id'>
        Update: Partial<Negociacao>
        Relationships: [
          {
            foreignKeyName: 'negociacoes_cliente_id_fkey'
            columns: ['cliente_id']
            isOneToOne: false
            referencedRelation: 'clientes'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'negociacoes_imovel_id_fkey'
            columns: ['imovel_id']
            isOneToOne: false
            referencedRelation: 'imoveis'
            referencedColumns: ['id']
          },
          {
            foreignKeyName: 'negociacoes_corretor_id_fkey'
            columns: ['corretor_id']
            isOneToOne: false
            referencedRelation: 'profiles'
            referencedColumns: ['id']
          },
        ]
      }
      visitas: TabelaTenant<Visita>
      auditoria: TabelaTenant<Auditoria>
    }
    Views: {
      vw_imoveis_completo: Visao<ImovelCompleto>
      vw_contratos_completo: Visao<ContratoCompleto>
      vw_lancamentos_completo: Visao<LancamentoCompleto>
    }
    Functions: {
      dashboard_resumo: {
        Args: Record<PropertyKey, never>
        Returns: DashboardResumo
      }
      gerar_parcelas_contrato: {
        Args: { p_contrato_id: string }
        Returns: SincronizacaoParcelas
      }
      marcar_atrasados: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      baixar_lancamento: {
        Args: { p_id: string; p_valor?: number; p_data?: string; p_forma?: string }
        Returns: undefined
      }
      /** Painel do super admin. Devolve lista vazia para qualquer outro cargo. */
      painel_imobiliarias: {
        Args: Record<PropertyKey, never>
        Returns: PainelImobiliaria[]
      }
    }
    Enums: {
      user_role: UserRole
      imovel_tipo: ImovelTipo
      imovel_finalidade: ImovelFinalidade
      imovel_status: ImovelStatus
      cliente_tipo: ClienteTipo
      contrato_status: ContratoStatus
      garantia_tipo: GarantiaTipo
      lancamento_tipo: LancamentoTipo
      lancamento_categoria: LancamentoCategoria
      lancamento_status: LancamentoStatus
      negociacao_etapa: NegociacaoEtapa
    }
    CompositeTypes: Record<PropertyKey, never>
  }
}

// -----------------------------------------------------------------------------
// Rotulos para exibicao
// -----------------------------------------------------------------------------

export const LABEL_CARGO: Record<UserRole, string> = {
  admin: 'Administrador',
  gerente: 'Gerente',
  corretor: 'Corretor',
  financeiro: 'Financeiro',
  super_admin: 'Administrador da plataforma',
}

export const LABEL_TIPO_IMOVEL: Record<ImovelTipo, string> = {
  apartamento: 'Apartamento',
  casa: 'Casa',
  sobrado: 'Sobrado',
  kitnet: 'Kitnet',
  terreno: 'Terreno',
  sala_comercial: 'Sala comercial',
  loja: 'Loja',
  galpao: 'Galpao',
  chacara: 'Chacara',
  sitio: 'Sitio',
  fazenda: 'Fazenda',
  outro: 'Outro',
}

export const LABEL_FINALIDADE: Record<ImovelFinalidade, string> = {
  venda: 'Venda',
  locacao: 'Locacao',
  ambos: 'Venda e locacao',
}

export const LABEL_STATUS_IMOVEL: Record<ImovelStatus, string> = {
  disponivel: 'Disponivel',
  alugado: 'Alugado',
  vendido: 'Vendido',
  reservado: 'Reservado',
  manutencao: 'Em manutencao',
  inativo: 'Inativo',
}

export const LABEL_TIPO_CLIENTE: Record<ClienteTipo, string> = {
  inquilino: 'Inquilino',
  comprador: 'Comprador',
  interessado: 'Interessado',
  fiador: 'Fiador',
}

export const LABEL_STATUS_CONTRATO: Record<ContratoStatus, string> = {
  pendente: 'Pendente',
  ativo: 'Ativo',
  encerrado: 'Encerrado',
  rescindido: 'Rescindido',
}

export const LABEL_GARANTIA: Record<GarantiaTipo, string> = {
  fiador: 'Fiador',
  caucao: 'Caucao',
  seguro_fianca: 'Seguro fianca',
  titulo_capitalizacao: 'Titulo de capitalizacao',
  sem_garantia: 'Sem garantia',
}

export const LABEL_CATEGORIA: Record<LancamentoCategoria, string> = {
  aluguel: 'Aluguel',
  repasse_proprietario: 'Repasse ao proprietario',
  taxa_administracao: 'Taxa de administracao',
  comissao_venda: 'Comissao de venda',
  condominio: 'Condominio',
  iptu: 'IPTU',
  manutencao: 'Manutencao',
  multa_juros: 'Multa e juros',
  caucao: 'Caucao',
  venda: 'Venda',
  outros: 'Outros',
}

export const LABEL_STATUS_LANCAMENTO: Record<LancamentoStatus, string> = {
  pendente: 'Pendente',
  pago: 'Pago',
  atrasado: 'Atrasado',
  cancelado: 'Cancelado',
}

export const LABEL_ETAPA: Record<NegociacaoEtapa, string> = {
  lead: 'Lead',
  contato: 'Contato feito',
  visita: 'Visita agendada',
  proposta: 'Proposta enviada',
  negociacao: 'Em negociacao',
  fechado: 'Fechado',
  perdido: 'Perdido',
}

/** Ordem das colunas do funil (exclui fechado/perdido, que sao terminais) */
export const ETAPAS_FUNIL: NegociacaoEtapa[] = [
  'lead', 'contato', 'visita', 'proposta', 'negociacao',
]

export const UF_LISTA = [
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG','PA','PB',
  'PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO',
] as const
