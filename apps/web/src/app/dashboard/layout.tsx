'use client';

import React, { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { apiRequest, clearClientSession, redirectToLogin, subscribeToSessionEnd } from '@/lib/api';
import {
  LayoutDashboard,
  Briefcase,
  ArrowUpDown,
  Users,
  BarChart3,
  CheckCircle,
  UserCheck,
  CalendarOff,
  Building2,
  SlidersHorizontal,
  Settings,
  LogOut,
  ChevronRight,
  Menu,
  X,
} from 'lucide-react';
import Link from 'next/link';

interface UserData {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'PROJECT_MANAGER' | 'MANAGER' | 'DIRECTOR';
  expiresAt?: string | null;
}

interface MenuItem {
  name: string;
  path: string;
  icon?: React.ReactNode;
}

interface MenuGroup {
  label: string;
  icon: React.ReactNode;
  items: MenuItem[];
  show: boolean;
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserData | null>(null);
  const [loading, setLoading] = useState(true);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [sessionRetry, setSessionRetry] = useState(0);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scheduleExpiry = (expiresAt?: string | null) => {
      if (timer) clearTimeout(timer);
      const delay = expiresAt ? new Date(expiresAt).getTime() - Date.now() : 0;
      if (expiresAt && delay <= 0) return redirectToLogin();
      if (delay > 0) timer = setTimeout(() => redirectToLogin(), delay);
    };
    const validateSession = async () => {
      try {
        const current = await apiRequest('/auth/me');
        if (disposed) return;
        localStorage.setItem('user', JSON.stringify(current));
        setUser(current);
        setSessionError(null);
        scheduleExpiry(current.expiresAt);
      } catch (error: any) {
        if (disposed) return;
        if (error?.status !== 401) setSessionError(error?.message || 'Não foi possível validar sua sessão. Tente novamente.');
        if (error?.status !== 401) setLoading(false);
        return;
      }
      setLoading(false);
    };
    if (!localStorage.getItem('user')) redirectToLogin();
    else validateSession();
    const visibilityHandler = () => { if (document.visibilityState === 'visible') validateSession(); };
    const unsubscribe = subscribeToSessionEnd(() => {
      disposed = true;
      setUser(null);
      if (window.location.pathname !== '/login') window.location.replace('/login');
    });
    document.addEventListener('visibilitychange', visibilityHandler);
    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      document.removeEventListener('visibilitychange', visibilityHandler);
    };
  }, [sessionRetry]);

  // Auto-expand the group that contains the active path
  useEffect(() => {
    if (!pathname) return;
    const groupMap: Record<string, string[]> = {
      'projetos': ['/dashboard/projects', '/dashboard/priority-queue', '/dashboard/committee'],
      'cronograma': ['/dashboard/schedule', '/dashboard/deliveries'],
      'recursos': ['/dashboard/resources', '/dashboard/calendar'],
      'admin': ['/dashboard/users', '/dashboard/departments', '/dashboard/catalogs', '/dashboard/parameters'],
    };
    const newOpen: Record<string, boolean> = {};
    for (const [key, paths] of Object.entries(groupMap)) {
      if (paths.some(p => pathname.startsWith(p))) {
        newOpen[key] = true;
      }
    }
    setOpenGroups(newOpen);
    setMobileMenuOpen(false);
  }, [pathname]);

  const handleLogout = async () => {
    try {
      await apiRequest('/auth/logout', { method: 'POST' });
    } catch { /* ignore */ }
    clearClientSession();
    router.push('/login');
  };

  const toggleGroup = (key: string) => {
    setOpenGroups(prev => (prev[key] ? {} : { [key]: true }));
  };

  if (loading) {
    return (
      <div className="loading-center" style={{ height: '100vh' }}>
        <svg className="spinner" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M21 12a9 9 0 1 1-6.219-8.56" />
        </svg>
        Carregando...
      </div>
    );
  }

  if (!user) return (
    <div className="loading-center" style={{ height: '100vh', flexDirection: 'column', gap: 16 }}>
      <p role="alert">{sessionError || 'Não foi possível validar sua sessão.'}</p>
      <button className="btn btn-primary" onClick={() => { setLoading(true); setSessionRetry(value => value + 1); }}>
        Tentar novamente
      </button>
    </div>
  );

  const isAdminOrPm = user.role === 'ADMIN' || user.role === 'PROJECT_MANAGER';

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

  const isActive = (path: string) => pathname === path || pathname.startsWith(path + '/');

  const menuGroups: (MenuGroup | MenuItem & { show: boolean })[] = [
    // Dashboard — direct link
    { name: 'Dashboard', path: '/dashboard', icon: <LayoutDashboard size={18} />, show: true },
    // Gestão de Projetos
    {
      label: 'Gestão de Projetos',
      icon: <Briefcase size={18} />,
      show: true,
      items: [
        { name: 'Projetos', path: '/dashboard/projects' },
        { name: 'Fila de Prioridades', path: '/dashboard/priority-queue' },
        { name: 'Comitê', path: '/dashboard/committee' },
      ],
    },
    // Cronograma e Entregas
    {
      label: 'Cronograma e Entregas',
      icon: <BarChart3 size={18} />,
      show: true,
      items: [
        { name: 'Cronograma Oficial', path: '/dashboard/schedule' },
        { name: 'Entregas', path: '/dashboard/deliveries' },
      ],
    },
    // Recursos e Capacidade
    {
      label: 'Recursos e Capacidade',
      icon: <UserCheck size={18} />,
      show: true,
      items: [
        { name: 'Recursos', path: '/dashboard/resources' },
        { name: 'Indisponibilidades', path: '/dashboard/calendar' },
      ],
    },
    // Administração
    {
      label: 'Administração',
      icon: <Settings size={18} />,
      show: true,
      items: [
        { name: 'Usuários', path: '/dashboard/users' },
        ...(isAdminOrPm ? [
          { name: 'Departamentos', path: '/dashboard/departments' },
          { name: 'Catálogos', path: '/dashboard/catalogs' },
          { name: 'Parâmetros', path: '/dashboard/parameters' },
        ] : []),
      ],
    },
  ];

  const groupKeys: Record<string, string> = {
    'Gestão de Projetos': 'projetos',
    'Cronograma e Entregas': 'cronograma',
    'Recursos e Capacidade': 'recursos',
    'Administração': 'admin',
  };

  return (
    <div className="dashboard-container">
      <header className="mobile-app-bar">
        <button
          type="button"
          className="mobile-menu-button"
          aria-label={mobileMenuOpen ? 'Fechar menu' : 'Abrir menu'}
          onClick={() => setMobileMenuOpen((open) => !open)}
        >
          {mobileMenuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
        <div className="mobile-brand">
          <span className="mobile-brand-mark">TIC</span>
          <span>Gestão de Projetos</span>
        </div>
        <Link href="/dashboard/profile" className="mobile-avatar" aria-label="Abrir meu perfil">
          {getInitials(user.name)}
        </Link>
      </header>

      {mobileMenuOpen && (
        <button
          type="button"
          className="sidebar-backdrop"
          aria-label="Fechar menu"
          onClick={() => setMobileMenuOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-logo">
          <div className="sidebar-logo-icon">TIC</div>
          <div className="sidebar-logo-text">
            Gestão de Projetos
            <small>Plataforma Interna</small>
          </div>
        </div>

        <nav className="sidebar-menu">
          {menuGroups.filter(g => g.show).map((item, idx) => {
            // Direct link (Dashboard)
            if ('path' in item) {
              const active = item.path === '/dashboard' ? pathname === '/dashboard' : isActive(item.path);
              return (
                <Link key={item.path} href={item.path}>
                  <div className={`menu-item-direct ${active ? 'active' : ''}`}>
                    {item.icon}
                    <span>{item.name}</span>
                  </div>
                </Link>
              );
            }

            // Group with submenu
            const group = item as MenuGroup;
            const groupKey = groupKeys[group.label] || group.label;
            const isOpen = openGroups[groupKey] || false;
            const hasActiveChild = group.items.some(i => isActive(i.path));

            return (
              <div className="menu-group" key={group.label}>
                <button
                  className={`menu-group-header ${isOpen ? 'open' : ''}`}
                  onClick={() => toggleGroup(groupKey)}
                  style={hasActiveChild && !isOpen ? { color: 'var(--sidebar-text-active)' } : undefined}
                >
                  <span className="menu-icon">
                    {group.icon}
                    <span>{group.label}</span>
                  </span>
                  <ChevronRight size={14} className="chevron" />
                </button>
                <div className={`menu-group-items ${isOpen ? 'open' : ''}`}>
                  {group.items.map(sub => {
                    const active = isActive(sub.path);
                    return (
                      <Link key={sub.path} href={sub.path}>
                        <div className={`menu-item ${active ? 'active' : ''}`}>
                          <span>{sub.name}</span>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="sidebar-user">
          <Link href="/dashboard/profile">
            <div className="sidebar-user-info">
              <div className="sidebar-avatar">{getInitials(user.name)}</div>
              <div>
                <div className="sidebar-user-name">{user.name}</div>
                <div className="sidebar-user-role">{roleLabels[user.role]}</div>
              </div>
            </div>
          </Link>
          <button onClick={handleLogout} className="sidebar-logout-btn">
            <LogOut size={14} />
            <span>Sair do Sistema</span>
          </button>
        </div>
      </aside>

      {/* Main Content — No header/navbar */}
      <main className="main-content">
        <div className="content-wrapper">
          <div className="content-surface">{children}</div>
        </div>
      </main>
    </div>
  );
}
