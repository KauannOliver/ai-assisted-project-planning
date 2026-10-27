'use client';

import React, { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/api';
import { User, Mail, Shield, Key, Save, Eye, EyeOff, CheckCircle } from 'lucide-react';

export default function ProfilePage() {
  const router = useRouter();
  const [user, setUser] = useState<any>(null);
  const [profileName, setProfileName] = useState('');
  const [profileEmail, setProfileEmail] = useState('');
  const [profileMessage, setProfileMessage] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);

  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [pwdError, setPwdError] = useState<string | null>(null);
  const [pwdSuccess, setPwdSuccess] = useState<string | null>(null);
  const [pwdLoading, setPwdLoading] = useState(false);

  useEffect(() => {
    const userStr = localStorage.getItem('user');
    if (userStr) {
      const savedUser = JSON.parse(userStr);
      setUser(savedUser);
      setProfileName(savedUser.name || '');
      setProfileEmail(savedUser.email || '');
    } else {
      router.push('/login');
    }
  }, [router]);

  const roleLabels: Record<string, string> = {
    ADMIN: 'Administrador',
    PROJECT_MANAGER: 'Gerente de Projetos',
    MANAGER: 'Gerente (L.U.)',
    DIRECTOR: 'Diretor (L.U.)',
  };

  const getInitials = (name: string) => {
    const parts = name.split(' ').filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return name.substring(0, 2).toUpperCase();
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwdError(null);
    setPwdSuccess(null);

    if (newPassword.trim() !== confirmPassword.trim()) {
      setPwdError('A nova senha e a confirmação não coincidem.');
      return;
    }

    if (newPassword.trim().length < 6) {
      setPwdError('A nova senha deve ter no mínimo 6 caracteres.');
      return;
    }

    setPwdLoading(true);
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({
          currentPassword: currentPassword.trim(),
          newPassword: newPassword.trim(),
        }),
      });
      setPwdSuccess('Senha alterada com sucesso!');
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setTimeout(() => setPwdSuccess(null), 4000);
    } catch (err: any) {
      setPwdError(err.message || 'Erro ao alterar a senha.');
    } finally {
      setPwdLoading(false);
    }
  };

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileLoading(true);
    setProfileMessage(null);
    try {
      const updated = await apiRequest('/auth/profile', { method: 'PATCH', body: JSON.stringify({ name: profileName, email: profileEmail }) });
      localStorage.setItem('user', JSON.stringify(updated));
      setUser(updated);
      setProfileMessage('Perfil atualizado com sucesso.');
    } catch (err: any) {
      setProfileMessage(err.message || 'Não foi possível atualizar o perfil.');
    } finally {
      setProfileLoading(false);
    }
  };

  if (!user) return null;

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Meu Perfil</h1>
          <p className="page-subtitle">Gerencie suas informações de conta</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem', maxWidth: '900px' }}>
        {/* Profile Info Card */}
        <div className="card">
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '1rem 0 1.5rem' }}>
            <div className="profile-avatar-lg" style={{ marginBottom: '1rem' }}>
              {getInitials(user.name)}
            </div>
            <h2 style={{ fontSize: '1.125rem', fontWeight: '600', color: 'var(--foreground)', marginBottom: '0.25rem' }}>
              {user.name}
            </h2>
            <span className="badge badge-info" style={{ fontSize: '0.75rem', padding: '0.25rem 0.75rem' }}>
              <Shield size={12} />
              {roleLabels[user.role]}
            </span>
          </div>

          <div style={{ borderTop: '1px solid var(--border)', paddingTop: '1rem' }}>
            <div className="detail-row">
              <span className="detail-label"><Mail size={13} style={{ marginRight: '0.375rem', verticalAlign: '-2px' }} />E-mail</span>
              <span className="detail-value">{user.email}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label"><User size={13} style={{ marginRight: '0.375rem', verticalAlign: '-2px' }} />Nome</span>
              <span className="detail-value">{user.name}</span>
            </div>
            <div className="detail-row">
              <span className="detail-label"><Shield size={13} style={{ marginRight: '0.375rem', verticalAlign: '-2px' }} />Perfil</span>
              <span className="detail-value">{roleLabels[user.role]}</span>
            </div>
          </div>
          <form onSubmit={handleProfileUpdate} style={{ borderTop: '1px solid var(--border)', marginTop: '1rem', paddingTop: '1rem' }}>
            <div className="form-group">
              <label className="form-label">Nome de exibição</label>
              <input className="input" value={profileName} onChange={e => setProfileName(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">E-mail</label>
              <input className="input" type="email" value={profileEmail} onChange={e => setProfileEmail(e.target.value)} required />
            </div>
            {profileMessage && <div className="alert alert-info" style={{ marginBottom: '0.75rem' }}>{profileMessage}</div>}
            <button className="btn btn-primary w-full" type="submit" disabled={profileLoading}>
              <Save size={14} /> {profileLoading ? 'Salvando...' : 'Salvar perfil'}
            </button>
          </form>
        </div>

        {/* Change Password Card */}
        <div className="card">
          <div className="card-header">
            <h3 className="card-title" style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <Key size={16} />
              Alterar Senha
            </h3>
          </div>

          {pwdError && (
            <div className="alert alert-danger" style={{ marginBottom: '1rem' }}>
              <span>{pwdError}</span>
            </div>
          )}

          {pwdSuccess && (
            <div className="alert alert-success" style={{ marginBottom: '1rem' }}>
              <CheckCircle size={16} style={{ flexShrink: 0 }} />
              <span>{pwdSuccess}</span>
            </div>
          )}

          <form onSubmit={handlePasswordChange}>
            <div className="form-group">
              <label className="form-label">Senha Atual</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showCurrent ? 'text' : 'password'}
                  className="input"
                  autoComplete="current-password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  style={{ paddingRight: '2.25rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowCurrent(!showCurrent)}
                  style={{
                    position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                    border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px',
                  }}
                >
                  {showCurrent ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Nova Senha</label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showNew ? 'text' : 'password'}
                  className="input"
                  placeholder="Mínimo 6 caracteres"
                  autoComplete="new-password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  style={{ paddingRight: '2.25rem' }}
                />
                <button
                  type="button"
                  onClick={() => setShowNew(!showNew)}
                  style={{
                    position: 'absolute', right: '8px', top: '50%', transform: 'translateY(-50%)',
                    border: 'none', background: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: '4px',
                  }}
                >
                  {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </div>
            </div>

            <div className="form-group">
              <label className="form-label">Confirmar Nova Senha</label>
              <input
                type="password"
                className="input"
                autoComplete="new-password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
              />
            </div>

            <button
              type="submit"
              className="btn btn-primary w-full"
              disabled={pwdLoading}
              style={{ marginTop: '0.5rem' }}
            >
              <Save size={14} />
              {pwdLoading ? 'Salvando...' : 'Alterar Senha'}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
