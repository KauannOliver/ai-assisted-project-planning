'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import { formatDateOnlyPtBr } from '@/lib/date-only';
import {
  ArrowUp, ArrowDown, Settings, AlertTriangle, Loader2, GripVertical, Calendar, CheckCircle, Eye
} from 'lucide-react';
import { ImpactSimulationModal } from '@/components/ImpactSimulationModal';
import { PROJECT_STATUS_FULL_LABELS } from '@/lib/project-status';

interface Project {
  id: string;
  sdNumber: string;
  title: string;
  requester: string;
  openingDate: string;
  requestedDeadline?: string;
  isLegalRequirement: boolean;
  status: number;
  committeeDecision?: string;
  committeeScore: number;
  businessPriorityCode: string;
  allocatedResourceNames: string[];
  position: number;
  simulationEligible?: boolean;
}

export default function PriorityQueuePage() {
  const queryClient = useQueryClient();

  const [user] = useState<any>(() => {
    if (typeof window !== 'undefined') {
      const u = localStorage.getItem('user');
      return u ? JSON.parse(u) : null;
    }
    return null;
  });

  const isAdminOrPm = user?.role === 'ADMIN' || user?.role === 'PROJECT_MANAGER';

  const [localProjects, setLocalProjects] = useState<Project[]>([]);
  const [isReordering, setIsReordering] = useState(false);
  const [draggedIdx, setDraggedIdx] = useState<number | null>(null);

  // Impact Preview State
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewData, setPreviewData] = useState<any>(null);
  const [pendingConfirmAction, setPendingConfirmAction] = useState<(() => Promise<void>) | null>(null);

  // Fetch queue state
  const { data: queueData, isLoading: loadingQueue } = useQuery<{
    mode: 'automatic' | 'manual';
    manualOrder: string[];
    projects: Project[];
    stateHash: string;
  }>({
    queryKey: ['priority-queue'],
    queryFn: async () => {
      const data = await apiRequest('/priority-queue');
      // Filter out Concluded (7), Devolved (8), Cancelled (9)
      const activeOnly = (data.projects || []).filter(
        (p: Project) => p.status !== 7 && p.status !== 8 && p.status !== 9
      );
      setLocalProjects(activeOnly);
      return data;
    },
  });

  // Fetch metrics for portfolio completion date
  const { data: metrics } = useQuery<any>({
    queryKey: ['dashboard-metrics'],
    queryFn: () => apiRequest('/dashboards/overview'),
  });

  // Mutations
  const modeMutation = useMutation({
    mutationFn: async ({ mode, stateHash, previewToken }: { mode: 'automatic' | 'manual'; stateHash: string; previewToken: string }) =>
      apiRequest('/priority-queue/mode/confirm', { method: 'POST', body: JSON.stringify({ mode, stateHash, previewToken }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['priority-queue'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
      setPreviewOpen(false);
      setIsReordering(false);
    },
  });

  const orderMutation = useMutation({
    mutationFn: async ({ manualOrder, stateHash, previewToken }: { manualOrder: string[]; stateHash: string; previewToken: string }) =>
      apiRequest('/priority-queue/manual-order/confirm', { method: 'POST', body: JSON.stringify({ manualOrder, stateHash, previewToken }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['priority-queue'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
      setPreviewOpen(false);
      setIsReordering(false);
    },
  });

  const restoreMutation = useMutation({
    mutationFn: async ({ stateHash, previewToken }: { stateHash: string; previewToken: string }) =>
      apiRequest('/priority-queue/restore-auto/confirm', { method: 'POST', body: JSON.stringify({ stateHash, previewToken }) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['priority-queue'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard-metrics'] });
      setPreviewOpen(false);
      setIsReordering(false);
    },
  });

  if (loadingQueue || !queueData) {
    return (
      <div className="loading-center" style={{ minHeight: '60vh' }}>
        <Loader2 className="spinner" size={24} />
        <span>Carregando fila de prioridades...</span>
      </div>
    );
  }

  // Row move logic
  const handleMove = (index: number, direction: 'UP' | 'DOWN') => {
    if (!isAdminOrPm) return;
    const nextIndex = direction === 'UP' ? index - 1 : index + 1;
    if (nextIndex < 0 || nextIndex >= localProjects.length) return;

    const list = [...localProjects];
    const temp = list[index];
    list[index] = list[nextIndex];
    list[nextIndex] = temp;

    const updated = list.map((p, idx) => ({ ...p, position: idx + 1 }));
    setLocalProjects(updated);
    setIsReordering(true);
  };

  // Drag and drop handlers
  const handleDragStart = (event: React.DragEvent, idx: number) => {
    if (!isAdminOrPm) return;
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', localProjects[idx].id);
    setDraggedIdx(idx);
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    if (draggedIdx === null || draggedIdx === idx) return;
    const list = [...localProjects];
    const draggedItem = list[draggedIdx];
    list.splice(draggedIdx, 1);
    list.splice(idx, 0, draggedItem);

    const updated = list.map((p, i) => ({ ...p, position: i + 1 }));
    setLocalProjects(updated);
    setDraggedIdx(idx);
    setIsReordering(true);
  };

  const handleDragEnd = () => {
    setDraggedIdx(null);
  };

  // Preview & Save manual order
  const handleSaveOrder = async () => {
    try {
      const orderIds = localProjects.map(p => p.id);
      const preview = await apiRequest('/priority-queue/manual-order/preview', {
        method: 'POST',
        body: JSON.stringify({ manualOrder: orderIds }),
      });

      setPreviewData(preview);
      setPendingConfirmAction(() => async () => {
        await orderMutation.mutateAsync({ manualOrder: orderIds, stateHash: preview.stateHash, previewToken: preview.previewToken });
      });
      setPreviewOpen(true);
    } catch (err: any) {
      alert(err.message || 'Erro ao reordenar.');
    }
  };

  const handleResetAuto = async () => {
    try {
      const preview = await apiRequest('/priority-queue/restore-auto/preview', { method: 'POST' });
      setPreviewData(preview);
      setPendingConfirmAction(() => async () => {
        await restoreMutation.mutateAsync({ stateHash: preview.stateHash, previewToken: preview.previewToken });
      });
      setPreviewOpen(true);
    } catch (err: any) {
      alert(err.message || 'Erro ao restaurar modo automático.');
    }
  };

  const getStatusBadge = (st: number) => (
    <span className={`status-badge status-${st}`}>{PROJECT_STATUS_FULL_LABELS[st] || `Status ${st}`}</span>
  );

  const getDecisionBadge = (dec?: string) => {
    switch (dec) {
      case 'PRIORIZADO': return <span className="badge badge-active">PRIORIZADO</span>;
      case 'SEGUNDA_FASE': return <span className="badge badge-warning">2ª FASE</span>;
      case 'CANCELADO': return <span className="badge badge-inactive">CANCELADO</span>;
      default: return <span className="badge badge-navy">NÃO AVALIADO</span>;
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Fila de Prioridades</h1>
          <p className="page-subtitle">Arraste os projetos para reordenar a capacidade da equipe</p>
        </div>
        {isAdminOrPm && (
          <div className="page-actions">
            {isReordering && (
              <>
                <button onClick={() => { setLocalProjects(queueData.projects); setIsReordering(false); }} className="btn btn-secondary btn-sm">Descartar</button>
                <button onClick={handleSaveOrder} className="btn btn-accent btn-sm" disabled={orderMutation.isPending}>
                  <CheckCircle size={14} /> Salvar Nova Ordem
                </button>
              </>
            )}
            <button onClick={handleResetAuto} className="btn btn-secondary btn-sm" disabled={restoreMutation.isPending}>
              Restaurar Ordem Automática
            </button>
          </div>
        )}
      </div>

      {/* Completion Estimate Banner */}
      <div className="card" style={{ marginBottom: '1.25rem', padding: '1rem 1.25rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ width: '40px', height: '40px', borderRadius: 'var(--radius-lg)', background: 'var(--primary-light)', color: 'var(--primary)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <Calendar size={20} />
          </div>
          <div>
            <span className="text-xs text-muted font-medium uppercase" style={{ letterSpacing: '0.04em' }}>Data Final Estimada do Cronograma (Simulação)</span>
            <div style={{ fontSize: '1.25rem', fontWeight: '800', color: 'var(--brand-navy)' }}>
              {metrics?.portfolioEndDate
                ? formatDateOnlyPtBr(metrics.portfolioEndDate)
                : 'Aguardando cálculo...'}
            </div>
          </div>
        </div>
        <div className="text-xs text-muted" style={{ maxWidth: '340px' }}>
          Com os parâmetros de capacidade e a ordem atual da fila, todos os {localProjects.length} projetos ativos serão concluídos até esta data.
        </div>
      </div>

      {/* Mode status */}
      <div className={`alert ${queueData.mode === 'manual' ? 'alert-warning' : 'alert-info'}`} style={{ marginBottom: '1.25rem' }}>
        <Settings size={18} style={{ flexShrink: 0 }} />
        <div>
          <strong>Modo {queueData.mode === 'manual' ? 'MANUAL' : 'AUTOMÁTICO'}:</strong>{' '}
          {queueData.mode === 'manual'
            ? 'A ordem da fila é definida por drag-and-drop e sobrepõe as regras de governança.'
            : 'Projetos ordenados por Requisito Legal, decisão do Comitê, estágio, nota, prioridade de negócio e abertura. Arraste qualquer item para customizar.'}
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: '40px' }}></th>
              <th style={{ width: '60px' }}>Pos.</th>
              <th style={{ width: '58px' }} aria-label="Detalhes do projeto"></th>
              <th style={{ width: '100px' }}>SD</th>
              <th>Título / Solicitante</th>
              <th>Req. Legal</th>
              <th>Comitê</th>
              <th>Nota</th>
              <th>Status</th>
              {isAdminOrPm && <th style={{ textAlign: 'right', width: '90px' }}>Mover</th>}
            </tr>
          </thead>
          <tbody>
            {localProjects.map((p, idx) => (
              <tr
                key={p.id}
                onDragOver={(e) => handleDragOver(e, idx)}
                style={{
                  opacity: draggedIdx === idx ? 0.4 : 1,
                  background: p.isLegalRequirement ? 'var(--danger-light)' : 'transparent',
                  userSelect: 'none',
                }}
              >
                <td style={{ color: 'var(--text-muted)' }}>
                  {isAdminOrPm && (
                    <span
                      draggable
                      onDragStart={(event) => handleDragStart(event, idx)}
                      onDragEnd={handleDragEnd}
                      role="button"
                      tabIndex={0}
                      aria-label={`Arrastar projeto ${p.sdNumber}`}
                      title={`Arrastar projeto ${p.sdNumber}`}
                      style={{ display: 'inline-flex', cursor: 'grab', touchAction: 'none', userSelect: 'none' }}
                    >
                      <GripVertical size={16} aria-hidden="true" />
                    </span>
                  )}
                </td>
                <td style={{ fontWeight: '700', color: 'var(--primary)' }}>#{idx + 1}</td>
                <td>
                  <span className="priority-resource-preview">
                    <Link
                      href={`/dashboard/projects/${p.id}`}
                      className="btn-icon priority-resource-link"
                      title={p.allocatedResourceNames.length > 0 ? p.allocatedResourceNames.join(', ') : 'Sem recurso alocado'}
                      aria-label={`Abrir detalhes do projeto ${p.sdNumber}`}
                      aria-describedby={`priority-resources-${p.id}`}
                      draggable={false}
                      onDragStart={(event) => event.preventDefault()}
                    >
                      <Eye size={15} aria-hidden="true" />
                    </Link>
                    <span id={`priority-resources-${p.id}`} className="priority-resource-tooltip" role="tooltip">
                      {p.allocatedResourceNames.length > 0
                        ? p.allocatedResourceNames.join(', ')
                        : 'Sem recurso alocado'}
                    </span>
                  </span>
                </td>
                <td style={{ fontWeight: '600' }}>{p.sdNumber}</td>
                <td>
                  <div style={{ display: 'flex', flexDirection: 'column' }}>
                    <span className="font-medium">{p.title}</span>
                    <span className="text-xs text-muted">{p.requester}</span>
                    {p.simulationEligible === false && <span className="text-xs" style={{ color: 'var(--accent)' }}>Fora da simulação pelos critérios de elegibilidade</span>}
                  </div>
                </td>
                <td>
                  {p.isLegalRequirement ? (
                    <span className="badge badge-inactive" style={{ fontSize: '0.65rem' }}>SIM</span>
                  ) : (
                    <span className="text-xs text-muted">Não</span>
                  )}
                </td>
                <td>{getDecisionBadge(p.committeeDecision)}</td>
                <td style={{ fontWeight: '600' }}>{p.committeeScore ? `${p.committeeScore}/10` : '—'}</td>
                <td>{getStatusBadge(p.status)}</td>
                {isAdminOrPm && (
                  <td style={{ textAlign: 'right' }}>
                    <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn-icon" aria-label={`Mover projeto ${p.sdNumber} para cima`} title="Mover para cima" disabled={idx === 0} onClick={() => handleMove(idx, 'UP')}>
                        <ArrowUp size={14} />
                      </button>
                      <button className="btn-icon" aria-label={`Mover projeto ${p.sdNumber} para baixo`} title="Mover para baixo" disabled={idx === localProjects.length - 1} onClick={() => handleMove(idx, 'DOWN')}>
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <ImpactSimulationModal
        open={previewOpen}
        data={previewData}
        onClose={() => setPreviewOpen(false)}
        onConfirm={async () => { if (pendingConfirmAction) await pendingConfirmAction(); }}
        confirmLabel="Confirmar Reordenação"
        context="Reordenação da fila de prioridades do portfólio"
      />
    </div>
  );
}
