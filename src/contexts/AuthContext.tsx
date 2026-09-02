import {
  createContext, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Profile, UserRole } from '@/lib/types'

interface DadosCadastro {
  nome: string
  telefone?: string
}

interface AuthCtx {
  session: Session | null
  perfil: Profile | null
  carregando: boolean
  entrar: (email: string, senha: string) => Promise<{ erro: string | null }>
  cadastrar: (
    email: string,
    senha: string,
    dados: DadosCadastro,
  ) => Promise<{ erro: string | null; confirmar: boolean }>
  recuperarSenha: (email: string) => Promise<{ erro: string | null }>
  sair: () => Promise<void>
  recarregarPerfil: () => Promise<void>
  /** O usuario tem algum dos cargos informados? */
  pode: (...cargos: UserRole[]) => boolean
}

const Ctx = createContext<AuthCtx | null>(null)

/** Traduz as mensagens de erro do Supabase Auth */
function traduzirErro(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials')) return 'E-mail ou senha incorretos.'
  if (m.includes('email not confirmed')) return 'Confirme seu e-mail antes de entrar. Verifique a caixa de entrada.'
  if (m.includes('user already registered')) return 'Este e-mail ja possui cadastro.'
  if (m.includes('password should be at least')) return 'A senha precisa ter no minimo 6 caracteres.'
  if (m.includes('unable to validate email')) return 'E-mail invalido.'
  if (m.includes('email rate limit') || m.includes('too many requests')) {
    return 'Muitas tentativas. Aguarde alguns minutos e tente novamente.'
  }
  if (m.includes('failed to fetch') || m.includes('networkerror')) {
    return 'Sem conexao com o servidor. Verifique a internet e as chaves do Supabase.'
  }
  return msg
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [perfil, setPerfil] = useState<Profile | null>(null)
  const [carregando, setCarregando] = useState(true)

  async function buscarPerfil(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.error('Erro ao carregar perfil:', error.message)
      return null
    }
    return data as Profile | null
  }

  useEffect(() => {
    let ativo = true

    supabase.auth.getSession().then(async ({ data }) => {
      if (!ativo) return
      setSession(data.session)
      if (data.session?.user) {
        setPerfil(await buscarPerfil(data.session.user.id))
      }
      if (ativo) setCarregando(false)
    })

    const { data: sub } = supabase.auth.onAuthStateChange((_evento, nova) => {
      setSession(nova)
      if (nova?.user) {
        // fora do callback: o cliente do Supabase nao permite await aqui dentro
        void buscarPerfil(nova.user.id).then((p) => {
          if (ativo) setPerfil(p)
        })
      } else {
        setPerfil(null)
      }
    })

    return () => {
      ativo = false
      sub.subscription.unsubscribe()
    }
  }, [])

  const valor = useMemo<AuthCtx>(
    () => ({
      session,
      perfil,
      carregando,

      async entrar(email, senha) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password: senha,
        })
        return { erro: error ? traduzirErro(error.message) : null }
      },

      async cadastrar(email, senha, dados) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim().toLowerCase(),
          password: senha,
          options: {
            data: { nome: dados.nome, telefone: dados.telefone ?? null },
            emailRedirectTo: window.location.origin,
          },
        })
        if (error) return { erro: traduzirErro(error.message), confirmar: false }
        // Sem sessao = o projeto exige confirmacao por e-mail
        return { erro: null, confirmar: !data.session }
      },

      async recuperarSenha(email) {
        const { error } = await supabase.auth.resetPasswordForEmail(
          email.trim().toLowerCase(),
          { redirectTo: `${window.location.origin}/redefinir-senha` },
        )
        return { erro: error ? traduzirErro(error.message) : null }
      },

      async sair() {
        await supabase.auth.signOut()
        setPerfil(null)
        setSession(null)
      },

      async recarregarPerfil() {
        if (session?.user) setPerfil(await buscarPerfil(session.user.id))
      },

      pode(...cargos) {
        if (!perfil?.ativo) return false
        return cargos.includes(perfil.cargo)
      },
    }),
    [session, perfil, carregando],
  )

  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>
}

// eslint-disable-next-line react-refresh/only-export-components
export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useAuth precisa estar dentro de <AuthProvider>')
  return ctx
}
