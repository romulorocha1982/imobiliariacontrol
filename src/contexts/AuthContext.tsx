import {
  createContext, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '@/lib/supabase'
import type { Imobiliaria, PerfilCompleto, UserRole } from '@/lib/types'

/** Onde guardamos o codigo da imobiliaria para pre-preencher o proximo login. */
const CHAVE_CODIGO = 'codigo_imobiliaria'

interface AuthCtx {
  session: Session | null
  perfil: PerfilCompleto | null
  /** A imobiliaria do usuario logado. null para o super admin. */
  imobiliaria: Imobiliaria | null
  ehSuperAdmin: boolean
  carregando: boolean
  entrar: (
    email: string,
    senha: string,
    codigo: string,
  ) => Promise<{ erro: string | null }>
  recuperarSenha: (email: string) => Promise<{ erro: string | null }>
  sair: () => Promise<void>
  recarregarPerfil: () => Promise<void>
  /** O usuario tem algum dos cargos informados? */
  pode: (...cargos: UserRole[]) => boolean
  /** Carimba o payload com a imobiliaria do usuario. Use em TODO insert. */
  comTenant: <T extends object>(dados: T) => T & { imobiliaria_id: string }
}

const Ctx = createContext<AuthCtx | null>(null)

/** Codigo da imobiliaria lembrado do ultimo login bem-sucedido. */
export function codigoLembrado(): string {
  try {
    return localStorage.getItem(CHAVE_CODIGO) ?? ''
  } catch {
    return ''
  }
}

/** Traduz as mensagens de erro do Supabase Auth */
function traduzirErro(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials')) return 'E-mail, senha ou codigo da imobiliaria incorretos.'
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
  const [perfil, setPerfil] = useState<PerfilCompleto | null>(null)
  const [carregando, setCarregando] = useState(true)

  // Traz a imobiliaria junto, numa unica requisicao. O embed depende da
  // Relationship profiles -> imobiliarias declarada em lib/types.ts.
  async function buscarPerfil(userId: string): Promise<PerfilCompleto | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*, imobiliaria:imobiliarias(*)')
      .eq('id', userId)
      .maybeSingle()

    if (error) {
      console.error('Erro ao carregar perfil:', error.message)
      return null
    }
    return data as PerfilCompleto | null
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
      imobiliaria: perfil?.imobiliaria ?? null,
      ehSuperAdmin: perfil?.cargo === 'super_admin',
      carregando,

      /**
       * Login com e-mail, senha e o codigo de 6 digitos da imobiliaria.
       *
       * O codigo e conferido DEPOIS do signInWithPassword, porque o Supabase
       * Auth nao tem como valida-lo antes de emitir a sessao. Isso significa que
       * ele e uma barreira de interface, nao de servidor: quem chamar a API
       * direto pula esta tela. Assumido de proposito -
       *   - o que isola os dados de verdade e a RLS, no banco;
       *   - a barreira REAL do codigo esta no cadastro, validada em
       *     handle_new_user() (004_multitenancy.sql).
       * Aqui ele serve de UX e de tranca contra credencial vazada nas maos de
       * quem nao sabe o codigo.
       *
       * Nao existe RPC anonima de validacao de codigo de proposito: sao 900 mil
       * combinacoes e o PostgREST anonimo nao tem rate limit por RPC - um script
       * varreria o espaco inteiro e sairia com a credencial de cadastro de todas
       * as imobiliarias.
       */
      async entrar(email, senha, codigo) {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password: senha,
        })
        if (error) return { erro: traduzirErro(error.message) }
        if (!data.user) return { erro: 'Nao foi possivel entrar. Tente novamente.' }

        const { data: p } = await supabase
          .from('profiles')
          .select('cargo, imobiliaria:imobiliarias(codigo, ativa)')
          .eq('id', data.user.id)
          .maybeSingle()

        // O super admin nao pertence a nenhuma imobiliaria: entra sem codigo.
        if (p?.cargo === 'super_admin') return { erro: null }

        const imob = p?.imobiliaria as { codigo: string; ativa: boolean } | null

        if (!imob || imob.codigo !== codigo.replace(/\D/g, '')) {
          await supabase.auth.signOut()
          // Mensagem unica de proposito: nao revela qual dos tres errou.
          return { erro: 'E-mail, senha ou codigo da imobiliaria incorretos.' }
        }

        if (!imob.ativa) {
          await supabase.auth.signOut()
          return { erro: 'O acesso desta imobiliaria esta suspenso. Fale com o suporte.' }
        }

        try {
          localStorage.setItem(CHAVE_CODIGO, imob.codigo)
        } catch {
          // navegador sem storage: so perde o pre-preenchimento
        }
        return { erro: null }
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

      comTenant(dados) {
        if (!perfil?.imobiliaria_id) {
          throw new Error('Sessao sem imobiliaria definida')
        }
        return { ...dados, imobiliaria_id: perfil.imobiliaria_id }
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
