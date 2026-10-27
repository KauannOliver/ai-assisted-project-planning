'use client';

import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, ArrowLeft, ArrowRight, CheckCircle2, ChevronLeft, ChevronRight,
  Database, FileSpreadsheet, Loader2, UploadCloud, X,
} from 'lucide-react';
import { apiRequest, authenticatedFetch } from '@/lib/api';

type ImportType = 'projects' | 'allocations' | 'unavailabilities' | 'committee';
type ImportMode = 'create_only' | 'upsert';

type Props = {
  open: boolean;
  onClose: () => void;
  onImported: (result: any) => void;
};

const TYPES: Array<{ value: ImportType; label: string; description: string; fileName: string }> = [
  { value: 'projects', label: 'Projetos', description: 'Cadastros, catálogos, datas e informações financeiras.', fileName: 'modelo_projetos.xlsx' },
  { value: 'allocations', label: 'Alocações', description: 'Recursos, fases e modos de execução.', fileName: 'modelo_alocacoes.xlsx' },
  { value: 'unavailabilities', label: 'Indisponibilidades', description: 'Férias, licenças, recessos e bloqueios de agenda.', fileName: 'modelo_indisponibilidades.xlsx' },
  { value: 'committee', label: 'Comitê', description: 'Uma reunião completa, com decisões, notas, pareceres e valores.', fileName: 'modelo_comite.xlsx' },
];

export function ImportDataModal({ open, onClose, onImported }: Props) {
  const [type, setType] = useState<ImportType>('projects');
  const [mode, setMode] = useState<ImportMode>('create_only');
  const [csvText, setCsvText] = useState('');
  const [fileInfo, setFileInfo] = useState<any>(null);
  const [validation, setValidation] = useState<any>(null);
  const [preview, setPreview] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [errorPage, setErrorPage] = useState(1);
  const pageSize = 10;

  useEffect(() => {
    if (!open) return;
    setValidation(null); setPreview(null); setMessage(''); setErrorPage(1);
  }, [open]);

  const currentType = TYPES.find(item => item.value === type)!;
  const errors = validation?.errors || [];
  const totalErrorPages = Math.max(1, Math.ceil(errors.length / pageSize));
  const pagedErrors = useMemo(() => errors.slice((errorPage - 1) * pageSize, errorPage * pageSize), [errors, errorPage]);
  const step = message ? 4 : preview ? 4 : validation ? 3 : csvText ? 2 : 1;

  const resetData = () => {
    setCsvText(''); setFileInfo(null); setValidation(null); setPreview(null); setMessage(''); setErrorPage(1);
  };

  const downloadTemplate = async () => {
    setBusy(true);
    try {
      const response = await authenticatedFetch(`/imports/templates/${type}`);
      if (!response.ok) throw new Error('Não foi possível gerar o modelo.');
      const url = URL.createObjectURL(await response.blob()); const link = document.createElement('a');
      link.href = url; link.download = currentType.fileName; link.click(); URL.revokeObjectURL(url);
    } catch (error: any) { alert(error.message); } finally { setBusy(false); }
  };

  const handleFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; if (!file) return;
    setBusy(true); setValidation(null); setPreview(null); setMessage('');
    try {
      const formData = new FormData(); formData.append('file', file);
      const parsed = await apiRequest(`/imports/${type}/parse`, { method: 'POST', body: formData });
      setCsvText(parsed.csvText || ''); setFileInfo(parsed);
    } catch (error: any) { alert(error.message || 'Não foi possível ler a planilha.'); }
    finally { setBusy(false); event.target.value = ''; }
  };

  const validate = async () => {
    if (!csvText.trim()) return;
    setBusy(true); setValidation(null); setPreview(null); setErrorPage(1);
    try {
      const result = await apiRequest(`/imports/${type}/validate`, { method: 'POST', body: JSON.stringify({ csvText, mode }) });
      setValidation(result);
      if (result.valid) {
        const impact = await apiRequest(`/imports/${type}/preview-impact`, { method: 'POST', body: JSON.stringify({ csvText, mode }) });
        setPreview(impact);
      }
    } catch (error: any) { alert(error.message || 'Não foi possível validar o arquivo.'); }
    finally { setBusy(false); }
  };

  const confirm = async () => {
    if (!preview) return;
    setBusy(true);
    try {
      const result = await apiRequest(`/imports/${type}/confirm`, { method: 'POST', body: JSON.stringify({ csvText, mode, stateHash: preview.stateHash }) });
      setMessage(`${result.count} registro${result.count === 1 ? '' : 's'} processado${result.count === 1 ? '' : 's'} com sucesso.`);
      onImported(result);
    } catch (error: any) { alert(error.message || 'Não foi possível concluir a importação.'); }
    finally { setBusy(false); }
  };

  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content modal-content-xl import-wizard" onClick={event => event.stopPropagation()}>
        <div className="modal-header import-wizard-header">
          <div>
            <div className="import-wizard-kicker"><Database size={14} /> Carga segura de dados</div>
            <h3>Importar dados</h3>
          </div>
          <button className="btn-icon" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>

        <div className="import-stepper" aria-label="Etapas da importação">
          {['Preparar', 'Enviar', 'Validar', 'Confirmar'].map((label, index) => (
            <div key={label} className={`import-step ${step >= index + 1 ? 'active' : ''} ${step > index + 1 ? 'done' : ''}`}>
              <span>{step > index + 1 ? <CheckCircle2 size={15} /> : index + 1}</span><strong>{label}</strong>
            </div>
          ))}
        </div>

        <div className="modal-body import-wizard-body">
          {message ? (
            <div className="import-success-panel">
              <div className="import-success-icon"><CheckCircle2 size={34} /></div>
              <h4>Importação concluída</h4><p>{message}</p>
              <button className="btn btn-primary" onClick={() => { resetData(); onClose(); }}>Concluir</button>
            </div>
          ) : (
            <>
              <section className="import-section">
                <div className="import-section-heading"><span>1</span><div><h4>Escolha o conteúdo</h4><p>Baixe um modelo atualizado com os cadastros disponíveis.</p></div></div>
                <div className="import-type-grid">
                  {TYPES.map(item => (
                    <button key={item.value} type="button" className={`import-type-card ${type === item.value ? 'selected' : ''}`} onClick={() => { setType(item.value); resetData(); }}>
                      <FileSpreadsheet size={20} /><strong>{item.label}</strong><small>{item.description}</small>
                    </button>
                  ))}
                </div>
                <div className="import-config-row">
                  <label><span>Registros existentes</span><select className="input" value={mode} onChange={event => { setMode(event.target.value as ImportMode); setValidation(null); setPreview(null); }}>
                    <option value="create_only">Criar somente — duplicados serão rejeitados</option>
                    <option value="upsert">Atualizar ou criar — recomendado para manutenção</option>
                  </select></label>
                  <button className="btn btn-secondary" onClick={downloadTemplate} disabled={busy}><FileSpreadsheet size={16} /> Baixar modelo de {currentType.label}</button>
                </div>
              </section>

              <section className="import-section">
                <div className="import-section-heading"><span>2</span><div><h4>Envie o arquivo preenchido</h4><p>Formato recomendado: XLSX. CSV permanece disponível para integrações existentes.</p></div></div>
                <label className={`import-dropzone ${fileInfo ? 'has-file' : ''}`}>
                  <input type="file" accept=".xlsx,.csv,.txt" onChange={handleFile} disabled={busy} />
                  {busy ? <Loader2 className="spinner" size={28} /> : fileInfo ? <CheckCircle2 size={28} /> : <UploadCloud size={30} />}
                  <strong>{fileInfo?.fileName || 'Clique para selecionar uma planilha'}</strong>
                  <span>{fileInfo ? `${fileInfo.rows} registros encontrados${fileInfo.sheetName ? ` na aba ${fileInfo.sheetName}` : ''}` : 'Até 10 MB · XLSX, CSV ou TXT'}</span>
                </label>
                {fileInfo?.warnings?.map((warning: string) => <div className="import-inline-warning" key={warning}><AlertCircle size={15} /> {warning}</div>)}
                <details className="import-advanced"><summary>Importação avançada por CSV</summary><p>Cole dados separados por ponto e vírgula. Use esta opção apenas para integrações ou modelos antigos.</p><textarea className="input" value={csvText} onChange={event => { setCsvText(event.target.value); setFileInfo(null); setValidation(null); setPreview(null); }} placeholder="SD;Título;Solicitante;Departamentos;..." /></details>
              </section>

              {validation && (
                <section className="import-section">
                  <div className="import-section-heading"><span>3</span><div><h4>Resultado da validação</h4><p>Nenhuma alteração foi aplicada ao banco de dados nesta etapa.</p></div></div>
                  <div className="import-metrics-grid">
                    <div><span>Linhas lidas</span><strong>{validation.recordsCount || 0}</strong></div>
                    <div className="success"><span>Válidas</span><strong>{validation.validRecordsCount || 0}</strong></div>
                    <div><span>Novas</span><strong>{validation.newCount || 0}</strong></div>
                    <div><span>Atualizações</span><strong>{validation.updatedCount || 0}</strong></div>
                    <div className={validation.rejectedCount ? 'danger' : ''}><span>Rejeitadas</span><strong>{validation.rejectedCount || 0}</strong></div>
                  </div>
                  {!validation.valid && (
                    <div className="import-errors">
                      <div className="import-errors-title"><AlertCircle size={17} /><strong>Corrija os itens abaixo e envie o arquivo novamente.</strong></div>
                      <div className="table-container"><table><thead><tr><th>Linha</th><th>Coluna</th><th>Motivo</th></tr></thead><tbody>{pagedErrors.map((error: any, index: number) => <tr key={`${error.line}-${error.column}-${index}`}><td>{error.line}</td><td>{error.column}</td><td>{error.description}</td></tr>)}</tbody></table></div>
                      {totalErrorPages > 1 && <div className="pagination-wrapper"><span className="pagination-info">{errors.length} inconsistências</span><div className="pagination-controls"><button className="pagination-btn" disabled={errorPage <= 1} onClick={() => setErrorPage(page => page - 1)}><ChevronLeft size={14} /></button><span className="pagination-current">{errorPage} de {totalErrorPages}</span><button className="pagination-btn" disabled={errorPage >= totalErrorPages} onClick={() => setErrorPage(page => page + 1)}><ChevronRight size={14} /></button></div></div>}
                    </div>
                  )}
                </section>
              )}

              {preview && (
                <section className="import-section import-impact-panel">
                  <div className="import-section-heading"><span>4</span><div><h4>Impacto antes da confirmação</h4><p>O cronograma foi simulado com os dados propostos.</p></div></div>
                  <div className="import-impact-grid">
                    <div><span>Projetos afetados</span><strong>{preview.affectedProjectsCount || 0}</strong></div>
                    <div><span>Projetos antecipados</span><strong>{preview.antecipadosCount || 0}</strong></div>
                    <div><span>Projetos postergados</span><strong>{preview.postergadosCount || 0}</strong></div>
                    <div><span>Novos atrasos</span><strong>{preview.novosAtrasos || 0}</strong></div>
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        {!message && <div className="modal-footer import-wizard-footer">
          <button className="btn btn-secondary" onClick={onClose}>Cancelar</button>
          <div>
            {validation && <button className="btn btn-ghost" onClick={() => { setValidation(null); setPreview(null); }}><ArrowLeft size={15} /> Revisar arquivo</button>}
            {!preview ? <button className="btn btn-primary" onClick={validate} disabled={!csvText.trim() || busy}>{busy ? <Loader2 className="spinner" size={15} /> : <ArrowRight size={15} />} Validar e simular</button> : <button className="btn btn-accent" onClick={confirm} disabled={busy}>{busy ? <Loader2 className="spinner" size={15} /> : <CheckCircle2 size={15} />} Confirmar importação</button>}
          </div>
        </div>}
      </div>
    </div>
  );
}
