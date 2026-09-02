import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Building2, FileText, Wallet, AlertTriangle, TrendingUp, Users,
  CalendarClock, Target, ArrowRight, CheckCircle2,
} from 'lucide-react'
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  PieChart, Pie, Cell, Legend,
} from 'recharts'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { Stat, Carregando, Vazio } from '@/components/ui'
import { moeda, moedaCurta, data, competencia } from '@/lib/format'
import type { DashboardResumo, ContratoCompleto, LancamentoCompleto } from '@/lib/types'

interface PontoMes {
  mes: string
  receitas: number
  despesas: number
}

interface FatiaStatus {
  nome: string
  valor: number
  cor: string
}

export default function Dashboard() {
  const { erro: toastErro } = useToast()
  const [resumo, setResumo] = useState<DashboardResumo | null>(null)
  const [fluxo, setFluxo] = useState<PontoMes[]>([])
  const [statusImoveis, setStatusImoveis] = useState<FatiaStatus[]>([])
  const [vencendo, setVencendo] = useState<ContratoCompleto[]>([])
  const [atrasados, setAtrasados] = useState<LancamentoCompleto[]>([])
  const [carregando, setCarregando] = useState(true)

  useEffect(() => {
    void carregar()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function carregar() {
    setCarregando(true)
    try {
      // Atualiza quem passou do vencimento antes de somar
      await supabase.rpc('marcar_atrasados')

      const [r1, r2, r3, r4, r5] = await Promise.all([
        supabase.rpc('dashboard_resumo'),
        supabase
          .from('lancamentos')
          .select('tipo, valor, valor_pago, vencimento, status')
          .gte('vencimento', mesesAtras(5))
          .neq('status', 'cancelado'),
        supabase.from('imoveis').select('status'),
        supabase
          .from('vw_contratos_completo')
          .select('*')
          .eq('status', 'ativo')
          .lte('data_fim', emDias(90))
          .order('data_fim')
          .limit(6),
        supabase
          .from('vw_lancamentos_completo')
          .select('*')
          .eq('tipo', 'receita')
          .eq('status', 'atrasado')
          .order('vencimento')
          .limit(6),
      ])

      if (r1.error) throw r1.error
      setResumo(r1.data as unknown as DashboardResumo)

      if (!r2.error && r2.data) setFluxo(montarFluxo(r2.data))
      if (!r3.error && r3.data) setStatusImoveis(montarStatus(r3.data))
      if (!r4.error && r4.data) setVencendo(r4.data as ContratoCompleto[])
      if (!r5.error && r5.data) setAtrasados(r5.data as LancamentoCompleto[])
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Erro desconhecido'
      toastErro('Nao foi possivel carregar o painel', msg)
    } finally {
      setCarregando(false)
    }
  }

  if (carregando) return <Carregando texto="Montando o painel..." />

  const r = resumo

  return (
    <div className="coluna" style={{ gap: 18 }}>
      {/* ------------------------------------------------- indicadores -- */}
      <div className="grade grade--4">
        <Stat
          rotulo="Imoveis"
          valor={r?.imoveis_total ?? 0}
          nota={`${r?.imoveis_disponiveis ?? 0} disponiveis - ${r?.imoveis_alugados ?? 0} alugados`}
          icone={<Building2 size={17} />}
          cor="primaria"
        />
        <Stat
          rotulo="Contratos ativos"
          valor={r?.contratos_ativos ?? 0}
          nota={
            (r?.contratos_vencendo ?? 0) > 0
              ? `${r?.contratos_vencendo} vencem em 90 dias`
              : 'Nenhum vencendo em 90 dias'
          }
          icone={<FileText size={17} />}
          cor="info"
        />
        <Stat
          rotulo="A receber no mes"
          valor={moedaCurta(r?.a_receber_mes)}
          nota={`Recebido: ${moedaCurta(r?.recebido_mes)}`}
          icone={<Wallet size={17} />}
          cor="ok"
        />
        <Stat
          rotulo="Inadimplencia"
          valor={moedaCurta(r?.inadimplencia)}
          nota={
            (r?.inadimplentes_qtd ?? 0) > 0
              ? `${r?.inadimplentes_qtd} cobranca(s) em atraso`
              : 'Tudo em dia'
          }
          icone={<AlertTriangle size={17} />}
          cor={(r?.inadimplencia ?? 0) > 0 ? 'erro' : 'ok'}
        />
      </div>

      {/* ------------------------------------------------------ graficos -- */}
      <div className="grade" style={{ gridTemplateColumns: '1.7fr 1fr' }}>
        <div className="card">
          <div className="card__topo">
            <TrendingUp size={16} color="var(--primaria)" />
            <span className="card__titulo">Receitas e despesas</span>
            <span className="t-3 t-xs" style={{ marginLeft: 'auto' }}>ultimos 6 meses</span>
          </div>
          <div className="card__corpo">
            {fluxo.length === 0 ? (
              <Vazio
                titulo="Sem movimentacao ainda"
                texto="Os lancamentos financeiros aparecem aqui assim que forem criados."
              />
            ) : (
              <ResponsiveContainer width="100%" height={252}>
                <BarChart data={fluxo} margin={{ top: 4, right: 4, left: -14, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis
                    dataKey="mes"
                    tick={{ fontSize: 11.5, fill: 'var(--texto-3)' }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    tick={{ fontSize: 11.5, fill: 'var(--texto-3)' }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v: number) => moedaCurta(v).replace('R$ ', '')}
                  />
                  <Tooltip
                    formatter={(v: number) => moeda(v)}
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      fontSize: 12.5,
                      boxShadow: 'var(--sombra-md)',
                      color: 'var(--texto)',
                    }}
                    cursor={{ fill: 'var(--surface-2)' }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12.5, paddingTop: 8 }}
                    iconType="circle"
                    iconSize={8}
                  />
                  <Bar dataKey="receitas" name="Receitas" fill="#059669" radius={[5, 5, 0, 0]} maxBarSize={38} />
                  <Bar dataKey="despesas" name="Despesas" fill="#dc2626" radius={[5, 5, 0, 0]} maxBarSize={38} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>

        <div className="card">
          <div className="card__topo">
            <Building2 size={16} color="var(--primaria)" />
            <span className="card__titulo">Situacao da carteira</span>
          </div>
          <div className="card__corpo">
            {statusImoveis.length === 0 ? (
              <Vazio titulo="Nenhum imovel cadastrado" />
            ) : (
              <ResponsiveContainer width="100%" height={252}>
                <PieChart>
                  <Pie
                    data={statusImoveis}
                    dataKey="valor"
                    nameKey="nome"
                    cx="50%"
                    cy="45%"
                    innerRadius={52}
                    outerRadius={82}
                    paddingAngle={2}
                    strokeWidth={0}
                  >
                    {statusImoveis.map((s) => (
                      <Cell key={s.nome} fill={s.cor} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: 'var(--surface)',
                      border: '1px solid var(--border)',
                      borderRadius: 10,
                      fontSize: 12.5,
                      color: 'var(--texto)',
                    }}
                  />
                  <Legend
                    wrapperStyle={{ fontSize: 12, paddingTop: 6 }}
                    iconType="circle"
                    iconSize={8}
                  />
                </PieChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>

      {/* ----------------------------------------------- listas de acao -- */}
      <div className="grade grade--2">
        <div className="card">
          <div className="card__topo">
            <CalendarClock size={16} color="var(--alerta)" />
            <span className="card__titulo">Contratos vencendo</span>
            <Link to="/contratos" className="btn btn--fantasma btn--sm" style={{ marginLeft: 'auto' }}>
              Ver todos <ArrowRight size={13} />
            </Link>
          </div>
          {vencendo.length === 0 ? (
            <Vazio
              icone={<CheckCircle2 size={22} />}
              titulo="Nenhum contrato vencendo"
              texto="Nada expira nos proximos 90 dias."
            />
          ) : (
            <div className="tabela-wrap" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Contrato</th>
                    <th>Inquilino</th>
                    <th>Vence em</th>
                    <th className="num">Aluguel</th>
                  </tr>
                </thead>
                <tbody>
                  {vencendo.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <span className="codigo">{c.numero}</span>
                        <div className="celula-fraca mt-0">{c.imovel_titulo}</div>
                      </td>
                      <td className="celula-forte">{c.inquilino_nome}</td>
                      <td>
                        <span
                          className={`badge badge--${
                            c.dias_para_vencer <= 30 ? 'erro' : 'alerta'
                          }`}
                        >
                          {c.dias_para_vencer <= 0
                            ? 'Vencido'
                            : `${c.dias_para_vencer} dias`}
                        </span>
                        <div className="celula-fraca mt-0">{data(c.data_fim)}</div>
                      </td>
                      <td className="num celula-forte">{moeda(c.valor_aluguel)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="card">
          <div className="card__topo">
            <AlertTriangle size={16} color="var(--erro)" />
            <span className="card__titulo">Cobrancas em atraso</span>
            <Link to="/financeiro" className="btn btn--fantasma btn--sm" style={{ marginLeft: 'auto' }}>
              Ver todas <ArrowRight size={13} />
            </Link>
          </div>
          {atrasados.length === 0 ? (
            <Vazio
              icone={<CheckCircle2 size={22} />}
              titulo="Nenhum atraso"
              texto="Todas as cobrancas estao em dia."
            />
          ) : (
            <div className="tabela-wrap" style={{ border: 'none', borderRadius: 0, boxShadow: 'none' }}>
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Cliente</th>
                    <th>Competencia</th>
                    <th>Atraso</th>
                    <th className="num">Valor</th>
                  </tr>
                </thead>
                <tbody>
                  {atrasados.map((l) => (
                    <tr key={l.id}>
                      <td>
                        <div className="celula-forte">{l.cliente_nome ?? '-'}</div>
                        <div className="celula-fraca">{l.imovel_codigo ?? ''}</div>
                      </td>
                      <td>{competencia(l.competencia)}</td>
                      <td>
                        <span className="badge badge--erro">{l.dias_atraso} dias</span>
                      </td>
                      <td className="num celula-forte">{moeda(l.valor)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ------------------------------------------------ atalhos rapidos -- */}
      <div className="grade grade--4">
        <Stat
          rotulo="Clientes"
          valor={r?.clientes_total ?? 0}
          icone={<Users size={17} />}
          cor="info"
        />
        <Stat
          rotulo="Proprietarios"
          valor={r?.proprietarios_total ?? 0}
          icone={<Users size={17} />}
          cor="acento"
        />
        <Stat
          rotulo="Negociacoes abertas"
          valor={r?.negociacoes_abertas ?? 0}
          icone={<Target size={17} />}
          cor="primaria"
        />
        <Stat
          rotulo="Visitas na semana"
          valor={r?.visitas_semana ?? 0}
          icone={<CalendarClock size={17} />}
          cor="alerta"
        />
      </div>
    </div>
  )
}

/* ------------------------------------------------------------- helpers -- */

function mesesAtras(n: number): string {
  const d = new Date()
  d.setMonth(d.getMonth() - n)
  d.setDate(1)
  return d.toISOString().slice(0, 10)
}

function emDias(n: number): string {
  const d = new Date()
  d.setDate(d.getDate() + n)
  return d.toISOString().slice(0, 10)
}

interface LinhaFluxo {
  tipo: string
  valor: number
  valor_pago: number | null
  vencimento: string
  status: string
}

function montarFluxo(linhas: LinhaFluxo[]): PontoMes[] {
  const nomes = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
  const mapa = new Map<string, PontoMes>()

  // Garante os 6 meses no eixo, mesmo sem movimento
  for (let i = 5; i >= 0; i--) {
    const d = new Date()
    d.setDate(1)
    d.setMonth(d.getMonth() - i)
    const chave = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    mapa.set(chave, { mes: nomes[d.getMonth()], receitas: 0, despesas: 0 })
  }

  for (const l of linhas) {
    const chave = l.vencimento.slice(0, 7)
    const ponto = mapa.get(chave)
    if (!ponto) continue
    const v = Number(l.status === 'pago' ? (l.valor_pago ?? l.valor) : l.valor)
    if (l.tipo === 'receita') ponto.receitas += v
    else ponto.despesas += v
  }

  return [...mapa.values()]
}

function montarStatus(linhas: { status: string }[]): FatiaStatus[] {
  const cores: Record<string, string> = {
    disponivel: '#059669',
    alugado: '#0891b2',
    vendido: '#2563eb',
    reservado: '#d97706',
    manutencao: '#7c3aed',
    inativo: '#94a3b8',
  }
  const rotulos: Record<string, string> = {
    disponivel: 'Disponivel',
    alugado: 'Alugado',
    vendido: 'Vendido',
    reservado: 'Reservado',
    manutencao: 'Manutencao',
    inativo: 'Inativo',
  }

  const contagem = new Map<string, number>()
  for (const l of linhas) contagem.set(l.status, (contagem.get(l.status) ?? 0) + 1)

  return [...contagem.entries()]
    .filter(([, qtd]) => qtd > 0)
    .map(([status, qtd]) => ({
      nome: rotulos[status] ?? status,
      valor: qtd,
      cor: cores[status] ?? '#94a3b8',
    }))
}
