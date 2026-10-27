'use client';

import React, { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import {
  Plus, Edit, ShieldAlert, Check, X, Loader2, AlertCircle, Database
} from 'lucide-react';

interface CatalogItem {
  id: string; type: string; code: string; name: string;
  value: string | null; order: number | null; status: 'ACTIVE' | 'INACTIVE';
}
interface TabConfig {
  key: string; label: string; showValue: boolean; valueLabel?: string; showOrder: boolean; orderLabel?: string;
}

export default function CatalogsPage() {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState('systems');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);

  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [value, setValue] = useState('');
  const [order, setOrder] = useState('');
  const [targetItem, setTargetItem] = useState<CatalogItem | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const tabs: TabConfig[] = [
    { key: 'systems', label: 'Sistemas', showValue: false, showOrder: false },
    { key: 'classifications', label: 'Classificações', showValue: false, showOrder: false },
    { key: 'flows', label: 'Fluxos', showValue: false, showOrder: false },
    { key: 'priorities', label: 'Prioridades', showValue: true, valueLabel: 'Valor (Ordem)', showOrder: true, orderLabel: 'Ordem Visual' },
    { key: 'classes', label: 'Classes', showValue: true, valueLabel: 'Horas Padrão', showOrder: false },
    { key: 'phases', label: 'Fases Globais', showValue: true, valueLabel: 'Porcentagem (%)', showOrder: true, orderLabel: 'Ordem de Execução' },
    { key: 'impediments', label: 'Tipos Impedimento', showValue: false, showOrder: false },
    { key: 'modalities', label: 'Modalidades Recurso', showValue: false, showOrder: false },
    { key: 'roles', label: 'Cargos Técnicos', showValue: false, showOrder: false },
  ];

  const currentTabConfig = tabs.find(t => t.key === activeTab)!;

  const { data: items = [], isLoading } = useQuery<CatalogItem[]>({
    queryKey: ['catalogs', activeTab], queryFn: () => apiRequest(`/catalogs/${activeTab}`),
  });

  const createMutation = useMutation({
    mutationFn: (body: any) => apiRequest(`/catalogs/${activeTab}`, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['catalogs', activeTab] }); setShowCreateModal(false); resetForm(); },
    onError: (err: any) => setErrorMsg(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: (body: any) => apiRequest(`/catalogs/${activeTab}/${targetItem?.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['catalogs', activeTab] }); setShowEditModal(false); resetForm(); },
    onError: (err: any) => setErrorMsg(err.message),
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/catalogs/${activeTab}/${id}/activate`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['catalogs', activeTab] }),
    onError: (err: any) => alert(err.message),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/catalogs/${activeTab}/${id}/deactivate`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['catalogs', activeTab] }),
    onError: (err: any) => alert(err.message || 'Não foi possível desativar.'),
  });

  const resetForm = () => { setCode(''); setName(''); setValue(''); setOrder(''); setTargetItem(null); setErrorMsg(null); };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const body: any = {
      code: code.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_'),
      name: name.trim(),
    };
    if (currentTabConfig.showValue && value) body.value = value;
    if (currentTabConfig.showOrder && order) body.order = parseInt(order, 10);
    createMutation.mutate(body);
  };

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    const body: any = { name: name.trim() };
    if (currentTabConfig.showValue) body.value = value || null;
    if (currentTabConfig.showOrder) body.order = order ? parseInt(order, 10) : null;
    updateMutation.mutate(body);
  };

  const getPhasesSumInfo = () => {
    if (activeTab !== 'phases') return null;
    const activePhases = items.filter(i => i.status === 'ACTIVE');
    const sum = activePhases.reduce((acc, curr) => acc + parseFloat(curr.value || '0'), 0);
    return { sum, isValid: Math.abs(sum - 100) < 0.001, activeCount: activePhases.length };
  };

  const sumInfo = getPhasesSumInfo();

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Catálogos do Sistema</h1>
          <p className="page-subtitle">Gerencie domínio de valores, sistemas, tipos de fluxo e fases globais</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-accent btn-sm" onClick={() => { resetForm(); setShowCreateModal(true); }}>
            <Plus size={14} /> Adicionar Item
          </button>
        </div>
      </div>

      {/* Navigation tabs */}
      <div className="tabs-container" style={{ overflowX: 'auto', whiteSpace: 'nowrap' }}>
        {tabs.map((tab) => (
          <button key={tab.key} onClick={() => { setActiveTab(tab.key); resetForm(); }} className={`tab-button ${activeTab === tab.key ? 'active' : ''}`}>
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sum tracker warning for Phases catalog */}
      {sumInfo && (
        <div className={`alert ${sumInfo.isValid ? 'alert-success' : 'alert-warning'}`} style={{ marginBottom: '1.25rem' }}>
          <AlertCircle size={18} style={{ flexShrink: 0 }} />
          <div>
            <strong>Somatório das Fases Ativas: {sumInfo.sum}%</strong> ({sumInfo.activeCount} fases ativas)
            {!sumInfo.isValid && <span className="text-xs" style={{ display: 'block', marginTop: '0.125rem' }}>A soma deve ser exatamente 100% para o motor de cronograma rodar sem falhas.</span>}
          </div>
        </div>
      )}

      {/* Table */}
      <div className="table-container">
        {isLoading ? (
          <div className="loading-center"><Loader2 className="spinner" size={20} /> Carregando catálogo...</div>
        ) : items.length === 0 ? (
          <div className="empty-state">Nenhum item neste catálogo</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Código (Slug)</th>
                <th>Nome Exibido</th>
                {currentTabConfig.showValue && <th>{currentTabConfig.valueLabel}</th>}
                {currentTabConfig.showOrder && <th>{currentTabConfig.orderLabel}</th>}
                <th>Status</th>
                <th style={{ textAlign: 'right' }}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td className="font-semibold text-xs" style={{ color: 'var(--primary)' }}>{item.code}</td>
                  <td className="font-medium">{item.name}</td>
                  {currentTabConfig.showValue && (
                    <td className="font-semibold">
                      {item.value}{activeTab === 'classes' && 'h'}{activeTab === 'phases' && '%'}
                    </td>
                  )}
                  {currentTabConfig.showOrder && <td>{item.order}</td>}
                  <td>
                    <span className={`badge ${item.status === 'ACTIVE' ? 'badge-active' : 'badge-inactive'}`}>
                      {item.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
                    </span>
                  </td>
                  <td>
                    <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                      <button className="btn-icon" title="Editar" onClick={() => {
                        setTargetItem(item); setCode(item.code); setName(item.name);
                        setValue(item.value || ''); setOrder(item.order ? String(item.order) : '');
                        setErrorMsg(null); setShowEditModal(true);
                      }}>
                        <Edit size={15} />
                      </button>
                      {item.status === 'ACTIVE' ? (
                        <button className="btn-icon" style={{ color: 'var(--danger)' }} title="Desativar" onClick={() => deactivateMutation.mutate(item.id)}>
                          <X size={15} />
                        </button>
                      ) : (
                        <button className="btn-icon" style={{ color: 'var(--success)' }} title="Ativar" onClick={() => activateMutation.mutate(item.id)}>
                          <Check size={15} />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Create Modal */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h3>Adicionar — {currentTabConfig.label}</h3>
              <button className="btn-icon" onClick={() => setShowCreateModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateSubmit}>
              <div className="modal-body">
                {errorMsg && <div className="alert alert-danger mb-4"><ShieldAlert size={16} /> <span>{errorMsg}</span></div>}
                <div className="form-group">
                  <label className="form-label">Código Identificador (Slug) *</label>
                  <input className="input" required placeholder="ex: azure_cloud" value={code} onChange={e => setCode(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Nome Exibido *</label>
                  <input className="input" required placeholder="ex: Azure Cloud" value={name} onChange={e => setName(e.target.value)} />
                </div>
                {currentTabConfig.showValue && (
                  <div className="form-group">
                    <label className="form-label">{currentTabConfig.valueLabel} *</label>
                    <input className="input" required value={value} onChange={e => setValue(e.target.value)} />
                  </div>
                )}
                {currentTabConfig.showOrder && (
                  <div className="form-group">
                    <label className="form-label">{currentTabConfig.orderLabel}</label>
                    <input type="number" className="input" value={order} onChange={e => setOrder(e.target.value)} />
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCreateModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={createMutation.isPending}>Adicionar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Modal */}
      {showEditModal && (
        <div className="modal-overlay" onClick={() => setShowEditModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h3>Editar Item do Catálogo</h3>
              <button className="btn-icon" onClick={() => setShowEditModal(false)}>✕</button>
            </div>
            <form onSubmit={handleEditSubmit}>
              <div className="modal-body">
                {errorMsg && <div className="alert alert-danger mb-4"><ShieldAlert size={16} /> <span>{errorMsg}</span></div>}
                <div className="form-group">
                  <label className="form-label">Código (Inalterável)</label>
                  <input className="input" disabled value={code} />
                </div>
                <div className="form-group">
                  <label className="form-label">Nome Exibido *</label>
                  <input className="input" required value={name} onChange={e => setName(e.target.value)} />
                </div>
                {currentTabConfig.showValue && (
                  <div className="form-group">
                    <label className="form-label">{currentTabConfig.valueLabel} *</label>
                    <input className="input" required value={value} onChange={e => setValue(e.target.value)} />
                  </div>
                )}
                {currentTabConfig.showOrder && (
                  <div className="form-group">
                    <label className="form-label">{currentTabConfig.orderLabel}</label>
                    <input type="number" className="input" value={order} onChange={e => setOrder(e.target.value)} />
                  </div>
                )}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowEditModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={updateMutation.isPending}>Salvar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
