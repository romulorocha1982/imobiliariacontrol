import { useEffect, type ReactNode } from 'react'
import { X, Inbox, AlertTriangle } from 'lucide-react'
import type {
  ImovelStatus, ContratoStatus, LancamentoStatus, NegociacaoEtapa, ClienteTipo,
} from '@/lib/types'
import {
  LABEL_STATUS_IMOVEL, LABEL_STATUS_CONTRATO,
  LABEL_STATUS_LANCAMENTO, LABEL_ETAPA, LABEL_TIPO_CLIENTE,
} from '@/lib/types'

/* ------------------------------------------------------------------ MODAL */

interface ModalProps {
  aberto: boolean
  aoFechar: () => void
  titulo: string
  subtitulo?: string
  tamanho?: 'sm' | 'md' | 'lg' | 'xl'
  children: ReactNode
  rodape?: ReactNode
}

export function Modal({
  aberto, aoFechar, titulo, subtitulo, tamanho = 'md', children, rodape,
}: ModalProps) {
  useEffect(() => {
    if (!aberto) return
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar() }
    document.addEventListener('keydown', esc)
    const overflowAnterior = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', esc)
      document.body.style.overflow = overflowAnterior
    }
  }, [aberto, aoFechar])

  if (!aberto) return null

  return (
    <div className="modal-fundo" onMouseDown={(e) => { if (e.target === e.currentTarget) aoFechar() }}>
      <div className={`modal modal--${tamanho}`} role="dialog" aria-modal="true" aria-label={titulo}>
        <div className="modal__topo">
          <div>
            <div className="modal__titulo">{titulo}</div>
            {subtitulo && <div className="modal__sub">{subtitulo}</div>}
          </div>
          <button className="modal__fechar" onClick={aoFechar} aria-label="Fechar">
            <X size={17} />
          </button>
        </div>
        <div className="modal__corpo">{children}</div>
        {rodape && <div className="modal__rodape">{rodape}</div>}
      </div>
    </div>
  )
}

/* -------------------------------------------------------------- CONFIRMAR */

interface ConfirmarProps {
  aberto: boolean
  titulo: string
  mensagem: string
  textoConfirmar?: string
  perigo?: boolean
  processando?: boolean
  aoConfirmar: () => void
  aoCancelar: () => void
}

export function Confirmar({
  aberto, titulo, mensagem, textoConfirmar = 'Confirmar',
  perigo, processando, aoConfirmar, aoCancelar,
}: ConfirmarProps) {
  return (
    <Modal
      aberto={aberto}
      aoFechar={aoCancelar}
      titulo={titulo}
      tamanho="sm"
      rodape={
        <>
          <button className="btn btn--secundario" onClick={aoCancelar} disabled={processando}>
            Cancelar
          </button>
          <button
            className={`btn ${perigo ? 'btn--perigo' : 'btn--primario'}`}
            onClick={aoConfirmar}
            disabled={processando}
          >
            {processando && <span className="spin spin--sm spin--claro" />}
            {textoConfirmar}
          </button>
        </>
      }
    >
      <div className="linha" style={{ alignItems: 'flex-start', gap: 12 }}>
        {perigo && (
          <div
            style={{
              width: 36, height: 36, borderRadius: 10, flexShrink: 0,
              background: 'var(--erro-suave)', color: 'var(--erro)',
              display: 'grid', placeItems: 'center',
            }}
          >
            <AlertTriangle size={18} />
          </div>
        )}
        <p style={{ lineHeight: 1.55 }}>{mensagem}</p>
      </div>
    </Modal>
  )
}

/* ------------------------------------------------------------------ CAMPO */

interface CampoProps {
  rotulo: string
  obrigatorio?: boolean
  erro?: string
  dica?: string
  className?: string
  children: ReactNode
}

export function Campo({ rotulo, obrigatorio, erro, dica, className, children }: CampoProps) {
  return (
    <div className={`campo ${className ?? ''}`}>
      <label className="campo__rotulo">
        {rotulo}
        {obrigatorio && <span>*</span>}
      </label>
      {children}
      {erro && <span className="campo__erro">{erro}</span>}
      {!erro && dica && <span className="campo__dica">{dica}</span>}
    </div>
  )
}

/* ----------------------------------------------------------------- BADGES */

const COR_IMOVEL: Record<ImovelStatus, string> = {
  disponivel: 'ok',
  alugado: 'info',
  vendido: 'primaria',
  reservado: 'alerta',
  manutencao: 'acento',
  inativo: 'neutro',
}

export function BadgeImovel({ status }: { status: ImovelStatus }) {
  return (
    <span className={`badge badge--${COR_IMOVEL[status]}`}>
      <i className="ponto" />
      {LABEL_STATUS_IMOVEL[status]}
    </span>
  )
}

const COR_CONTRATO: Record<ContratoStatus, string> = {
  ativo: 'ok',
  pendente: 'alerta',
  encerrado: 'neutro',
  rescindido: 'erro',
}

export function BadgeContrato({ status }: { status: ContratoStatus }) {
  return (
    <span className={`badge badge--${COR_CONTRATO[status]}`}>
      <i className="ponto" />
      {LABEL_STATUS_CONTRATO[status]}
    </span>
  )
}

const COR_LANCAMENTO: Record<LancamentoStatus, string> = {
  pago: 'ok',
  pendente: 'alerta',
  atrasado: 'erro',
  cancelado: 'neutro',
}

export function BadgeLancamento({ status }: { status: LancamentoStatus }) {
  return (
    <span className={`badge badge--${COR_LANCAMENTO[status]}`}>
      <i className="ponto" />
      {LABEL_STATUS_LANCAMENTO[status]}
    </span>
  )
}

const COR_ETAPA: Record<NegociacaoEtapa, string> = {
  lead: 'neutro',
  contato: 'info',
  visita: 'primaria',
  proposta: 'acento',
  negociacao: 'alerta',
  fechado: 'ok',
  perdido: 'erro',
}

export function BadgeEtapa({ etapa }: { etapa: NegociacaoEtapa }) {
  return <span className={`badge badge--${COR_ETAPA[etapa]}`}>{LABEL_ETAPA[etapa]}</span>
}

const COR_CLIENTE: Record<ClienteTipo, string> = {
  inquilino: 'info',
  comprador: 'primaria',
  interessado: 'neutro',
  fiador: 'acento',
}

export function BadgeCliente({ tipo }: { tipo: ClienteTipo }) {
  return <span className={`badge badge--${COR_CLIENTE[tipo]}`}>{LABEL_TIPO_CLIENTE[tipo]}</span>
}

/* ----------------------------------------------------------------- ESTADOS */

export function Carregando({ texto }: { texto?: string }) {
  return (
    <div className="carregando">
      <div className="coluna" style={{ alignItems: 'center', gap: 12 }}>
        <span className="spin" />
        {texto && <span className="t-3 t-sm">{texto}</span>}
      </div>
    </div>
  )
}

interface VazioProps {
  icone?: ReactNode
  titulo: string
  texto?: string
  acao?: ReactNode
}

export function Vazio({ icone, titulo, texto, acao }: VazioProps) {
  return (
    <div className="vazio">
      <div className="vazio__icone">{icone ?? <Inbox size={24} />}</div>
      <div className="vazio__titulo">{titulo}</div>
      {texto && <div className="vazio__texto">{texto}</div>}
      {acao}
    </div>
  )
}

/* -------------------------------------------------------------- STAT CARD */

interface StatProps {
  rotulo: string
  valor: string | number
  nota?: string
  icone: ReactNode
  cor?: 'primaria' | 'ok' | 'alerta' | 'erro' | 'info' | 'acento'
}

export function Stat({ rotulo, valor, nota, icone, cor = 'primaria' }: StatProps) {
  const fundo = {
    primaria: 'var(--primaria-suave)',
    ok: 'var(--ok-suave)',
    alerta: 'var(--alerta-suave)',
    erro: 'var(--erro-suave)',
    info: 'var(--info-suave)',
    acento: 'var(--acento-suave)',
  }[cor]

  const frente = {
    primaria: 'var(--primaria)',
    ok: 'var(--ok)',
    alerta: 'var(--alerta)',
    erro: 'var(--erro)',
    info: 'var(--info)',
    acento: 'var(--acento)',
  }[cor]

  return (
    <div className="stat">
      <div className="stat__topo">
        <span className="stat__rotulo">{rotulo}</span>
        <span className="stat__icone" style={{ background: fundo, color: frente }}>
          {icone}
        </span>
      </div>
      <div className="stat__valor">{valor}</div>
      {nota && <div className="stat__nota">{nota}</div>}
    </div>
  )
}

/* --------------------------------------------------------------- SKELETON */

export function SkeletonTabela({ linhas = 5, colunas = 5 }: { linhas?: number; colunas?: number }) {
  return (
    <div className="tabela-wrap">
      <table className="tabela">
        <tbody>
          {Array.from({ length: linhas }).map((_, i) => (
            <tr key={i}>
              {Array.from({ length: colunas }).map((__, j) => (
                <td key={j}>
                  <div className="skel" style={{ height: 15, width: j === 0 ? '65%' : '45%' }} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
