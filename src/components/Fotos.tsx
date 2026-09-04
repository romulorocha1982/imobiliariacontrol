/**
 * Galeria de fotos do imovel -- as de anuncio, no bucket publico `imoveis`.
 *
 * Uma delas e a capa: e a que aparece no card da listagem, via `foto_capa` da
 * view `vw_imoveis_completo`, que ordena por `capa desc, ordem asc`. Se ninguem
 * marcar capa, a primeira da ordem assume.
 *
 * Documento sensivel NAO vem para ca -- este bucket e publico. Vistoria, RG e
 * contrato assinado vao no componente Anexos, que usa o bucket privado.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Star, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Vazio } from '@/components/ui'
import type { ImovelFoto } from '@/lib/types'
import {
  BUCKET_FOTOS,
  MIME_IMAGEM,
  caminhoArquivo,
  comprimirImagem,
  enviarObjeto,
  removerObjeto,
  urlPublica,
  validarArquivo,
} from '@/lib/arquivos'

export function Fotos({ imovelId }: { imovelId: string }) {
  const { comTenant, pode, perfil } = useAuth()
  const { ok, erro: toastErro } = useToast()

  const [fotos, setFotos] = useState<ImovelFoto[]>([])
  const [carregando, setCarregando] = useState(true)
  const [enviando, setEnviando] = useState(false)
  const entrada = useRef<HTMLInputElement>(null)

  const podeEditar = pode('admin', 'gerente', 'corretor')

  const carregar = useCallback(async () => {
    // Ordena so por `ordem`. A view `vw_imoveis_completo` e que privilegia a
    // capa ao escolher a miniatura do card; aqui, se a capa fosse forcada para
    // o inicio, reordenar ela nao mudaria nada na tela e pareceria travado.
    const { data, error } = await supabase
      .from('imovel_fotos')
      .select('*')
      .eq('imovel_id', imovelId)
      .order('ordem', { ascending: true })
      .order('created_at', { ascending: true })

    if (error) toastErro('Nao foi possivel carregar as fotos', error.message)
    setFotos(data ?? [])
    setCarregando(false)
  }, [imovelId, toastErro])

  useEffect(() => {
    void carregar()
  }, [carregar])

  async function enviar(lista: FileList | null) {
    if (!lista || lista.length === 0) return
    const tenant = perfil?.imobiliaria_id
    if (!tenant) return toastErro('Sessao sem imobiliaria definida')

    const arquivos = Array.from(lista)
    setEnviando(true)

    let proximaOrdem = fotos.length
    let enviadas = 0

    for (const arquivo of arquivos) {
      const recusa = validarArquivo(arquivo, MIME_IMAGEM)
      if (recusa) {
        toastErro('Arquivo recusado', recusa)
        continue
      }

      const conteudo = await comprimirImagem(arquivo)
      // A compressao devolve o proprio arquivo quando nao consegue converter
      // (HEIC, por exemplo). Rotular tudo como jpeg gravaria o content-type
      // errado e o navegador nao exibiria a imagem.
      const mime = conteudo === arquivo ? arquivo.type || 'image/jpeg' : 'image/jpeg'
      const caminho = caminhoArquivo(tenant, 'imoveis', imovelId, arquivo.name)

      const { erro } = await enviarObjeto(BUCKET_FOTOS, caminho, conteudo, mime)
      if (erro) {
        toastErro(`Falhou ao enviar "${arquivo.name}"`, erro)
        continue
      }

      const { error } = await supabase.from('imovel_fotos').insert(
        comTenant({
          imovel_id: imovelId,
          url: urlPublica(caminho),
          path: caminho,
          ordem: proximaOrdem,
          // Primeira foto do imovel ja nasce capa: sem isso o card ficaria sem
          // imagem ate alguem lembrar de marcar.
          capa: fotos.length === 0 && enviadas === 0,
        }),
      )

      if (error) {
        // A linha nao entrou; o binario ficaria orfao no bucket.
        await removerObjeto(BUCKET_FOTOS, [caminho])
        toastErro(`Falhou ao registrar "${arquivo.name}"`, error.message)
        continue
      }

      proximaOrdem += 1
      enviadas += 1
    }

    setEnviando(false)
    if (entrada.current) entrada.current.value = ''
    if (enviadas > 0) {
      ok(enviadas === 1 ? 'Foto enviada' : `${enviadas} fotos enviadas`)
      await carregar()
    }
  }

  async function definirCapa(foto: ImovelFoto) {
    // Duas chamadas em vez de uma transacao: a RLS ja restringe as duas ao
    // mesmo imovel, e o pior caso -- a segunda falhar -- deixa o imovel sem
    // capa nenhuma, que a view resolve caindo na primeira da ordem.
    await supabase.from('imovel_fotos').update({ capa: false }).eq('imovel_id', imovelId)
    const { error } = await supabase.from('imovel_fotos').update({ capa: true }).eq('id', foto.id)
    if (error) return toastErro('Nao foi possivel definir a capa', error.message)
    await carregar()
  }

  async function mover(indice: number, direcao: -1 | 1) {
    const destino = indice + direcao
    if (destino < 0 || destino >= fotos.length) return

    const a = fotos[indice]
    const b = fotos[destino]

    await supabase.from('imovel_fotos').update({ ordem: b.ordem }).eq('id', a.id)
    await supabase.from('imovel_fotos').update({ ordem: a.ordem }).eq('id', b.id)
    await carregar()
  }

  async function excluir(foto: ImovelFoto) {
    const { error } = await supabase.from('imovel_fotos').delete().eq('id', foto.id)
    if (error) return toastErro('Nao foi possivel excluir', error.message)
    if (foto.path) await removerObjeto(BUCKET_FOTOS, [foto.path])
    ok('Foto excluida')
    await carregar()
  }

  return (
    <div className="col-12">
      <div className="linha linha--entre mb-2">
        <span className="t-2 t-xs">
          {carregando ? 'Carregando...' : `${fotos.length} foto(s)`}
          {fotos.length > 0 && ' · a marcada com estrela e a capa do anuncio'}
        </span>

        {podeEditar && (
          <>
            <input
              ref={entrada}
              type="file"
              accept={MIME_IMAGEM.join(',')}
              multiple
              hidden
              onChange={(e) => void enviar(e.target.files)}
            />
            <button
              type="button"
              className="btn btn--secundario btn--sm"
              onClick={() => entrada.current?.click()}
              disabled={enviando}
            >
              {enviando ? <span className="spin spin--sm" /> : <ImagePlus size={14} />}
              {enviando ? 'Enviando...' : 'Adicionar fotos'}
            </button>
          </>
        )}
      </div>

      {!carregando && fotos.length === 0 ? (
        <Vazio
          icone={<ImagePlus size={22} />}
          titulo="Nenhuma foto"
          texto={
            podeEditar
              ? 'As fotos aparecem no card do imovel. A primeira vira a capa.'
              : 'Este imovel ainda nao tem fotos.'
          }
        />
      ) : (
        <div className="galeria">
          {fotos.map((f, i) => (
            <figure key={f.id} className={`galeria__item ${f.capa ? 'galeria__item--capa' : ''}`}>
              <img src={f.url} alt="" loading="lazy" />

              {f.capa && <span className="galeria__capa">Capa</span>}

              {podeEditar && (
                <div className="galeria__acoes">
                  <button
                    type="button"
                    className="btn btn--fantasma btn--sm"
                    title="Mover para tras"
                    onClick={() => void mover(i, -1)}
                    disabled={i === 0}
                  >
                    <ChevronLeft size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn btn--fantasma btn--sm"
                    title={f.capa ? 'Ja e a capa' : 'Definir como capa'}
                    onClick={() => void definirCapa(f)}
                    disabled={f.capa}
                  >
                    <Star size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn btn--fantasma btn--sm"
                    title="Mover para frente"
                    onClick={() => void mover(i, 1)}
                    disabled={i === fotos.length - 1}
                  >
                    <ChevronRight size={13} />
                  </button>
                  <button
                    type="button"
                    className="btn btn--fantasma btn--sm"
                    title="Excluir foto"
                    onClick={() => void excluir(f)}
                  >
                    <Trash2 size={13} color="var(--erro)" />
                  </button>
                </div>
              )}
            </figure>
          ))}
        </div>
      )}
    </div>
  )
}
