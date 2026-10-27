'use client';

import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/api';
import {
  UserPlus, UserX, UserCheck, KeyRound, ShieldAlert, Loader2, Pencil, Search, ChevronLeft, ChevronRight, Trash2
} from 'lucide-react';

interface Department { id: string; code: string; name: string; }
interface UserListItem {
  id: string; name: string; email: string;
  role: 'ADMIN' | 'PROJECT_MANAGER' | 'MANAGER' | 'DIRECTOR';
  status: 'ACTIVE' | 'INACTIVE'; forcePasswordChange: boolean;
  invalidAttempts: number; lastLoginAt: string | null;
  departments: { department: Department }[];
}

export default function UsersPage() {
  const queryClient = useQueryClient();
  const [currentUser] = useState<any>(() => {
    if (typeof window === 'undefined') return null;
    try { return JSON.parse(localStorage.getItem('user') || 'null'); } catch { return null; }
  });
  const isAdmin = currentUser?.role === 'ADMIN';

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showResetModal, setShowResetModal] = useState(false);
  const [showDeptsModal, setShowDeptsModal] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);

  // Form states
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState<'ADMIN' | 'PROJECT_MANAGER' | 'MANAGER' | 'DIRECTOR'>('MANAGER');
  const [newSelectedDepts, setNewSelectedDepts] = useState<string[]>([]);
  const [targetUser, setTargetUser] = useState<UserListItem | null>(null);
  const [resetPasswordVal, setResetPasswordVal] = useState('');
  const [deptsSelectedVal, setDeptsSelectedVal] = useState<string[]>([]);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<UserListItem['role']>('MANAGER');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Queries
  const { data: users = [], isLoading: loadingUsers } = useQuery<UserListItem[]>({
    queryKey: ['users'], queryFn: () => apiRequest('/users'),
  });
  const { data: departments = [], isLoading: loadingDepts } = useQuery<Department[]>({
    queryKey: ['departments'], queryFn: () => apiRequest('/departments'),
  });

  // Mutations
  const createUserMutation = useMutation({
    mutationFn: (body: any) => apiRequest('/users', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['users'] }); setShowCreateModal(false); resetCreateForm(); },
    onError: (err: any) => setErrorMsg(err.message),
  });

  const activateMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/users/${id}/activate`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });

  const deactivateMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/users/${id}/deactivate`, { method: 'POST' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: (err: any) => alert(err.message),
  });

  const resetPasswordMutation = useMutation({
    mutationFn: (body: any) => apiRequest('/auth/admin-reset-password', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: () => {
      setSuccessMsg('Senha redefinida com sucesso.');
      setTimeout(() => { setShowResetModal(false); setResetPasswordVal(''); setSuccessMsg(null); }, 1500);
    },
    onError: (err: any) => setErrorMsg(err.message),
  });

  const updateDeptsMutation = useMutation({
    mutationFn: (body: any) => apiRequest(`/users/${targetUser?.id}`, { method: 'PATCH', body: JSON.stringify(body) }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setSuccessMsg('Usuário atualizado.');
      setTimeout(() => { setShowDeptsModal(false); setSuccessMsg(null); }, 1500);
    },
    onError: (err: any) => setErrorMsg(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest(`/users/${id}`, { method: 'DELETE' }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
    onError: (err: any) => alert(err.message),
  });

  const resetCreateForm = () => {
    setNewName(''); setNewEmail(''); setNewRole('MANAGER'); setNewSelectedDepts([]); setErrorMsg(null);
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if ((newRole === 'MANAGER' || newRole === 'DIRECTOR') && newSelectedDepts.length === 0) {
      setErrorMsg('Gerentes e Diretores devem ter pelo menos um departamento no escopo.'); return;
    }
    createUserMutation.mutate({ name: newName, email: newEmail, role: newRole, departmentIds: newSelectedDepts });
  };

  const handleResetSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (resetPasswordVal.length < 6) { setErrorMsg('Mínimo 6 caracteres.'); return; }
    resetPasswordMutation.mutate({ userId: targetUser?.id, newPassword: resetPasswordVal });
  };

  const handleDeptsSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if ((editRole === 'MANAGER' || editRole === 'DIRECTOR') && deptsSelectedVal.length === 0) {
      setErrorMsg('Gerentes e Diretores devem possuir pelo menos um departamento.'); return;
    }
    updateDeptsMutation.mutate({ name: editName, email: editEmail, role: editRole, departmentIds: deptsSelectedVal });
  };

  const toggleDeptSelection = (deptId: string, isCreate: boolean) => {
    if (isCreate) {
      setNewSelectedDepts(prev => prev.includes(deptId) ? prev.filter(id => id !== deptId) : [...prev, deptId]);
    } else {
      setDeptsSelectedVal(prev => prev.includes(deptId) ? prev.filter(id => id !== deptId) : [...prev, deptId]);
    }
  };

  const roleLabels: Record<string, string> = {
    ADMIN: 'Administrador', PROJECT_MANAGER: 'Gerente de Projetos', MANAGER: 'Gerente', DIRECTOR: 'Diretor',
  };

  // Filtered & Paginated users
  const filteredUsers = useMemo(() => {
    return users.filter(u =>
      u.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      u.email.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [users, searchTerm]);

  const totalPages = Math.ceil(filteredUsers.length / pageSize);
  const paginatedUsers = filteredUsers.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Usuários do Sistema</h1>
          <p className="page-subtitle">Gerencie colaboradores, perfis de acesso e escopos de departamento</p>
        </div>
        <div className="page-actions">
          <button className="btn btn-accent btn-sm" onClick={() => { resetCreateForm(); setShowCreateModal(true); }}>
            <UserPlus size={14} /> Cadastrar Usuário
          </button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="filter-bar">
        <div className="input-group" style={{ flex: 1, maxWidth: '300px' }}>
          <span className="input-icon"><Search size={14} /></span>
          <input className="input" placeholder="Buscar por nome ou email..." value={searchTerm}
            onChange={e => { setSearchTerm(e.target.value); setCurrentPage(1); }} />
        </div>
      </div>

      {/* Table */}
      <div className="table-container">
        {loadingUsers || loadingDepts ? (
          <div className="loading-center"><Loader2 className="spinner" size={20} /> Carregando usuários...</div>
        ) : filteredUsers.length === 0 ? (
          <div className="empty-state">Nenhum usuário encontrado</div>
        ) : (
          <>
            <table className="table">
              <thead>
                <tr>
                  <th>Nome</th>
                  <th>E-mail</th>
                  <th>Perfil</th>
                  <th>Escopo de Departamentos</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {paginatedUsers.map(u => (
                  <tr key={u.id}>
                    <td>
                      <div className="font-semibold" style={{ color: 'var(--foreground)' }}>{u.name}</div>
                      {u.forcePasswordChange && <span className="text-xs font-medium" style={{ color: 'var(--accent)' }}>Troca de senha pendente</span>}
                    </td>
                    <td>{u.email}</td>
                    <td><span className="badge badge-info">{roleLabels[u.role]}</span></td>
                    <td>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem', maxWidth: '300px' }}>
                        {u.role === 'ADMIN' || u.role === 'PROJECT_MANAGER' ? (
                          <span className="text-xs text-muted" style={{ fontStyle: 'italic' }}>Global (Acesso Total)</span>
                        ) : u.departments.length === 0 ? (
                          <span className="text-xs font-semibold" style={{ color: 'var(--danger)' }}>Nenhum (Bloqueado)</span>
                        ) : (
                          u.departments.map(d => <span key={d.department.id} className="badge badge-navy" style={{ fontSize: '0.625rem' }}>{d.department.code}</span>)
                        )}
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${u.status === 'ACTIVE' ? 'badge-active' : 'badge-inactive'}`}>
                        {u.status === 'ACTIVE' ? 'Ativo' : 'Inativo'}
                      </span>
                    </td>
                    <td>
                      <div className="table-actions" style={{ justifyContent: 'flex-end' }}>
                        {isAdmin && <button className="btn-icon" title="Redefinir Senha" onClick={() => {
                          setTargetUser(u); setResetPasswordVal(''); setErrorMsg(null); setSuccessMsg(null); setShowResetModal(true);
                        }}>
                          <KeyRound size={15} />
                        </button>}
                        {(isAdmin || u.role !== 'ADMIN') && (
                          <button className="btn-icon" title="Editar usuário" onClick={() => {
                            setTargetUser(u); setEditName(u.name); setEditEmail(u.email); setEditRole(u.role);
                            setDeptsSelectedVal(u.departments.map(d => d.department.id)); setErrorMsg(null); setSuccessMsg(null); setShowDeptsModal(true);
                          }}>
                            <Pencil size={15} />
                          </button>
                        )}
                        {(isAdmin || u.role !== 'ADMIN') && (u.status === 'ACTIVE' ? (
                          <button className="btn-icon" style={{ color: 'var(--danger)' }} title="Desativar" onClick={() => deactivateMutation.mutate(u.id)}>
                            <UserX size={15} />
                          </button>
                        ) : (
                          <button className="btn-icon" style={{ color: 'var(--success)' }} title="Ativar" onClick={() => activateMutation.mutate(u.id)}>
                            <UserCheck size={15} />
                          </button>
                        ))}
                        {isAdmin && currentUser?.id !== u.id && (
                          <button className="btn-icon" style={{ color: 'var(--danger)' }} title="Excluir usuário" onClick={() => {
                            if (window.confirm(`Excluir o usuário ${u.name} (${u.email})? O acesso será removido e o histórico será preservado.`)) deleteMutation.mutate(u.id);
                          }}><Trash2 size={15} /></button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            {/* Pagination */}
            <div className="pagination-wrapper">
              <div className="pagination-info">
                Mostrando {Math.min((currentPage - 1) * pageSize + 1, filteredUsers.length)} a {Math.min(currentPage * pageSize, filteredUsers.length)} de {filteredUsers.length} usuários
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <div className="pagination-size">
                  <span>Itens por página:</span>
                  <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setCurrentPage(1); }}>
                    <option value={10}>10</option>
                    <option value={15}>15</option>
                    <option value={20}>20</option>
                    <option value={25}>25</option>
                  </select>
                </div>
                <div className="pagination-controls">
                  <button className="pagination-btn" disabled={currentPage <= 1} onClick={() => setCurrentPage(p => p - 1)}>
                    <ChevronLeft size={14} />
                  </button>
                  {Array.from({ length: Math.min(totalPages, 5) }, (_, i) => i + 1).map(pg => (
                    <button key={pg} className={`pagination-btn ${currentPage === pg ? 'active' : ''}`} onClick={() => setCurrentPage(pg)}>
                      {pg}
                    </button>
                  ))}
                  <button className="pagination-btn" disabled={currentPage >= totalPages} onClick={() => setCurrentPage(p => p + 1)}>
                    <ChevronRight size={14} />
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Modals: Create, Reset, Depts */}
      {showCreateModal && (
        <div className="modal-overlay" onClick={() => setShowCreateModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '480px' }}>
            <div className="modal-header">
              <h3>Novo Usuário</h3>
              <button className="btn-icon" onClick={() => setShowCreateModal(false)}>✕</button>
            </div>
            <form onSubmit={handleCreateSubmit}>
              <div className="modal-body">
                {errorMsg && <div className="alert alert-danger mb-4"><ShieldAlert size={16} /> <span>{errorMsg}</span></div>}
                <div className="form-group">
                  <label className="form-label">Nome Completo *</label>
                  <input className="input" required value={newName} onChange={e => setNewName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">E-mail *</label>
                  <input type="email" className="input" required value={newEmail} onChange={e => setNewEmail(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Perfil de Acesso *</label>
                  <select className="input" value={newRole} onChange={e => setNewRole(e.target.value as any)}>
                    {isAdmin && <option value="ADMIN">Administrador (Acesso Total)</option>}
                    <option value="PROJECT_MANAGER">Gerente de Projetos (Operacional)</option>
                    <option value="MANAGER">Gerente (Somente Leitura)</option>
                    <option value="DIRECTOR">Diretor (Somente Leitura)</option>
                  </select>
                </div>
                {(newRole === 'MANAGER' || newRole === 'DIRECTOR') && (
                  <div className="form-group">
                    <label className="form-label">Departamentos Permitidos *</label>
                    <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '0.5rem', maxHeight: '120px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                      {departments.map(d => (
                        <label key={d.id} className="checkbox-wrapper text-xs">
                          <input type="checkbox" checked={newSelectedDepts.includes(d.id)} onChange={() => toggleDeptSelection(d.id, true)} />
                          <span><strong>{d.code}</strong> — {d.name}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
                <div className="alert alert-info text-xs">Senha provisória inicial: <strong>Mudar@123</strong></div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCreateModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={createUserMutation.isPending}>Cadastrar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showResetModal && (
        <div className="modal-overlay" onClick={() => setShowResetModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '420px' }}>
            <div className="modal-header">
              <h3>Redefinir Senha</h3>
              <button className="btn-icon" onClick={() => setShowResetModal(false)}>✕</button>
            </div>
            <form onSubmit={handleResetSubmit}>
              <div className="modal-body">
                {errorMsg && <div className="alert alert-danger mb-4"><ShieldAlert size={16} /> <span>{errorMsg}</span></div>}
                {successMsg && <div className="alert alert-success mb-4">{successMsg}</div>}
                <div className="form-group">
                  <label className="form-label">Nova Senha Provisória</label>
                  <input type="password" className="input" required placeholder="Mínimo 6 caracteres" value={resetPasswordVal} onChange={e => setResetPasswordVal(e.target.value)} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowResetModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-accent btn-sm" disabled={resetPasswordMutation.isPending}>Confirmar</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {showDeptsModal && (
        <div className="modal-overlay" onClick={() => setShowDeptsModal(false)}>
          <div className="modal-content" onClick={e => e.stopPropagation()} style={{ maxWidth: '440px' }}>
            <div className="modal-header">
              <h3>Editar Usuário</h3>
              <button className="btn-icon" onClick={() => setShowDeptsModal(false)}>✕</button>
            </div>
            <form onSubmit={handleDeptsSubmit}>
              <div className="modal-body">
                {errorMsg && <div className="alert alert-danger mb-4"><ShieldAlert size={16} /> <span>{errorMsg}</span></div>}
                {successMsg && <div className="alert alert-success mb-4">{successMsg}</div>}
                <div className="form-group">
                  <label className="form-label">Nome Completo *</label>
                  <input className="input" required value={editName} onChange={e => setEditName(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">E-mail *</label>
                  <input type="email" className="input" required value={editEmail} onChange={e => setEditEmail(e.target.value)} />
                </div>
                <div className="form-group">
                  <label className="form-label">Perfil de Acesso *</label>
                  <select className="input" value={editRole} onChange={e => setEditRole(e.target.value as UserListItem['role'])}>
                    {isAdmin && <option value="ADMIN">Administrador (Acesso Total)</option>}
                    <option value="PROJECT_MANAGER">Gerente de Projetos (Operacional)</option>
                    <option value="MANAGER">Gerente (Somente Leitura)</option>
                    <option value="DIRECTOR">Diretor (Somente Leitura)</option>
                  </select>
                </div>
                {(editRole === 'MANAGER' || editRole === 'DIRECTOR') && <div className="form-group">
                  <label className="form-label">Departamentos Permitidos *</label>
                  <div style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '0.5rem', maxHeight: '180px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.375rem' }}>
                    {departments.map(d => (
                      <label key={d.id} className="checkbox-wrapper text-xs">
                        <input type="checkbox" checked={deptsSelectedVal.includes(d.id)} onChange={() => toggleDeptSelection(d.id, false)} />
                        <span><strong>{d.code}</strong> — {d.name}</span>
                      </label>
                    ))}
                  </div>
                </div>}
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowDeptsModal(false)}>Cancelar</button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={updateDeptsMutation.isPending}>Atualizar</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
