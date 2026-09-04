import { supabase } from '@/lib/supabase'

/**
 * Cliente da Edge Function `gestao-contas`.
 *
 * Criar usuario com senha exige a service_role key, que nunca pode ir para o
 * navegador - por isso essas operacoes passam por uma funcao no servidor, e nao
 * por `supabase.from(...)`.
 */

type Resposta<T> = { dados?: T; erro?: string }

/**
 * O supabase-js nao levanta os 4xx: ele devolve um FunctionsHttpError com a
 * resposta crua em `context`. Sem ler esse corpo, o usuario veria apenas
 * "Edge Function returned a non-2xx status code" no lugar da mensagem em PT-BR.
 */
export async function chamarGestaoContas<T = Record<string, unknown>>(
  corpo: Record<string, unknown>,
): Promise<Resposta<T>> {
  const { data, error } = await supabase.functions.invoke('gestao-contas', { body: corpo })

  if (error) {
    const resposta = (error as { context?: Response }).context
    if (resposta && typeof resposta.json === 'function') {
      try {
        const json = await resposta.json()
        if (json?.erro) return { erro: String(json.erro) }
      } catch {
        /* resposta sem corpo JSON: cai na mensagem generica abaixo */
      }
    }
    return { erro: error.message || 'Falha ao falar com o servidor.' }
  }

  const payload = data as { ok?: boolean; erro?: string; dados?: T } | null
  if (payload?.ok === false) return { erro: payload.erro ?? 'Operacao recusada.' }
  return { dados: payload?.dados }
}

/**
 * Senha inicial sugerida. Sem caracteres ambiguos (O/0, l/1, I) porque ela e
 * lida em voz alta ou copiada a mao ao ser entregue.
 */
export function gerarSenha(tamanho = 12): string {
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789@#$%'
  const bytes = new Uint32Array(tamanho)
  crypto.getRandomValues(bytes)
  return Array.from(bytes, (b) => alfabeto[b % alfabeto.length]).join('')
}

/** Copia sem quebrar em navegador que bloqueia a area de transferencia. */
export async function copiar(texto: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(texto)
    return true
  } catch {
    return false
  }
}
