/**
 * Modelos de contrato: as clausulas que a imobiliaria usa, com marcadores que
 * puxam os dados na hora de gerar.
 *
 * Escrita restrita a admin e gerente (a rota tambem barra) porque mexer em
 * clausula e decisao juridica da casa, nao operacao de rotina.
 */
import { useCallback, useEffect, useState } from 'react'
import {
  Plus, FileSignature, Pencil, Trash2, Star, ChevronUp, ChevronDown, Sparkles,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Modal, Campo, Confirmar, Vazio, SkeletonTabela } from '@/components/ui'
import { data } from '@/lib/format'
import { MARCADORES, type Clausula } from '@/lib/contratoTexto'
import { CABECALHO_PADRAO, CLAUSULAS_PADRAO, RODAPE_PADRAO } from '@/lib/modeloPadrao'
import { LABEL_TIPO_MODELO, type ModeloContrato } from '@/lib/types'

type Form = Partial<ModeloContrato>

const FORM_VAZIO: Form = {
  nome: '',
  tipo: 'locacao_residencial',
  cabecalho: '',
  clausulas: [],
  rodape: '',
  padrao: false,
  ativo: true,
}

export default function Modelos() {
  const { comTenant } = useAuth()
  const { ok, erro: toastErro } = useToast()

  const [lista, setLista] = useState<ModeloContrato[]>([])
  const [carregando, setCarregando] = useState(true)

  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<ModeloContrato | null>(null)
  const [form, setForm] = useState<Form>(FORM_VAZIO)
  const [salvando, setSalvando] = useState(false)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [excluir, setExcluir] = useState<ModeloContrato | null>(null)
  const [excluindo, setExcluindo] = useState(false)
  const [verMarcadores, setVerMarcadores] = useState(false)

  const carregar = useCallback(async () => {
    const { data: linhas, error } = await supabase
      .from('modelos_contrato')
      .select('*')
      .order('padrao', { ascending: false })
      .order('nome')

    if (error) toastErro('Nao foi possivel carregar os modelos', error.message)
    setLista(linhas ?? [])
    setCarregando(false)
  }, [toastErro])

  useEffect(() => {
    void carregar()
  }, [carregar])

  function set<K extends keyof Form>(campo: K, valor: Form[K]) {
    setForm((f) => ({ ...f, [campo]: valor }))
  }

  function abrirNovo() {
    setEditando(null)
    setForm({ ...FORM_VAZIO, clausulas: [] })
    setErros({})
    setModal(true)
  }

  function abrirEdicao(m: ModeloContrato) {
    setEditando(m)
    setForm({ ...m })
    setErros({})
    setModal(true)
  }

  /** Preenche com as clausulas de locacao residencial que vem no sistema. */
  function usarPadrao() {
    setForm((f) => ({
      ...f,
      nome: f.nome || 'Locacao residencial',
      tipo: 'locacao_residencial',
      cabecalho: CABECALHO_PADRAO,
      clausulas: CLAUSULAS_PADRAO.map((c) => ({ ...c })),
      rodape: RODAPE_PADRAO,
    }))
  }

  /* ------------------------------------------------------- clausulas -- */

  function alterarClausula(i: number, campo: keyof Clausula, valor: string) {
    setForm((f) => {
      const cs = [...(f.clausulas ?? [])]
      cs[i] = { ...cs[i], [campo]: valor }
      return { ...f, clausulas: cs }
    })
  }

  function moverClausula(i: number, direcao: -1 | 1) {
    setForm((f) => {
      const cs = [...(f.clausulas ?? [])]
      const destino = i + direcao
      if (destino < 0 || destino >= cs.length) return f
      ;[cs[i], cs[destino]] = [cs[destino], cs[i]]
      return { ...f, clausulas: cs }
    })
  }

  function removerClausula(i: number) {
    setForm((f) => ({
      ...f,
      clausulas: (f.clausulas ?? []).filter((_, x) => x !== i),
    }))
  }

  function adicionarClausula() {
    setForm((f) => ({
      ...f,
      clausulas: [...(f.clausulas ?? []), { titulo: '', texto: '' }],
    }))
  }

  /* ---------------------------------------------------------- salvar -- */

  function validar(): boolean {
    const e: Record<string, string> = {}
    if (!form.nome?.trim()) e.nome = 'De um nome ao modelo.'
    if ((form.clausulas ?? []).length === 0) e.clausulas = 'Um modelo sem clausula nao gera contrato.'
    if ((form.clausulas ?? []).some((c) => !c.titulo.trim() || !c.texto.trim())) {
      e.clausulas = 'Toda clausula precisa de titulo e texto.'
    }
    setErros(e)
    return Object.keys(e).length === 0
  }

  async function salvar() {
    if (!validar()) return
    setSalvando(true)

    // Um padrao por imobiliaria: o indice unico parcial recusaria o segundo.
    // Limpar antes evita o erro cru do banco na cara do usuario.
    if (form.padrao) {
      const limpar = supabase.from('modelos_contrato').update({ padrao: false }).eq('padrao', true)
      await (editando ? limpar.neq('id', editando.id) : limpar)
    }

    const payload = {
      nome: form.nome!.trim(),
      tipo: form.tipo ?? 'locacao_residencial',
      cabecalho: form.cabecalho ?? '',
      clausulas: form.clausulas ?? [],
      rodape: form.rodape ?? '',
      padrao: form.padrao ?? false,
      ativo: form.ativo ?? true,
    }

    const resposta = editando
      ? await supabase.from('modelos_contrato').update(payload).eq('id', editando.id)
      : await supabase.from('modelos_contrato').insert(comTenant(payload))

    setSalvando(false)
    if (resposta.error) return toastErro('Nao foi possivel salvar', resposta.error.message)

    ok(editando ? 'Modelo atualizado' : 'Modelo criado')
    setModal(false)
    await carregar()
  }

  async function confirmarExclusao() {
    if (!excluir) return
    setExcluindo(true)
    const { error } = await supabase.from('modelos_contrato').delete().eq('id', excluir.id)
    setExcluindo(false)
    if (error) return toastErro('Nao foi possivel excluir', error.message)
    ok('Modelo excluido')
    setExcluir(null)
    await carregar()
  }

  /* ------------------------------------------------------------ tela -- */

  return (
    <div>
      <div className="aviso aviso--alerta mb-2">
        <FileSignature size={16} />
        <span>
          As clausulas que vem prontas sao um <strong>ponto de partida</strong>, escritas
          com base na praxe de locacao residencial. Contrato e assunto juridico:
          submeta o texto ao advogado da imobiliaria antes de usar com cliente.
        </span>
      </div>

      <div className="barra">
        <span className="contador">{lista.length} modelo(s)</span>
        <div className="barra__dir">
          <button className="btn btn--primario" onClick={abrirNovo}>
            <Plus size={15} /> Novo modelo
          </button>
        </div>
      </div>

      {carregando ? (
        <SkeletonTabela linhas={3} colunas={4} />
      ) : lista.length === 0 ? (
        <Vazio
          icone={<FileSignature size={22} />}
          titulo="Nenhum modelo de contrato"
          texto="Crie um modelo e o sistema passa a gerar o contrato preenchido com os dados da locacao."
          acao={
            <button className="btn btn--primario" onClick={abrirNovo}>
              <Plus size={15} /> Criar o primeiro
            </button>
          }
        />
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Modelo</th>
                <th>Tipo</th>
                <th>Clausulas</th>
                <th>Atualizado</th>
                <th className="dir">Acoes</th>
              </tr>
            </thead>
            <tbody>
              {lista.map((m) => (
                <tr key={m.id}>
                  <td className="celula-forte">
                    {m.nome}
                    {m.padrao && <span className="badge badge--primaria" style={{ marginLeft: 8 }}>Padrao</span>}
                  </td>
                  <td>{LABEL_TIPO_MODELO[m.tipo]}</td>
                  <td className="t-num">{m.clausulas.length}</td>
                  <td className="celula-fraca">{data(m.updated_at)}</td>
                  <td className="dir nowrap">
                    <button className="btn btn--fantasma btn--sm" title="Editar" onClick={() => abrirEdicao(m)}>
                      <Pencil size={13} />
                    </button>
                    <button className="btn btn--fantasma btn--sm" title="Excluir" onClick={() => setExcluir(m)}>
                      <Trash2 size={13} color="var(--erro)" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ------------------------------------------------------- modal -- */}
      <Modal
        aberto={modal}
        aoFechar={() => setModal(false)}
        titulo={editando ? 'Editar modelo' : 'Novo modelo de contrato'}
        subtitulo="Use marcadores para o sistema preencher os dados da locacao"
        tamanho="xl"
        rodape={
          <>
            <button className="btn btn--secundario" onClick={() => setModal(false)} disabled={salvando}>
              Cancelar
            </button>
            <button className="btn btn--primario" onClick={() => void salvar()} disabled={salvando}>
              {salvando && <span className="spin spin--sm spin--claro" />}
              {editando ? 'Salvar alteracoes' : 'Criar modelo'}
            </button>
          </>
        }
      >
        <div className="form-grade">
          <Campo rotulo="Nome do modelo" obrigatorio erro={erros.nome} className="col-6">
            <input
              className={`input ${erros.nome ? 'input--erro' : ''}`}
              value={form.nome ?? ''}
              onChange={(e) => set('nome', e.target.value)}
              placeholder="Locacao residencial"
            />
          </Campo>

          <Campo rotulo="Tipo" className="col-4">
            <select
              className="select"
              value={form.tipo ?? 'locacao_residencial'}
              onChange={(e) => set('tipo', e.target.value as ModeloContrato['tipo'])}
            >
              {Object.entries(LABEL_TIPO_MODELO).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Padrao" dica="Sugerido ao gerar" className="col-2">
            <button
              type="button"
              className={`btn btn--sm ${form.padrao ? 'btn--primario' : 'btn--secundario'}`}
              onClick={() => set('padrao', !form.padrao)}
              style={{ width: '100%' }}
            >
              <Star size={13} /> {form.padrao ? 'Sim' : 'Nao'}
            </button>
          </Campo>

          {(form.clausulas ?? []).length === 0 && (
            <div className="col-12">
              <button type="button" className="btn btn--secundario" onClick={usarPadrao}>
                <Sparkles size={14} /> Comecar do modelo de locacao residencial
              </button>
            </div>
          )}

          <div className="form-secao">Cabecalho</div>
          <Campo
            rotulo="Titulo e qualificacao das partes"
            className="col-12"
            dica="A primeira linha vira o titulo centralizado do documento."
          >
            <textarea
              className="textarea"
              rows={7}
              value={form.cabecalho ?? ''}
              onChange={(e) => set('cabecalho', e.target.value)}
              placeholder="CONTRATO DE LOCACAO..."
            />
          </Campo>

          <div className="form-secao">
            Clausulas {erros.clausulas && <span className="campo__erro"> — {erros.clausulas}</span>}
          </div>

          <div className="col-12">
            {(form.clausulas ?? []).map((c, i) => (
              <div key={i} className="clausula">
                <div className="clausula__topo">
                  <span className="clausula__n">{i + 1}</span>
                  <input
                    className="input"
                    value={c.titulo}
                    onChange={(e) => alterarClausula(i, 'titulo', e.target.value)}
                    placeholder="DO OBJETO"
                  />
                  <button
                    type="button" className="btn btn--fantasma btn--sm" title="Subir"
                    onClick={() => moverClausula(i, -1)} disabled={i === 0}
                  >
                    <ChevronUp size={13} />
                  </button>
                  <button
                    type="button" className="btn btn--fantasma btn--sm" title="Descer"
                    onClick={() => moverClausula(i, 1)}
                    disabled={i === (form.clausulas ?? []).length - 1}
                  >
                    <ChevronDown size={13} />
                  </button>
                  <button
                    type="button" className="btn btn--fantasma btn--sm" title="Remover clausula"
                    onClick={() => removerClausula(i)}
                  >
                    <Trash2 size={13} color="var(--erro)" />
                  </button>
                </div>
                <textarea
                  className="textarea"
                  rows={4}
                  value={c.texto}
                  onChange={(e) => alterarClausula(i, 'texto', e.target.value)}
                  placeholder="Texto da clausula, com marcadores como {{locatario.nome}}"
                />
              </div>
            ))}

            <button type="button" className="btn btn--secundario btn--sm mt-2" onClick={adicionarClausula}>
              <Plus size={13} /> Adicionar clausula
            </button>
          </div>

          <div className="form-secao">Fecho</div>
          <Campo rotulo="Local, data e encerramento" className="col-12">
            <textarea
              className="textarea"
              rows={4}
              value={form.rodape ?? ''}
              onChange={(e) => set('rodape', e.target.value)}
            />
          </Campo>

          {/* -------------------------------------------- marcadores -- */}
          <div className="col-12">
            <button
              type="button"
              className="btn btn--fantasma btn--sm"
              onClick={() => setVerMarcadores((v) => !v)}
            >
              {verMarcadores ? 'Ocultar' : 'Ver'} os {MARCADORES.length} marcadores disponiveis
            </button>

            {verMarcadores && (
              <div className="marcadores">
                {MARCADORES.map((m) => (
                  <div key={m.chave} className="marcadores__item">
                    <code className="codigo">{`{{${m.chave}}}`}</code>
                    <span>{m.descricao}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </Modal>

      <Confirmar
        aberto={Boolean(excluir)}
        titulo="Excluir modelo"
        mensagem={`Excluir "${excluir?.nome}"? Os contratos ja gerados a partir dele nao sao afetados.`}
        textoConfirmar="Excluir"
        perigo
        processando={excluindo}
        aoConfirmar={() => void confirmarExclusao()}
        aoCancelar={() => setExcluir(null)}
      />
    </div>
  )
}
