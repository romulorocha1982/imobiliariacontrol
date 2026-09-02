import { useCallback, useEffect, useMemo, useState } from 'react'
import { Search, ScrollText, Plus, Pencil, Trash2, Eye } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { Modal, Vazio, SkeletonTabela } from '@/components/ui'
import { dataHora } from '@/lib/format'
import type { Auditoria as Registro } from '@/lib/types'

const LABEL_TABELA: Record<string, string> = {
  imoveis: 'Imoveis',
  proprietarios: 'Proprietarios',
  clientes: 'Clientes',
  contratos: 'Contratos',
  lancamentos: 'Financeiro',
  negociacoes: 'Negociacoes',
}

const ACAO_INFO = {
  INSERT: { rotulo: 'Criou', cor: 'ok', icone: Plus },
  UPDATE: { rotulo: 'Alterou', cor: 'info', icone: Pencil },
  DELETE: { rotulo: 'Excluiu', cor: 'erro', icone: Trash2 },
} as const

/** Campos tecnicos que nao interessam na comparacao */
const IGNORAR = new Set(['updated_at', 'created_at', 'created_by', 'id'])

export default function Auditoria() {
  const { erro: toastErro } = useToast()

  const [lista, setLista] = useState<Registro[]>([])
  const [carregando, setCarregando] = useState(true)
  const [busca, setBusca] = useState('')
  const [fTabela, setFTabela] = useState('')
  const [fAcao, setFAcao] = useState('')
  const [detalhe, setDetalhe] = useState<Registro | null>(null)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data: linhas, error } = await supabase
      .from('auditoria')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(400)
    if (error) toastErro('Erro ao carregar auditoria', error.message)
    else setLista((linhas ?? []) as Registro[])
    setCarregando(false)
  }, [toastErro])

  useEffect(() => { void carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return lista.filter((r) => {
      if (fTabela && r.tabela !== fTabela) return false
      if (fAcao && r.acao !== fAcao) return false
      if (!q) return true
      return [r.usuario_nome, r.tabela, r.registro_id]
        .filter(Boolean)
        .some((x) => String(x).toLowerCase().includes(q))
    })
  }, [lista, busca, fTabela, fAcao])

  /** Campos que mudaram entre antes e depois */
  const mudancas = useMemo(() => {
    if (!detalhe || detalhe.acao !== 'UPDATE') return []
    const antes = detalhe.dados_antes ?? {}
    const depois = detalhe.dados_depois ?? {}
    const chaves = new Set([...Object.keys(antes), ...Object.keys(depois)])

    return [...chaves]
      .filter((k) => !IGNORAR.has(k))
      .map((k) => ({ campo: k, de: antes[k], para: depois[k] }))
      .filter((m) => JSON.stringify(m.de) !== JSON.stringify(m.para))
  }, [detalhe])

  const mostrar = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '(vazio)'
    if (typeof v === 'boolean') return v ? 'sim' : 'nao'
    return String(v)
  }

  /** Resumo do registro afetado, para a coluna "Registro" */
  const resumoRegistro = (r: Registro): string => {
    const d = (r.dados_depois ?? r.dados_antes) as Record<string, unknown> | null
    if (!d) return r.registro_id?.slice(0, 8) ?? '-'
    const nome = d.titulo ?? d.nome ?? d.numero ?? d.descricao ?? d.codigo
    return nome ? String(nome) : (r.registro_id?.slice(0, 8) ?? '-')
  }

  return (
    <div>
      <div className="barra">
        <div className="busca">
          <Search size={15} />
          <input
            className="input"
            placeholder="Buscar por usuario ou registro..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        <select className="select" value={fTabela} onChange={(e) => setFTabela(e.target.value)}>
          <option value="">Todos os modulos</option>
          {Object.entries(LABEL_TABELA).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>

        <select className="select" value={fAcao} onChange={(e) => setFAcao(e.target.value)}>
          <option value="">Todas as acoes</option>
          <option value="INSERT">Criacao</option>
          <option value="UPDATE">Alteracao</option>
          <option value="DELETE">Exclusao</option>
        </select>

        <div className="barra__dir">
          <span className="contador">{filtrados.length} registro(s) - ultimos 400</span>
        </div>
      </div>

      {carregando ? (
        <SkeletonTabela linhas={8} colunas={5} />
      ) : filtrados.length === 0 ? (
        <div className="card">
          <Vazio
            icone={<ScrollText size={24} />}
            titulo="Nenhuma alteracao registrada"
            texto="Toda criacao, edicao e exclusao feita no sistema aparece aqui automaticamente."
          />
        </div>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Quando</th>
                <th>Quem</th>
                <th>Acao</th>
                <th>Modulo</th>
                <th>Registro</th>
                <th className="acoes">Detalhes</th>
              </tr>
            </thead>
            <tbody>
              {filtrados.map((r) => {
                const info = ACAO_INFO[r.acao as keyof typeof ACAO_INFO]
                const Icone = info?.icone ?? Pencil
                return (
                  <tr key={r.id}>
                    <td className="t-sm nowrap">{dataHora(r.created_at)}</td>
                    <td className="celula-forte">{r.usuario_nome ?? <span className="t-3">Sistema</span>}</td>
                    <td>
                      <span className={`badge badge--${info?.cor ?? 'neutro'}`}>
                        <Icone size={10} />
                        {info?.rotulo ?? r.acao}
                      </span>
                    </td>
                    <td className="t-sm">{LABEL_TABELA[r.tabela] ?? r.tabela}</td>
                    <td className="t-sm">{resumoRegistro(r)}</td>
                    <td className="acoes">
                      <button className="btn btn--fantasma btn--sm" onClick={() => setDetalhe(r)}>
                        <Eye size={13} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        aberto={Boolean(detalhe)}
        aoFechar={() => setDetalhe(null)}
        titulo="Detalhe da alteracao"
        subtitulo={detalhe ? `${dataHora(detalhe.created_at)} por ${detalhe.usuario_nome ?? 'Sistema'}` : undefined}
        tamanho="lg"
        rodape={
          <button className="btn btn--secundario" onClick={() => setDetalhe(null)}>
            Fechar
          </button>
        }
      >
        {detalhe?.acao === 'UPDATE' ? (
          mudancas.length === 0 ? (
            <Vazio titulo="Nenhum campo relevante mudou" />
          ) : (
            <div className="tabela-wrap">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Campo</th>
                    <th>Antes</th>
                    <th>Depois</th>
                  </tr>
                </thead>
                <tbody>
                  {mudancas.map((m) => (
                    <tr key={m.campo}>
                      <td className="celula-forte">{m.campo}</td>
                      <td className="t-sm" style={{ color: 'var(--erro)' }}>{mostrar(m.de)}</td>
                      <td className="t-sm" style={{ color: 'var(--ok)' }}>{mostrar(m.para)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        ) : (
          <pre
            style={{
              background: 'var(--surface-2)',
              padding: 14,
              borderRadius: 10,
              fontSize: 12,
              overflow: 'auto',
              maxHeight: 420,
              lineHeight: 1.6,
              border: '1px solid var(--border)',
            }}
          >
            {JSON.stringify(detalhe?.dados_depois ?? detalhe?.dados_antes ?? {}, null, 2)}
          </pre>
        )}
      </Modal>
    </div>
  )
}
