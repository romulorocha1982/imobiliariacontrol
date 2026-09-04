/**
 * Quanto um imovel deu no ano, nas duas leituras.
 *
 * Sao perguntas diferentes e o numero e diferente:
 *
 *   proprietario  "esse imovel vale a pena?"  aluguel - taxa - custos do dono
 *   imobiliaria   "administrar da lucro?"     taxa + comissao - custos absorvidos
 *
 * Quem opera precisa das duas -- e quem e dono e administrador ao mesmo tempo,
 * como acontece com quem administra a propria carteira, precisa ainda mais, para
 * nao confundir o dinheiro do imovel com o da administracao.
 *
 * Conta so o que foi PAGO. Previsto vira uma linha separada, porque contrato
 * assinado nao e dinheiro em caixa.
 */
import { useCallback, useEffect, useState } from 'react'
import { TrendingDown, TrendingUp, Wrench } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { useToast } from '@/contexts/ToastContext'
import { Carregando } from '@/components/ui'
import { moeda } from '@/lib/format'
import { LABEL_CATEGORIA, type ResultadoImovel as Resultado } from '@/lib/types'

/** Do ano atual para tras. Contrato de locacao raramente passa de cinco anos. */
function anosDisponiveis(): number[] {
  const atual = new Date().getFullYear()
  return [0, 1, 2, 3, 4].map((n) => atual - n)
}

export function ResultadoImovel({ imovelId }: { imovelId: string }) {
  const { erro: toastErro } = useToast()

  const [ano, setAno] = useState(new Date().getFullYear())
  const [dados, setDados] = useState<Resultado | null>(null)
  const [carregando, setCarregando] = useState(true)

  const carregar = useCallback(async () => {
    setCarregando(true)
    const { data, error } = await supabase.rpc('resultado_imovel', {
      p_imovel_id: imovelId,
      p_ano: ano,
    })
    setCarregando(false)

    if (error) {
      toastErro('Nao foi possivel calcular o resultado', error.message)
      return
    }
    setDados(data)
  }, [imovelId, ano, toastErro])

  useEffect(() => {
    void carregar()
  }, [carregar])

  const p = dados?.proprietario
  const i = dados?.imobiliaria

  return (
    <div className="col-12">
      <div className="linha linha--entre mb-2">
        <span className="t-2 t-xs">
          Considera apenas o que ja foi pago. O previsto aparece a parte.
        </span>
        <select
          className="select"
          value={ano}
          onChange={(e) => setAno(Number(e.target.value))}
          aria-label="Ano do resultado"
          style={{ maxWidth: 120 }}
        >
          {anosDisponiveis().map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {carregando ? (
        <Carregando texto="Somando o ano..." />
      ) : !dados ? null : (
        <>
          <div className="grade grade--2">
            {/* ------------------------------------------------ dono -- */}
            <div className="resultado">
              <div className="resultado__topo">
                <span className="resultado__quem">Para o proprietario</span>
                <span className="t-2 t-xs">esse imovel vale a pena?</span>
              </div>
              <div
                className={`resultado__valor ${(p?.resultado ?? 0) < 0 ? 't-erro' : 't-ok'}`}
              >
                {moeda(p?.resultado ?? 0)}
              </div>
              <dl className="resultado__linhas">
                <div><dt>Repasses recebidos</dt><dd>{moeda(p?.repasse ?? 0)}</dd></div>
                <div><dt>Custos que o dono arcou</dt><dd>− {moeda(p?.custos ?? 0)}</dd></div>
              </dl>
            </div>

            {/* ------------------------------------------ administracao -- */}
            <div className="resultado">
              <div className="resultado__topo">
                <span className="resultado__quem">Para a imobiliaria</span>
                <span className="t-2 t-xs">administrar da lucro?</span>
              </div>
              <div
                className={`resultado__valor ${(i?.resultado ?? 0) < 0 ? 't-erro' : 't-ok'}`}
              >
                {moeda(i?.resultado ?? 0)}
              </div>
              <dl className="resultado__linhas">
                <div><dt>Recebido dos inquilinos</dt><dd>{moeda(i?.aluguel ?? 0)}</dd></div>
                <div><dt>Repassado ao proprietario</dt><dd>− {moeda(i?.repasse ?? 0)}</dd></div>
                <div><dt>Comissao de venda</dt><dd>{moeda(i?.comissao ?? 0)}</dd></div>
                <div><dt>Custos que absorveu</dt><dd>− {moeda(i?.custos ?? 0)}</dd></div>
              </dl>
            </div>
          </div>

          <div className="linha mt-2" style={{ flexWrap: 'wrap', gap: 10 }}>
            <span className="chip">
              <Wrench size={13} /> Manutencao no ano: <strong>{moeda(dados.manutencao)}</strong>
            </span>
            <span className="chip">
              <TrendingUp size={13} /> Ainda a receber: <strong>{moeda(dados.aberto.a_receber)}</strong>
            </span>
            <span className="chip">
              <TrendingDown size={13} /> Ainda a pagar: <strong>{moeda(dados.aberto.a_pagar)}</strong>
            </span>
          </div>

          {dados.categorias.length === 0 ? (
            <p className="t-2 t-xs mt-2">
              Nenhum lancamento vinculado a este imovel em {dados.ano}. Lance a
              manutencao em Financeiro, escolhendo a categoria e vinculando o imovel.
            </p>
          ) : (
            <div className="tabela-wrap mt-2">
              <table className="tabela">
                <thead>
                  <tr>
                    <th>Categoria</th>
                    <th>Tipo</th>
                    <th className="dir">Pago no ano</th>
                    <th className="dir">Em aberto</th>
                  </tr>
                </thead>
                <tbody>
                  {dados.categorias.map((c) => (
                    <tr key={`${c.categoria}-${c.tipo}`}>
                      <td className="celula-forte">{LABEL_CATEGORIA[c.categoria]}</td>
                      <td>
                        <span className={`badge ${c.tipo === 'receita' ? 'badge--ok' : 'badge--neutro'}`}>
                          {c.tipo === 'receita' ? 'Entrada' : 'Saida'}
                        </span>
                      </td>
                      <td className="dir t-num">{moeda(c.total ?? 0)}</td>
                      <td className="dir t-num celula-fraca">{moeda(c.em_aberto ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
