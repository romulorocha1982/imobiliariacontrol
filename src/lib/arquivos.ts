/**
 * Envio e leitura de arquivos no Storage.
 *
 * Dois destinos, com regras opostas de proposito:
 *
 *   `imoveis`     publico   fotos de anuncio, servidas direto por URL
 *   `documentos`  privado   vistoria, contrato assinado, RG, renda, matricula
 *
 * O bucket privado so entrega arquivo por link assinado que expira. Documento
 * de locacao carrega CPF, RG, renda e assinatura; nao pode ficar num endereco
 * publico e permanente, mesmo que dificil de adivinhar.
 *
 * CONVENCAO DE CAMINHO -- `{imobiliaria_id}/{escopo}/{registro_id}/{arquivo}`
 *
 * O primeiro segmento nao e organizacao, e seguranca: as policies dos dois
 * buckets comparam `(storage.foldername(name))[1]` com a imobiliaria de quem
 * esta enviando. Fora desse formato, o Storage recusa o upload.
 */
import { supabase } from '@/lib/supabase'
import type { TipoDocumento } from '@/lib/types'

export const BUCKET_FOTOS = 'imoveis'
export const BUCKET_DOCUMENTOS = 'documentos'

/** Onde o arquivo se pendura. Vira o segundo segmento do caminho. */
export type Escopo = 'imoveis' | 'contratos' | 'clientes'

/** Teto por arquivo. Depois da compressao, uma foto de celular fica bem abaixo. */
export const TAMANHO_MAXIMO = 15 * 1024 * 1024

export const MIME_IMAGEM = ['image/jpeg', 'image/png', 'image/webp', 'image/heic']
export const MIME_DOCUMENTO = [...MIME_IMAGEM, 'application/pdf']

export const ROTULO_TIPO: Record<TipoDocumento, string> = {
  minuta: 'Minuta de contrato',
  vistoria: 'Vistoria',
  contrato_assinado: 'Contrato assinado',
  aditivo: 'Aditivo',
  identidade: 'Documento de identidade',
  comprovante_renda: 'Comprovante de renda',
  matricula: 'Matricula do imovel',
  outro: 'Outro',
}

/** Ordem em que os tipos aparecem nos seletores. */
export const TIPOS_DOCUMENTO = Object.keys(ROTULO_TIPO) as TipoDocumento[]

function extensao(nome: string): string {
  const ponto = nome.lastIndexOf('.')
  if (ponto < 0 || ponto === nome.length - 1) return 'bin'
  return nome.slice(ponto + 1).toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin'
}

/**
 * Monta o caminho no bucket. O nome final e um uuid, nao o nome original:
 *
 * - nome de arquivo de celular repete ("IMG_0001.jpg") e colidiria;
 * - nome original costuma carregar dado pessoal ("RG Joao Silva.pdf"), e no
 *   bucket publico o caminho aparece na URL.
 *
 * O nome original fica na coluna `nome_arquivo`, para exibir e para baixar.
 */
export function caminhoArquivo(
  imobiliariaId: string,
  escopo: Escopo,
  registroId: string,
  nomeOriginal: string,
): string {
  return `${imobiliariaId}/${escopo}/${registroId}/${crypto.randomUUID()}.${extensao(nomeOriginal)}`
}

/**
 * Reduz a imagem antes de subir. Foto de celular chega com 12 MP e 5 MB; para
 * anuncio e para vistoria, 1600px de lado maior em JPEG resolve, e uma vistoria
 * com trinta fotos passa de 150 MB para uns 10 MB.
 *
 * Qualquer falha devolve o arquivo original -- comprimir e otimizacao, nunca
 * motivo para o envio falhar. PDF e formato nao suportado passam direto.
 */
export async function comprimirImagem(
  arquivo: File,
  ladoMaximo = 1600,
  qualidade = 0.82,
): Promise<Blob> {
  if (!arquivo.type.startsWith('image/') || arquivo.type === 'image/heic') return arquivo

  try {
    const bitmap = await createImageBitmap(arquivo)
    const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height))

    // Ja e pequena: recomprimir so degradaria a imagem sem ganho de tamanho.
    if (escala === 1 && arquivo.size < 600 * 1024) {
      bitmap.close()
      return arquivo
    }

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * escala)
    canvas.height = Math.round(bitmap.height * escala)

    const ctx = canvas.getContext('2d')
    if (!ctx) {
      bitmap.close()
      return arquivo
    }
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    bitmap.close()

    const blob = await new Promise<Blob | null>((ok) =>
      canvas.toBlob(ok, 'image/jpeg', qualidade),
    )
    // So troca se realmente ficou menor.
    return blob && blob.size < arquivo.size ? blob : arquivo
  } catch {
    return arquivo
  }
}

/** Mensagem de recusa, ou null se o arquivo serve. */
export function validarArquivo(arquivo: File, mimesAceitos: string[]): string | null {
  if (arquivo.size > TAMANHO_MAXIMO) {
    return `"${arquivo.name}" tem ${formatarTamanho(arquivo.size)}. O limite e ${formatarTamanho(TAMANHO_MAXIMO)}.`
  }
  // Alguns navegadores mandam type vazio; nesse caso confiamos na extensao, que
  // o input ja filtrou pelo accept.
  if (arquivo.type && !mimesAceitos.includes(arquivo.type)) {
    return `"${arquivo.name}" nao e um formato aceito.`
  }
  return null
}

export function formatarTamanho(bytes: number | null): string {
  if (!bytes) return '-'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Sobe o binario. Devolve o caminho gravado ou a mensagem de erro. */
export async function enviarObjeto(
  bucket: string,
  caminho: string,
  conteudo: Blob,
  contentType: string,
): Promise<{ erro: string | null }> {
  const { error } = await supabase.storage.from(bucket).upload(caminho, conteudo, {
    contentType,
    upsert: false,
  })
  if (!error) return { erro: null }

  // A policy do Storage recusa com "new row violates row-level security"; a
  // mensagem crua nao ajuda ninguem.
  const m = error.message.toLowerCase()
  if (m.includes('row-level security') || m.includes('unauthorized')) {
    return { erro: 'Voce nao tem permissao para enviar arquivos aqui.' }
  }
  if (m.includes('exceeded') || m.includes('too large')) {
    return { erro: 'Arquivo maior que o limite aceito pelo servidor.' }
  }
  return { erro: error.message }
}

/** URL permanente do bucket publico. So vale para fotos de anuncio. */
export function urlPublica(caminho: string): string {
  return supabase.storage.from(BUCKET_FOTOS).getPublicUrl(caminho).data.publicUrl
}

/**
 * Link temporario para um arquivo do bucket privado. Uma hora e suficiente para
 * abrir ou baixar, e curto o bastante para o link nao virar um endereco publico
 * se alguem colar num e-mail.
 */
export async function urlAssinada(
  caminho: string,
  segundos = 3600,
): Promise<{ url: string | null; erro: string | null }> {
  const { data, error } = await supabase.storage
    .from(BUCKET_DOCUMENTOS)
    .createSignedUrl(caminho, segundos)
  if (error) return { url: null, erro: error.message }
  return { url: data.signedUrl, erro: null }
}

/**
 * Apaga o binario. Falha aqui nao e fatal: a linha do banco ja foi removida e o
 * arquivo vira lixo no bucket, mas nao aparece em tela nem quebra nada.
 */
export async function removerObjeto(bucket: string, caminhos: string[]): Promise<void> {
  if (caminhos.length === 0) return
  await supabase.storage.from(bucket).remove(caminhos)
}
