import { createClient } from '@supabase/supabase-js'
import type { Database } from './types'

const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY

export const supabaseConfigurado = Boolean(url && key)

if (!supabaseConfigurado) {
  console.warn(
    '[Imobiliaria Control] Variaveis VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY ' +
      'nao definidas. Crie o arquivo .env a partir de .env.example.',
  )
}

export const supabase = createClient<Database>(
  url ?? 'https://placeholder.supabase.co',
  key ?? 'placeholder-key',
  {
    /**
     * Projetos novos do Supabase expoem o schema `api` por padrao no Data API.
     * Nossas tabelas ficam em `public`, entao declaramos explicitamente -- sem
     * isso o PostgREST procura por `api.imoveis` e devolve PGRST205.
     */
    db: {
      schema: 'public',
    },
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
