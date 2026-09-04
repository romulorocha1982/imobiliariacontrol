/**
 * Geracao do texto do contrato a partir de um modelo.
 *
 * O modelo guarda MARCADORES -- {{locatario.nome}}, {{imovel.endereco}} -- e
 * nunca o valor. Um modelo com valor gravado serviria uma vez so.
 *
 * Marcador sem dado vira `[campo nao preenchido]`, bem visivel. A alternativa,
 * trocar por vazio, produziria um contrato com um buraco silencioso no meio de
 * uma clausula -- exatamente o tipo de erro que so aparece depois de assinado.
 */
import { moeda, data as fmtData, mascaraCpfCnpj, enderecoLinha } from '@/lib/format'
import { LABEL_GARANTIA } from '@/lib/types'
import type { Cliente, ContratoCompleto, Imobiliaria, Imovel, Proprietario } from '@/lib/types'

export type Clausula = { titulo: string; texto: string }

export const AUSENTE = '[campo nao preenchido]'

/* ---------------------------------------------------------- por extenso -- */

const UNIDADES = ['', 'um', 'dois', 'tres', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove']
const DEZ_A_DEZENOVE = [
  'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete',
  'dezoito', 'dezenove',
]
const DEZENAS = [
  '', '', 'vinte', 'trinta', 'quarenta', 'cinquenta', 'sessenta', 'setenta',
  'oitenta', 'noventa',
]
const CENTENAS = [
  '', 'cento', 'duzentos', 'trezentos', 'quatrocentos', 'quinhentos',
  'seiscentos', 'setecentos', 'oitocentos', 'novecentos',
]

/** Escreve um numero de 0 a 999. */
function ate999(n: number): string {
  if (n === 0) return ''
  if (n === 100) return 'cem'

  const c = Math.floor(n / 100)
  const resto = n % 100
  const partes: string[] = []

  if (c > 0) partes.push(CENTENAS[c])

  if (resto >= 10 && resto <= 19) {
    partes.push(DEZ_A_DEZENOVE[resto - 10])
  } else {
    const d = Math.floor(resto / 10)
    const u = resto % 10
    if (d > 0) partes.push(DEZENAS[d])
    if (u > 0) partes.push(UNIDADES[u])
  }

  return partes.join(' e ')
}

/**
 * Valor por extenso, como manda o costume em contrato: "R$ 1.250,00 (mil
 * duzentos e cinquenta reais)". Cobre ate milhoes, que e muito mais do que um
 * aluguel precisa.
 */
export function porExtenso(valor: number | null | undefined): string {
  const v = Math.abs(Math.round((valor ?? 0) * 100))
  const reais = Math.floor(v / 100)
  const centavos = v % 100

  if (reais === 0 && centavos === 0) return 'zero real'

  const partes: string[] = []

  const milhoes = Math.floor(reais / 1_000_000)
  const milhares = Math.floor((reais % 1_000_000) / 1000)
  const resto = reais % 1000

  if (milhoes > 0) partes.push(`${milhoes === 1 ? 'um milhao' : `${ate999(milhoes)} milhoes`}`)
  if (milhares > 0) partes.push(milhares === 1 ? 'mil' : `${ate999(milhares)} mil`)
  if (resto > 0) partes.push(ate999(resto))

  let texto = partes.join(partes.length > 1 && resto > 0 && resto < 100 ? ' e ' : ' e ')
  if (reais > 0) texto += reais === 1 ? ' real' : ' reais'

  if (centavos > 0) {
    const c = `${ate999(centavos)} ${centavos === 1 ? 'centavo' : 'centavos'}`
    texto = reais > 0 ? `${texto} e ${c}` : c
  }

  return texto
}

/** "R$ 240,00 (duzentos e quarenta reais)" */
function moedaExtenso(v: number | null | undefined): string {
  return `${moeda(v ?? 0)} (${porExtenso(v)})`
}

/* ------------------------------------------------------------ marcadores -- */

export type DadosContrato = {
  contrato: ContratoCompleto
  imovel: Imovel | null
  locador: Proprietario | null
  locatario: Cliente | null
  fiador: Cliente | null
  imobiliaria: Imobiliaria | null
}

/** Catalogo mostrado na tela de modelos, para ninguem ter que adivinhar. */
export const MARCADORES: { chave: string; descricao: string }[] = [
  { chave: 'contrato.numero',      descricao: 'Numero do contrato' },
  { chave: 'contrato.inicio',      descricao: 'Data de inicio da vigencia' },
  { chave: 'contrato.fim',         descricao: 'Data de termino da vigencia' },
  { chave: 'contrato.meses',       descricao: 'Duracao em meses' },
  { chave: 'contrato.aluguel',     descricao: 'Valor do aluguel, com extenso' },
  { chave: 'contrato.condominio',  descricao: 'Valor do condominio' },
  { chave: 'contrato.iptu',        descricao: 'Valor do IPTU' },
  { chave: 'contrato.vencimento',  descricao: 'Dia do vencimento' },
  { chave: 'contrato.reajuste',    descricao: 'Indice de reajuste' },
  { chave: 'contrato.garantia',    descricao: 'Modalidade de garantia' },
  { chave: 'contrato.caucao',      descricao: 'Valor da caucao, com extenso' },

  { chave: 'imovel.codigo',        descricao: 'Codigo do imovel' },
  { chave: 'imovel.endereco',      descricao: 'Endereco completo' },
  { chave: 'imovel.cidade',        descricao: 'Cidade do imovel' },
  { chave: 'imovel.estado',        descricao: 'UF do imovel' },

  { chave: 'locador.nome',         descricao: 'Nome do proprietario' },
  { chave: 'locador.cpf',          descricao: 'CPF ou CNPJ do proprietario' },
  { chave: 'locador.rg',           descricao: 'RG do proprietario' },
  { chave: 'locador.endereco',     descricao: 'Endereco do proprietario' },

  { chave: 'locatario.nome',       descricao: 'Nome do inquilino' },
  { chave: 'locatario.cpf',        descricao: 'CPF ou CNPJ do inquilino' },
  { chave: 'locatario.rg',         descricao: 'RG do inquilino' },
  { chave: 'locatario.estadocivil', descricao: 'Estado civil do inquilino' },
  { chave: 'locatario.profissao',  descricao: 'Profissao do inquilino' },
  { chave: 'locatario.endereco',   descricao: 'Endereco do inquilino' },

  { chave: 'fiador.nome',          descricao: 'Nome do fiador' },
  { chave: 'fiador.cpf',           descricao: 'CPF ou CNPJ do fiador' },
  { chave: 'fiador.rg',            descricao: 'RG do fiador' },
  { chave: 'fiador.endereco',      descricao: 'Endereco do fiador' },

  { chave: 'imobiliaria.nome',     descricao: 'Nome da imobiliaria' },
  { chave: 'imobiliaria.cpf',      descricao: 'CNPJ da imobiliaria' },
  { chave: 'imobiliaria.cidade',   descricao: 'Cidade da imobiliaria' },

  { chave: 'hoje',                 descricao: 'Data de hoje' },
  { chave: 'hoje.extenso',         descricao: 'Data de hoje por extenso' },
]

const MESES = [
  'janeiro', 'fevereiro', 'marco', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
]

function mesesEntre(inicio: string, fim: string): number {
  const a = new Date(inicio)
  const b = new Date(fim)
  return Math.max(
    1,
    Math.round((b.getTime() - a.getTime()) / (1000 * 60 * 60 * 24 * 30.44)),
  )
}

/**
 * `enderecoLinha` devolve a frase "Endereco nao informado" quando nao ha dado,
 * o que num contrato apareceria no meio da qualificacao da parte. Aqui isso
 * precisa virar ausencia, para o marcador acusar o campo faltando.
 */
function enderecoOuNulo(o: Parameters<typeof enderecoLinha>[0]): string | null {
  const s = enderecoLinha(o)
  return s === 'Endereco nao informado' ? null : s
}

function pessoa(p: Cliente | Proprietario | null, campo: string): string | null {
  if (!p) return null
  switch (campo) {
    case 'nome':       return p.nome
    case 'cpf':        return p.cpf_cnpj ? mascaraCpfCnpj(p.cpf_cnpj) : null
    case 'rg':         return p.rg
    case 'endereco':   return enderecoOuNulo(p)
    case 'estadocivil': return 'estado_civil' in p ? p.estado_civil : null
    case 'profissao':  return 'profissao' in p ? p.profissao : null
    default:           return null
  }
}

/** Devolve o valor de um marcador, ou null quando nao ha dado. */
function valorDoMarcador(chave: string, d: DadosContrato): string | null {
  const [grupo, campo = ''] = chave.split('.')
  const c = d.contrato

  if (chave === 'hoje') return fmtData(new Date().toISOString())
  if (chave === 'hoje.extenso') {
    const h = new Date()
    return `${h.getDate()} de ${MESES[h.getMonth()]} de ${h.getFullYear()}`
  }

  switch (grupo) {
    case 'contrato':
      switch (campo) {
        case 'numero':     return c.numero
        case 'inicio':     return fmtData(c.data_inicio)
        case 'fim':        return fmtData(c.data_fim)
        case 'meses':      return String(mesesEntre(c.data_inicio, c.data_fim))
        case 'aluguel':    return moedaExtenso(c.valor_aluguel)
        case 'condominio': return c.valor_condominio ? moeda(c.valor_condominio) : null
        case 'iptu':       return c.valor_iptu ? moeda(c.valor_iptu) : null
        case 'vencimento': return String(c.dia_vencimento)
        case 'reajuste':   return c.indice_reajuste
        case 'garantia':   return LABEL_GARANTIA[c.garantia]
        case 'caucao':     return c.valor_caucao ? moedaExtenso(c.valor_caucao) : null
        default:           return null
      }

    case 'imovel':
      if (!d.imovel) return null
      switch (campo) {
        case 'codigo':   return d.imovel.codigo
        case 'endereco': return enderecoOuNulo(d.imovel)
        case 'cidade':   return d.imovel.cidade
        case 'estado':   return d.imovel.estado
        default:         return null
      }

    case 'locador':   return pessoa(d.locador, campo)
    case 'locatario': return pessoa(d.locatario, campo)
    case 'fiador':    return pessoa(d.fiador, campo)

    case 'imobiliaria':
      if (!d.imobiliaria) return null
      switch (campo) {
        case 'nome':   return d.imobiliaria.razao_social || d.imobiliaria.nome
        case 'cpf':    return d.imobiliaria.cpf_cnpj ? mascaraCpfCnpj(d.imobiliaria.cpf_cnpj) : null
        case 'cidade': return d.imobiliaria.cidade
        default:       return null
      }

    default: return null
  }
}

/** Troca todo {{marcador}} pelo valor. O que nao tiver dado fica visivel. */
export function resolverMarcadores(texto: string, d: DadosContrato): string {
  return texto.replace(/\{\{\s*([a-z_.]+)\s*\}\}/gi, (_, chave: string) => {
    return valorDoMarcador(chave.trim().toLowerCase(), d) ?? AUSENTE
  })
}

/** Quais marcadores deste texto ficariam sem valor. Avisa antes de gerar. */
export function marcadoresSemDado(textos: string[], d: DadosContrato): string[] {
  const faltando = new Set<string>()
  for (const t of textos) {
    for (const m of t.matchAll(/\{\{\s*([a-z_.]+)\s*\}\}/gi)) {
      const chave = m[1].trim().toLowerCase()
      if (valorDoMarcador(chave, d) === null) faltando.add(chave)
    }
  }
  return [...faltando]
}
