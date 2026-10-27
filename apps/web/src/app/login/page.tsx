'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { apiRequest } from '@/lib/api';
import { Lock, Mail, Eye, EyeOff, ShieldAlert, ArrowLeft, BarChart3, CalendarRange, UsersRound, ShieldCheck } from 'lucide-react';

export default function LoginPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  
  // Mandatory password change flow
  const [mustChangePassword, setMustChangePassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const message = sessionStorage.getItem('loginMessage');
    if (message) {
      setError(message);
      sessionStorage.removeItem('loginMessage');
    }
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const data = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password: password.trim() }),
      });

      if (data.forcePasswordChange) {
        setMustChangePassword(true);
        setCurrentPassword(password.trim());
        setLoading(false);
      } else {
        localStorage.setItem('user', JSON.stringify(data));
        router.push('/dashboard');
      }
    } catch (err: any) {
      setError(err.message || 'Erro ao realizar login.');
      setLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (newPassword.trim() !== confirmPassword.trim()) {
      setError('A nova senha e a confirmação de senha não coincidem.');
      return;
    }

    if (newPassword.trim().length < 6) {
      setError('A nova senha deve ter no mínimo 6 caracteres.');
      return;
    }

    setLoading(true);
    try {
      await apiRequest('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ currentPassword: currentPassword.trim(), newPassword: newPassword.trim() }),
      });

      const loginData = await apiRequest('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: email.trim(), password: newPassword.trim() }),
      });

      localStorage.setItem('user', JSON.stringify(loginData));
      router.push('/dashboard');
    } catch (err: any) {
      setError(err.message || 'Erro ao atualizar a senha.');
      setLoading(false);
    }
  };

  return (
    <div className="login-wrapper">
      <div className="login-shell">
        <section className="login-brand-panel">
          <div className="login-brand-top">
            <div className="login-brand-mark">TIC</div>
            <div>
              <strong>Gestão de Projetos</strong>
              <span>Planejamento e capacidade</span>
            </div>
          </div>

          <div className="login-brand-copy">
            <span className="login-eyebrow"><ShieldCheck size={14} /> Governança inteligente</span>
            <h2>Decisões mais claras para um portfólio mais previsível.</h2>
            <p>Priorize demandas, simule a capacidade da equipe e acompanhe cada entrega em um único ambiente.</p>
          </div>

          <div className="login-feature-grid">
            <div className="login-feature">
              <BarChart3 size={20} />
              <span><strong>Visão executiva</strong><small>Indicadores do portfólio</small></span>
            </div>
            <div className="login-feature">
              <CalendarRange size={20} />
              <span><strong>Cenários confiáveis</strong><small>Previsão por capacidade</small></span>
            </div>
            <div className="login-feature">
              <UsersRound size={20} />
              <span><strong>Recursos conectados</strong><small>Alocação por fase</small></span>
            </div>
          </div>

          <p className="login-brand-footer">Ambiente interno • Acesso seguro e rastreável</p>
        </section>

        <section className="login-form-panel">
          <div className="login-card">
            <div className="login-logo">
              <div className="login-logo-icon">TIC</div>
              <span className="login-welcome">Bem-vindo de volta</span>
              <h1 className="login-title">
                {mustChangePassword ? 'Crie sua nova senha' : 'Acesse sua conta'}
              </h1>
              <p className="login-subtitle">
                {mustChangePassword
                  ? 'Para proteger sua conta, defina uma senha pessoal antes de continuar.'
                  : 'Use suas credenciais corporativas para continuar.'}
              </p>
            </div>

            {error && (
              <div className="alert alert-danger login-alert">
                <ShieldAlert size={16} style={{ flexShrink: 0, marginTop: '1px' }} />
                <span>{error}</span>
              </div>
            )}

            {!mustChangePassword ? (
              <form onSubmit={handleLogin}>
                <div className="form-group">
                  <label className="form-label" htmlFor="email">E-mail corporativo</label>
                  <div className="input-group">
                    <span className="input-icon"><Mail size={17} /></span>
                    <input
                      id="email"
                      type="email"
                      className="input"
                      placeholder="nome@empresa.com"
                      autoComplete="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                </div>

                <div className="form-group login-password-group">
                  <label className="form-label" htmlFor="password">Senha</label>
                  <div className="login-password-field">
                    <div className="input-group">
                      <span className="input-icon"><Lock size={17} /></span>
                      <input
                        id="password"
                        type={showPassword ? 'text' : 'password'}
                        className="input"
                        placeholder="••••••••"
                        autoComplete="current-password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="login-password-toggle"
                      aria-label={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                    >
                      {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                    </button>
                  </div>
                </div>

                <button type="submit" className="login-btn" disabled={loading}>
                  {loading ? <><span className="login-button-spinner" /> Entrando...</> : 'Entrar no sistema'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleChangePassword}>
                <div className="alert alert-warning login-alert">
                  <strong>Primeiro acesso:</strong> altere sua senha provisória para continuar.
                </div>

                <div className="form-group">
                  <label className="form-label" htmlFor="newPassword">Nova senha</label>
                  <input id="newPassword" type="password" className="input" placeholder="Mínimo de 6 caracteres" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required />
                </div>

                <div className="form-group login-password-group">
                  <label className="form-label" htmlFor="confirmPassword">Confirmar nova senha</label>
                  <input id="confirmPassword" type="password" className="input" placeholder="Repita a nova senha" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} required />
                </div>

                <div className="login-actions">
                  <button type="button" className="btn btn-secondary" onClick={() => setMustChangePassword(false)}>
                    <ArrowLeft size={15} /> Voltar
                  </button>
                  <button type="submit" className="login-btn" disabled={loading}>
                    {loading ? 'Alterando...' : 'Confirmar senha'}
                  </button>
                </div>
              </form>
            )}

            <p className="login-help">Problemas para acessar? Entre em contato com o administrador do sistema.</p>
          </div>
        </section>
      </div>
    </div>
  );
}
