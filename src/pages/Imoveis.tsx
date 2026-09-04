import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Plus, Search, Building2, MapPin, BedDouble, Bath, Car, Ruler,
  LayoutGrid, List, Pencil, Trash2, ImageIcon,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useAuth } from '@/contexts/AuthContext'
import { useToast } from '@/contexts/ToastContext'
import { Modal, Campo, Confirmar, Vazio, BadgeImovel, SkeletonTabela } from '@/components/ui'
import { Fotos } from '@/components/Fotos'
import { Anexos } from '@/components/Anexos'
import { ResultadoImovel } from '@/components/ResultadoImovel'
import { moeda, mascaraCep, enderecoLinha } from '@/lib/format'
import {
  LABEL_TIPO_IMOVEL, LABEL_FINALIDADE, LABEL_STATUS_IMOVEL, UF_LISTA,
  type ImovelCompleto, type Imovel, type Proprietario,
  type ImovelTipo, type ImovelFinalidade, type ImovelStatus,
} from '@/lib/types'

type Form = Partial<Imovel>

const FORM_VAZIO: Form = {
  titulo: '',
  tipo: 'apartamento',
  finalidade: 'locacao',
  status: 'disponivel',
  quartos: 0,
  suites: 0,
  banheiros: 0,
  vagas: 0,
  mobiliado: false,
  aceita_pet: false,
  valor_condominio: 0,
  valor_iptu: 0,
  taxa_administracao: 10,
  comissao_venda: 6,
}

export default function Imoveis() {
  const { pode, comTenant } = useAuth()
  const { ok, erro: toastErro } = useToast()

  const [lista, setLista] = useState<ImovelCompleto[]>([])
  const [proprietarios, setProprietarios] = useState<Proprietario[]>([])
  const [carregando, setCarregando] = useState(true)

  const [busca, setBusca] = useState('')
  const [fStatus, setFStatus] = useState<'' | ImovelStatus>('')
  const [fTipo, setFTipo] = useState<'' | ImovelTipo>('')
  const [fFinalidade, setFFinalidade] = useState<'' | ImovelFinalidade>('')
  const [visao, setVisao] = useState<'grade' | 'tabela'>('grade')

  const [modal, setModal] = useState(false)
  const [editando, setEditando] = useState<ImovelCompleto | null>(null)
  const [form, setForm] = useState<Form>(FORM_VAZIO)
  const [salvando, setSalvando] = useState(false)
  const [erros, setErros] = useState<Record<string, string>>({})
  const [excluir, setExcluir] = useState<ImovelCompleto | null>(null)
  const [excluindo, setExcluindo] = useState(false)

  /** Aba do modal. Fotos, anexos e resultado precisam de um id, entao so
   *  existem na edicao. */
  const [aba, setAba] = useState<'dados' | 'fotos' | 'anexos' | 'resultado'>('dados')

  const podeEditar = pode('admin', 'gerente', 'corretor')

  const carregar = useCallback(async () => {
    setCarregando(true)
    const [r1, r2] = await Promise.all([
      supabase.from('vw_imoveis_completo').select('*').order('created_at', { ascending: false }),
      supabase.from('proprietarios').select('*').eq('ativo', true).order('nome'),
    ])
    if (r1.error) toastErro('Erro ao carregar imoveis', r1.error.message)
    else setLista((r1.data ?? []) as ImovelCompleto[])
    if (!r2.error) setProprietarios((r2.data ?? []) as Proprietario[])
    setCarregando(false)
  }, [toastErro])

  useEffect(() => { void carregar() }, [carregar])

  const filtrados = useMemo(() => {
    const q = busca.trim().toLowerCase()
    return lista.filter((i) => {
      if (fStatus && i.status !== fStatus) return false
      if (fTipo && i.tipo !== fTipo) return false
      if (fFinalidade && i.finalidade !== fFinalidade && i.finalidade !== 'ambos') return false
      if (!q) return true
      return [i.titulo, i.codigo, i.bairro, i.cidade, i.logradouro, i.proprietario_nome]
        .filter(Boolean)
        .some((c) => String(c).toLowerCase().includes(q))
    })
  }, [lista, busca, fStatus, fTipo, fFinalidade])

  function abrirNovo() {
    setEditando(null)
    setForm(FORM_VAZIO)
    setErros({})
    setAba('dados')
    setModal(true)
  }

  function abrirEdicao(i: ImovelCompleto) {
    setEditando(i)
    setForm({ ...i })
    setErros({})
    setAba('dados')
    setModal(true)
  }

  function validar(): boolean {
    const e: Record<string, string> = {}
    if (!form.titulo?.trim()) e.titulo = 'Informe um titulo para o imovel.'
    if (form.finalidade !== 'venda' && !form.valor_aluguel) {
      e.valor_aluguel = 'Informe o valor do aluguel.'
    }
    if (form.finalidade !== 'locacao' && !form.valor_venda) {
      e.valor_venda = 'Informe o valor de venda.'
    }
    setErros(e)
    return Object.keys(e).length === 0
  }

  async function salvar() {
    if (!validar()) return
    setSalvando(true)

    // Campos que existem so na view precisam sair antes do insert/update
    const payload = { ...form }
    delete (payload as Record<string, unknown>).proprietario_nome
    delete (payload as Record<string, unknown>).proprietario_telefone
    delete (payload as Record<string, unknown>).foto_capa
    delete (payload as Record<string, unknown>).created_at
    delete (payload as Record<string, unknown>).updated_at
    if (!editando) delete (payload as Record<string, unknown>).id

    const resposta = editando
      ? await supabase.from('imoveis').update(payload).eq('id', editando.id)
      : await supabase.from('imoveis').insert(comTenant(payload))

    setSalvando(false)

    if (resposta.error) {
      toastErro('Nao foi possivel salvar', resposta.error.message)
      return
    }

    ok(editando ? 'Imovel atualizado' : 'Imovel cadastrado')
    setModal(false)
    void carregar()
  }

  async function confirmarExclusao() {
    if (!excluir) return
    setExcluindo(true)
    const { error } = await supabase.from('imoveis').delete().eq('id', excluir.id)
    setExcluindo(false)

    if (error) {
      const vinculado = error.message.includes('violates foreign key')
      toastErro(
        'Nao foi possivel excluir',
        vinculado
          ? 'Este imovel tem contrato vinculado. Encerre o contrato ou marque o imovel como inativo.'
          : error.message,
      )
      return
    }
    ok('Imovel excluido')
    setExcluir(null)
    void carregar()
  }

  const set = <K extends keyof Form>(campo: K, valor: Form[K]) =>
    setForm((f) => ({ ...f, [campo]: valor }))

  const num = (v: string): number | null => (v === '' ? null : Number(v))

  return (
    <div>
      {/* ---------------------------------------------------------- barra -- */}
      <div className="barra">
        <div className="busca">
          <Search size={15} />
          <input
            className="input"
            placeholder="Buscar por titulo, codigo, bairro..."
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
          />
        </div>

        <select className="select" value={fStatus} onChange={(e) => setFStatus(e.target.value as ImovelStatus | '')}>
          <option value="">Todos os status</option>
          {Object.entries(LABEL_STATUS_IMOVEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>

        <select className="select" value={fTipo} onChange={(e) => setFTipo(e.target.value as ImovelTipo | '')}>
          <option value="">Todos os tipos</option>
          {Object.entries(LABEL_TIPO_IMOVEL).map(([v, l]) => (
            <option key={v} value={v}>{l}</option>
          ))}
        </select>

        <select
          className="select"
          value={fFinalidade}
          onChange={(e) => setFFinalidade(e.target.value as ImovelFinalidade | '')}
        >
          <option value="">Venda e locacao</option>
          <option value="locacao">So locacao</option>
          <option value="venda">So venda</option>
        </select>

        <div className="barra__dir">
          <span className="contador">
            {filtrados.length} de {lista.length}
          </span>
          <button
            className="btn btn--secundario btn--icone"
            onClick={() => setVisao((v) => (v === 'grade' ? 'tabela' : 'grade'))}
            title={visao === 'grade' ? 'Ver em lista' : 'Ver em cards'}
          >
            {visao === 'grade' ? <List size={16} /> : <LayoutGrid size={16} />}
          </button>
          {podeEditar && (
            <button className="btn btn--primario" onClick={abrirNovo}>
              <Plus size={16} /> Novo imovel
            </button>
          )}
        </div>
      </div>

      {/* --------------------------------------------------------- lista -- */}
      {carregando ? (
        <SkeletonTabela linhas={6} colunas={6} />
      ) : filtrados.length === 0 ? (
        <div className="card">
          <Vazio
            icone={<Building2 size={24} />}
            titulo={lista.length === 0 ? 'Nenhum imovel cadastrado' : 'Nada encontrado'}
            texto={
              lista.length === 0
                ? 'Cadastre o primeiro imovel da carteira para comecar.'
                : 'Tente ajustar a busca ou os filtros.'
            }
            acao={
              podeEditar && lista.length === 0 ? (
                <button className="btn btn--primario" onClick={abrirNovo}>
                  <Plus size={16} /> Cadastrar imovel
                </button>
              ) : undefined
            }
          />
        </div>
      ) : visao === 'grade' ? (
        <div className="grade grade--auto">
          {filtrados.map((i) => (
            <CardImovel
              key={i.id}
              imovel={i}
              podeEditar={podeEditar}
              aoEditar={() => abrirEdicao(i)}
              aoExcluir={() => setExcluir(i)}
            />
          ))}
        </div>
      ) : (
        <div className="tabela-wrap">
          <table className="tabela">
            <thead>
              <tr>
                <th>Codigo</th>
                <th>Imovel</th>
                <th>Tipo</th>
                <th>Proprietario</th>
                <th>Status</th>
                <th className="num">Valor</th>
                {podeEditar && <th className="acoes">Acoes</th>}
              </tr>
            </thead>
            <tbody>
              {filtrados.map((i) => (
                <tr key={i.id}>
                  <td><span className="codigo">{i.codigo}</span></td>
                  <td>
                    <div className="celula-forte">{i.titulo}</div>
                    <div className="celula-fraca">{enderecoLinha(i)}</div>
                  </td>
                  <td>{LABEL_TIPO_IMOVEL[i.tipo]}</td>
                  <td>{i.proprietario_nome ?? <span className="t-3">-</span>}</td>
                  <td><BadgeImovel status={i.status} /></td>
                  <td className="num celula-forte">
                    {i.finalidade === 'venda'
                      ? moeda(i.valor_venda)
                      : `${moeda(i.valor_aluguel)}/mes`}
                  </td>
                  {podeEditar && (
                    <td className="acoes">
                      <button className="btn btn--fantasma btn--sm" onClick={() => abrirEdicao(i)}>
                        <Pencil size={13} />
                      </button>
                      <button className="btn btn--fantasma btn--sm" onClick={() => setExcluir(i)}>
                        <Trash2 size={13} color="var(--erro)" />
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* --------------------------------------------------------- modal -- */}
      <Modal
        aberto={modal}
        aoFechar={() => setModal(false)}
        titulo={editando ? `Editar ${editando.codigo}` : 'Novo imovel'}
        subtitulo={editando ? editando.titulo : 'Preencha os dados da propriedade'}
        tamanho="xl"
        rodape={
          <>
            <button className="btn btn--secundario" onClick={() => setModal(false)} disabled={salvando}>
              {aba === 'dados' ? 'Cancelar' : 'Fechar'}
            </button>
            {/* Fotos e anexos gravam no ato; botao de salvar so faz sentido no
                formulario, e mantido nas outras abas so confundiria. */}
            {aba === 'dados' && (
              <button className="btn btn--primario" onClick={() => void salvar()} disabled={salvando}>
                {salvando && <span className="spin spin--sm spin--claro" />}
                {editando ? 'Salvar alteracoes' : 'Cadastrar imovel'}
              </button>
            )}
          </>
        }
      >
        {/* As abas de arquivo dependem do id do imovel, que so existe depois de
            cadastrado. No "Novo imovel" o modal segue sendo so o formulario. */}
        {editando && (
          <div className="abas">
            <button
              className={`aba ${aba === 'dados' ? 'aba--ativa' : ''}`}
              onClick={() => setAba('dados')}
            >
              Dados
            </button>
            <button
              className={`aba ${aba === 'fotos' ? 'aba--ativa' : ''}`}
              onClick={() => setAba('fotos')}
            >
              Fotos do anuncio
            </button>
            <button
              className={`aba ${aba === 'anexos' ? 'aba--ativa' : ''}`}
              onClick={() => setAba('anexos')}
            >
              Vistoria e documentos
            </button>
            <button
              className={`aba ${aba === 'resultado' ? 'aba--ativa' : ''}`}
              onClick={() => setAba('resultado')}
            >
              Resultado do ano
            </button>
          </div>
        )}

        {editando && aba === 'resultado' && (
          <div className="form-grade">
            <ResultadoImovel imovelId={editando.id} />
          </div>
        )}

        {editando && aba === 'fotos' && (
          <div className="form-grade">
            <Fotos imovelId={editando.id} />
          </div>
        )}

        {editando && aba === 'anexos' && (
          <div className="form-grade">
            <Anexos escopo="imoveis" registroId={editando.id} tipoPadrao="vistoria" />
          </div>
        )}

        <div className="form-grade" hidden={aba !== 'dados'}>
          <div className="form-secao">Identificacao</div>

          <Campo rotulo="Titulo do anuncio" obrigatorio erro={erros.titulo} className="col-6">
            <input
              className={`input ${erros.titulo ? 'input--erro' : ''}`}
              value={form.titulo ?? ''}
              onChange={(e) => set('titulo', e.target.value)}
              placeholder="Apartamento 2 quartos no Centro"
            />
          </Campo>

          <Campo rotulo="Tipo" className="col-2">
            <select className="select" value={form.tipo} onChange={(e) => set('tipo', e.target.value as ImovelTipo)}>
              {Object.entries(LABEL_TIPO_IMOVEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Finalidade" className="col-2">
            <select
              className="select"
              value={form.finalidade}
              onChange={(e) => set('finalidade', e.target.value as ImovelFinalidade)}
            >
              {Object.entries(LABEL_FINALIDADE).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Status" className="col-2">
            <select
              className="select"
              value={form.status}
              onChange={(e) => set('status', e.target.value as ImovelStatus)}
            >
              {Object.entries(LABEL_STATUS_IMOVEL).map(([v, l]) => (
                <option key={v} value={v}>{l}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Proprietario" className="col-6" dica="Cadastre em Proprietarios se ainda nao existir.">
            <select
              className="select"
              value={form.proprietario_id ?? ''}
              onChange={(e) => set('proprietario_id', e.target.value || null)}
            >
              <option value="">Sem proprietario vinculado</option>
              {proprietarios.map((p) => (
                <option key={p.id} value={p.id}>{p.nome}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Matricula" className="col-3">
            <input
              className="input"
              value={form.matricula ?? ''}
              onChange={(e) => set('matricula', e.target.value)}
            />
          </Campo>

          <Campo rotulo="Inscricao municipal" className="col-3">
            <input
              className="input"
              value={form.inscricao_municipal ?? ''}
              onChange={(e) => set('inscricao_municipal', e.target.value)}
            />
          </Campo>

          <div className="form-secao">Endereco</div>

          <Campo rotulo="CEP" className="col-2">
            <input
              className="input"
              value={form.cep ?? ''}
              onChange={(e) => set('cep', mascaraCep(e.target.value))}
              placeholder="00000-000"
              inputMode="numeric"
            />
          </Campo>

          <Campo rotulo="Logradouro" className="col-6">
            <input
              className="input"
              value={form.logradouro ?? ''}
              onChange={(e) => set('logradouro', e.target.value)}
              placeholder="Rua das Flores"
            />
          </Campo>

          <Campo rotulo="Numero" className="col-2">
            <input className="input" value={form.numero ?? ''} onChange={(e) => set('numero', e.target.value)} />
          </Campo>

          <Campo rotulo="Complemento" className="col-2">
            <input
              className="input"
              value={form.complemento ?? ''}
              onChange={(e) => set('complemento', e.target.value)}
              placeholder="Apto 42"
            />
          </Campo>

          <Campo rotulo="Bairro" className="col-4">
            <input className="input" value={form.bairro ?? ''} onChange={(e) => set('bairro', e.target.value)} />
          </Campo>

          <Campo rotulo="Cidade" className="col-4">
            <input className="input" value={form.cidade ?? ''} onChange={(e) => set('cidade', e.target.value)} />
          </Campo>

          <Campo rotulo="UF" className="col-2">
            <select className="select" value={form.estado ?? ''} onChange={(e) => set('estado', e.target.value)}>
              <option value="">--</option>
              {UF_LISTA.map((uf) => (
                <option key={uf} value={uf}>{uf}</option>
              ))}
            </select>
          </Campo>

          <Campo rotulo="Andar" className="col-2">
            <input
              className="input"
              type="number"
              value={form.andar ?? ''}
              onChange={(e) => set('andar', num(e.target.value))}
            />
          </Campo>

          <div className="form-secao">Caracteristicas</div>

          <Campo rotulo="Area total (m2)" className="col-2">
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.area_total ?? ''}
              onChange={(e) => set('area_total', num(e.target.value))}
            />
          </Campo>

          <Campo rotulo="Area util (m2)" className="col-2">
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.area_util ?? ''}
              onChange={(e) => set('area_util', num(e.target.value))}
            />
          </Campo>

          <Campo rotulo="Quartos" className="col-2">
            <input
              className="input"
              type="number"
              min="0"
              value={form.quartos ?? 0}
              onChange={(e) => set('quartos', Number(e.target.value))}
            />
          </Campo>

          <Campo rotulo="Suites" className="col-2">
            <input
              className="input"
              type="number"
              min="0"
              value={form.suites ?? 0}
              onChange={(e) => set('suites', Number(e.target.value))}
            />
          </Campo>

          <Campo rotulo="Banheiros" className="col-2">
            <input
              className="input"
              type="number"
              min="0"
              value={form.banheiros ?? 0}
              onChange={(e) => set('banheiros', Number(e.target.value))}
            />
          </Campo>

          <Campo rotulo="Vagas" className="col-2">
            <input
              className="input"
              type="number"
              min="0"
              value={form.vagas ?? 0}
              onChange={(e) => set('vagas', Number(e.target.value))}
            />
          </Campo>

          <div className="col-12 linha" style={{ gap: 20 }}>
            <label className="check">
              <input
                type="checkbox"
                checked={form.mobiliado ?? false}
                onChange={(e) => set('mobiliado', e.target.checked)}
              />
              <span>Mobiliado</span>
            </label>
            <label className="check">
              <input
                type="checkbox"
                checked={form.aceita_pet ?? false}
                onChange={(e) => set('aceita_pet', e.target.checked)}
              />
              <span>Aceita animais</span>
            </label>
          </div>

          <Campo rotulo="Descricao" className="col-12">
            <textarea
              className="textarea"
              value={form.descricao ?? ''}
              onChange={(e) => set('descricao', e.target.value)}
              placeholder="Detalhes do imovel, diferenciais, estado de conservacao..."
            />
          </Campo>

          <div className="form-secao">Valores</div>

          {form.finalidade !== 'venda' && (
            <Campo rotulo="Aluguel (R$)" obrigatorio erro={erros.valor_aluguel} className="col-3">
              <input
                className={`input ${erros.valor_aluguel ? 'input--erro' : ''}`}
                type="number"
                step="0.01"
                value={form.valor_aluguel ?? ''}
                onChange={(e) => set('valor_aluguel', num(e.target.value))}
              />
            </Campo>
          )}

          {form.finalidade !== 'locacao' && (
            <Campo rotulo="Venda (R$)" obrigatorio erro={erros.valor_venda} className="col-3">
              <input
                className={`input ${erros.valor_venda ? 'input--erro' : ''}`}
                type="number"
                step="0.01"
                value={form.valor_venda ?? ''}
                onChange={(e) => set('valor_venda', num(e.target.value))}
              />
            </Campo>
          )}

          <Campo rotulo="Condominio (R$)" className="col-2">
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.valor_condominio ?? 0}
              onChange={(e) => set('valor_condominio', num(e.target.value))}
            />
          </Campo>

          <Campo rotulo="IPTU mensal (R$)" className="col-2">
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.valor_iptu ?? 0}
              onChange={(e) => set('valor_iptu', num(e.target.value))}
            />
          </Campo>

          <Campo rotulo="Taxa adm (%)" className="col-2" dica="Sobre o aluguel">
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.taxa_administracao ?? ''}
              onChange={(e) => set('taxa_administracao', num(e.target.value))}
            />
          </Campo>

          <Campo rotulo="Comissao venda (%)" className="col-2">
            <input
              className="input"
              type="number"
              step="0.01"
              value={form.comissao_venda ?? ''}
              onChange={(e) => set('comissao_venda', num(e.target.value))}
            />
          </Campo>

          <Campo rotulo="Observacoes internas" className="col-12">
            <textarea
              className="textarea"
              value={form.observacoes ?? ''}
              onChange={(e) => set('observacoes', e.target.value)}
              placeholder="Nao aparece para clientes."
            />
          </Campo>
        </div>
      </Modal>

      <Confirmar
        aberto={Boolean(excluir)}
        titulo="Excluir imovel"
        mensagem={`Excluir "${excluir?.titulo}" permanentemente? Esta acao nao pode ser desfeita.`}
        textoConfirmar="Excluir"
        perigo
        processando={excluindo}
        aoConfirmar={() => void confirmarExclusao()}
        aoCancelar={() => setExcluir(null)}
      />
    </div>
  )
}

/* ------------------------------------------------------------ CARD ------ */

function CardImovel({
  imovel: i, podeEditar, aoEditar, aoExcluir,
}: {
  imovel: ImovelCompleto
  podeEditar: boolean
  aoEditar: () => void
  aoExcluir: () => void
}) {
  return (
    <article className="imovel-card">
      <div className="imovel-card__foto">
        {i.foto_capa ? (
          <img src={i.foto_capa} alt={i.titulo} loading="lazy" />
        ) : (
          <div className="imovel-card__vazio">
            <ImageIcon size={30} />
          </div>
        )}
        <div className="imovel-card__status">
          <BadgeImovel status={i.status} />
        </div>
        <span className="imovel-card__cod">{i.codigo}</span>
      </div>

      <div className="imovel-card__corpo">
        <h3 className="imovel-card__titulo">{i.titulo}</h3>
        <div className="imovel-card__local">
          <MapPin size={12} />
          {[i.bairro, i.cidade].filter(Boolean).join(', ') || 'Local nao informado'}
        </div>

        <div className="imovel-card__specs">
          {Boolean(i.quartos) && (
            <span className="imovel-card__spec"><BedDouble size={13} /> {i.quartos}</span>
          )}
          {Boolean(i.banheiros) && (
            <span className="imovel-card__spec"><Bath size={13} /> {i.banheiros}</span>
          )}
          {Boolean(i.vagas) && (
            <span className="imovel-card__spec"><Car size={13} /> {i.vagas}</span>
          )}
          {Boolean(i.area_util) && (
            <span className="imovel-card__spec"><Ruler size={13} /> {i.area_util}m2</span>
          )}
        </div>

        <div className="imovel-card__preco">
          <div>
            <div className="imovel-card__valor">
              {i.finalidade === 'venda' ? moeda(i.valor_venda) : moeda(i.valor_aluguel)}
              {i.finalidade !== 'venda' && <small> /mes</small>}
            </div>
            {i.finalidade === 'ambos' && i.valor_venda && (
              <div className="t-3 t-xs">Venda: {moeda(i.valor_venda)}</div>
            )}
          </div>

          {podeEditar && (
            <div className="linha" style={{ gap: 2 }}>
              <button className="btn btn--fantasma btn--sm" onClick={aoEditar} title="Editar">
                <Pencil size={13} />
              </button>
              <button className="btn btn--fantasma btn--sm" onClick={aoExcluir} title="Excluir">
                <Trash2 size={13} color="var(--erro)" />
              </button>
            </div>
          )}
        </div>
      </div>
    </article>
  )
}
