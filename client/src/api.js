// API base is configurable so the module can live inside the MCCIA app hub.
export const API_BASE = window.MCCIA_ATT_API || import.meta.env.VITE_API_BASE || '/api/attendance';
const KEY = 'mccia_att_token';

export const getToken = () => { try { return localStorage.getItem(KEY); } catch { return null; } };
export const setToken = (t) => { try { t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY); } catch {} };

export async function api(path, { method = 'GET', body, headers = {}, raw } = {}) {
  const token = getToken();
  const res = await fetch(API_BASE + path, {
    method,
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { authorization: 'Bearer ' + token } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (raw) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && token && !headers['x-kiosk-token']) window.dispatchEvent(new Event('att-logout'));
    throw Object.assign(new Error(data.error || 'Request failed'), { status: res.status, data });
  }
  return data;
}
