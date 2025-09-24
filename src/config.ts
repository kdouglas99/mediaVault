// Compute API base at runtime to avoid localhost being baked into production builds
function computeApiBase(): string {
  try {
    const envBase = (import.meta as any)?.env?.VITE_API_URL as string | undefined;
    if (envBase && !/^(https?:\/\/)?(localhost|127\.0\.0\.1)/i.test(envBase)) {
      return envBase.replace(/\/$/, '');
    }
  } catch {}
  
  // In production, use the same host as the frontend
  const { protocol, hostname, port } = window.location;
  
  // If we're running on a non-standard port (like Vite dev server), use backend port
  if (port === '5173' || port === '3000') {
    const backendPort = (window as any).__BACKEND_PORT__ || 3001;
    return `${protocol}//${hostname}:${backendPort}`.replace(/\/$/, '');
  }
  
  // In production, assume backend is on same host/port
  return `${protocol}//${hostname}${port ? `:${port}` : ''}`.replace(/\/$/, '');
}

const API_URL = computeApiBase();