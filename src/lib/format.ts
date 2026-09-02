/** Formatacao e helpers de exibicao (pt-BR) */

export const moeda = (v: number | null | undefined): string =>
  new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  }).format(Number(v ?? 0))

export const moedaCurta = (v: number | null | undefined): string => {
  const n = Number(v ?? 0)
  if (Math.abs(n) >= 1_000_000) return `R$ ${(n / 1_000_000).toFixed(1).replace('.', ',')}M`
  if (Math.abs(n) >= 1_000) return `R$ ${(n / 1_000).toFixed(1).replace('.', ',')}k`
  return moeda(n)
}

export const numero = (v: number | null | undefined, casas = 0): string =>
  new Intl.NumberFormat('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  }).format(Number(v ?? 0))

/** '2026-09-02' ou ISO -> '02/09/2026' (sem escorregar de fuso) */
export const data = (v: string | null | undefined): string => {
  if (!v) return '-'
  const somenteData = v.slice(0, 10)
  const [a, m, d] = somenteData.split('-')
  if (!a || !m || !d) return '-'
  return `${d}/${m}/${a}`
}

export const dataHora = (v: string | null | undefined): string => {
  if (!v) return '-'
  const dt = new Date(v)
  if (Number.isNaN(dt.getTime())) return '-'
  return dt.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Competencia '2026-09-01' -> 'set/2026' */
export const competencia = (v: string | null | undefined): string => {
  if (!v) return '-'
  const [a, m] = v.slice(0, 10).split('-')
  const meses = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const idx = Number(m) - 1
  return meses[idx] ? `${meses[idx]}/${a}` : '-'
}

export const hoje = (): string => new Date().toISOString().slice(0, 10)

export const diasEntre = (de: string, ate: string): number =>
  Math.round((new Date(ate).getTime() - new Date(de).getTime()) / 86_400_000)

/** Mascaras */
export const mascaraCpfCnpj = (v: string): string => {
  const d = v.replace(/\D/g, '')
  if (d.length <= 11) {
    return d
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})$/, '$1-$2')
  }
  return d
    .slice(0, 14)
    .replace(/(\d{2})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1.$2')
    .replace(/(\d{3})(\d)/, '$1/$2')
    .replace(/(\d{4})(\d{1,2})$/, '$1-$2')
}

export const mascaraTelefone = (v: string): string => {
  const d = v.replace(/\D/g, '').slice(0, 11)
  if (d.length <= 10) return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{4})(\d)/, '$1-$2')
  return d.replace(/(\d{2})(\d)/, '($1) $2').replace(/(\d{5})(\d)/, '$1-$2')
}

export const mascaraCep = (v: string): string =>
  v.replace(/\D/g, '').slice(0, 8).replace(/(\d{5})(\d)/, '$1-$2')

/** Valida CPF e CNPJ de verdade (digitos verificadores) */
export const validarCpfCnpj = (valor: string): boolean => {
  const d = valor.replace(/\D/g, '')
  if (d.length === 11) {
    if (/^(\d)\1{10}$/.test(d)) return false
    let s = 0
    for (let i = 0; i < 9; i++) s += Number(d[i]) * (10 - i)
    let r = ((s * 10) % 11) % 10
    if (r !== Number(d[9])) return false
    s = 0
    for (let i = 0; i < 10; i++) s += Number(d[i]) * (11 - i)
    r = ((s * 10) % 11) % 10
    return r === Number(d[10])
  }
  if (d.length === 14) {
    if (/^(\d)\1{13}$/.test(d)) return false
    const calc = (base: string, pesos: number[]): number => {
      const s = base.split('').reduce((acc, ch, i) => acc + Number(ch) * pesos[i], 0)
      const r = s % 11
      return r < 2 ? 0 : 11 - r
    }
    const p1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const p2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]
    const dv1 = calc(d.slice(0, 12), p1)
    const dv2 = calc(d.slice(0, 13), p2)
    return dv1 === Number(d[12]) && dv2 === Number(d[13])
  }
  return false
}

/** Endereco em uma linha */
export const enderecoLinha = (o: {
  logradouro?: string | null
  numero?: string | null
  bairro?: string | null
  cidade?: string | null
  estado?: string | null
}): string => {
  const rua = [o.logradouro, o.numero].filter(Boolean).join(', ')
  const local = [o.bairro, o.cidade].filter(Boolean).join(' - ')
  return [rua, local, o.estado].filter(Boolean).join(', ') || 'Endereco nao informado'
}

export const iniciais = (nome: string): string =>
  nome
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('')
