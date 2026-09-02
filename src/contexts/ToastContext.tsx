import {
  createContext, useCallback, useContext, useState,
  type ReactNode,
} from 'react'
import { CheckCircle2, AlertTriangle, XCircle, Info } from 'lucide-react'

type ToastTipo = 'ok' | 'erro' | 'alerta' | 'info'

interface Toast {
  id: number
  tipo: ToastTipo
  titulo: string
  texto?: string
}

interface ToastCtx {
  toast: (tipo: ToastTipo, titulo: string, texto?: string) => void
  ok: (titulo: string, texto?: string) => void
  erro: (titulo: string, texto?: string) => void
}

const Ctx = createContext<ToastCtx | null>(null)

const ICONES = {
  ok: CheckCircle2,
  erro: XCircle,
  alerta: AlertTriangle,
  info: Info,
} as const

const CORES = {
  ok: 'var(--ok)',
  erro: 'var(--erro)',
  alerta: 'var(--alerta)',
  info: 'var(--info)',
} as const

let proximoId = 1

export function ToastProvider({ children }: { children: ReactNode }) {
  const [lista, setLista] = useState<Toast[]>([])

  const remover = useCallback((id: number) => {
    setLista((atual) => atual.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (tipo: ToastTipo, titulo: string, texto?: string) => {
      const id = proximoId++
      setLista((atual) => [...atual, { id, tipo, titulo, texto }])
      window.setTimeout(() => remover(id), tipo === 'erro' ? 6500 : 3800)
    },
    [remover],
  )

  const ok = useCallback((t: string, x?: string) => toast('ok', t, x), [toast])
  const erro = useCallback((t: string, x?: string) => toast('erro', t, x), [toast])

  return (
    <Ctx.Provider value={{ toast, ok, erro }}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {lista.map((t) => {
          const Icone = ICONES[t.tipo]
          return (
            <div key={t.id} className={`toast toast--${t.tipo}`} onClick={() => remover(t.id)}>
              <Icone size={17} color={CORES[t.tipo]} />
              <div className="toast__texto">
                <div className="toast__titulo">{t.titulo}</div>
                {t.texto && <div className="t-3 t-sm mt-0">{t.texto}</div>}
              </div>
            </div>
          )
        })}
      </div>
    </Ctx.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useToast(): ToastCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useToast precisa estar dentro de <ToastProvider>')
  return ctx
}
