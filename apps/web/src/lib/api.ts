export const API_URL = (process.env.NEXT_PUBLIC_API_URL || '/backend-api').replace(/\/$/, '');

const SESSION_EVENT = 'tic-session-ended';
const SESSION_SYNC_KEY = 'tic_session_ended_at';

export function clearClientSession(reason?: string) {
  if (typeof window === 'undefined') return;
  localStorage.removeItem('user');
  localStorage.setItem(SESSION_SYNC_KEY, String(Date.now()));
  if (reason) sessionStorage.setItem('loginMessage', reason);
  window.dispatchEvent(new CustomEvent(SESSION_EVENT));
}

export function redirectToLogin(message = 'Sua sessão expirou. Entre novamente') {
  if (typeof window === 'undefined') return;
  clearClientSession(message);
  if (window.location.pathname !== '/login') window.location.replace('/login');
}

export function subscribeToSessionEnd(callback: () => void) {
  if (typeof window === 'undefined') return () => undefined;
  const localHandler = () => callback();
  const storageHandler = (event: StorageEvent) => {
    if (event.key === SESSION_SYNC_KEY) callback();
  };
  window.addEventListener(SESSION_EVENT, localHandler);
  window.addEventListener('storage', storageHandler);
  return () => {
    window.removeEventListener(SESSION_EVENT, localHandler);
    window.removeEventListener('storage', storageHandler);
  };
}

export async function authenticatedFetch(path: string, options: RequestInit = {}, redirectOnUnauthorized = true) {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, { ...options, credentials: 'include', cache: 'no-store' });
  } catch (error: any) {
    if (error?.name === 'AbortError') throw error;
    throw {
      code: 'NETWORK_UNAVAILABLE',
      status: 0,
      message: typeof navigator !== 'undefined' && !navigator.onLine
        ? 'Você está sem conexão. Verifique sua rede e tente novamente.'
        : 'Não foi possível conectar ao servidor. Verifique sua conexão com a rede da empresa e tente novamente.',
    };
  }
  if (response.status === 401 && redirectOnUnauthorized) redirectToLogin();
  return response;
}

export async function apiRequest(path: string, options: RequestInit = {}) {
  const headers = options.body && !(options.body instanceof FormData)
    ? { 'Content-Type': 'application/json', ...options.headers }
    : { ...options.headers };
  const response = await authenticatedFetch(path, { ...options, headers }, path !== '/auth/login');
  if (response.status === 204) return null;
  const contentType = response.headers.get('content-type');
  const data: any = contentType?.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    if (data?.code === 'PASSWORD_CHANGE_REQUIRED' && typeof window !== 'undefined') {
      window.location.href = '/dashboard/profile?passwordRequired=1';
    }
    throw {
      code: data?.code || 'UNKNOWN_ERROR',
      message: data?.message || (response.status >= 500
        ? 'O serviço está temporariamente indisponível. Tente novamente em alguns instantes.'
        : 'Erro inesperado na comunicação com o servidor.'),
      details: data?.details || {},
      traceId: data?.traceId || '',
      status: response.status,
    };
  }
  return data;
}
