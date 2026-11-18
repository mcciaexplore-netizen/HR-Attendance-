import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from './api.js';

/**
 * Polls notifications every 30 s. New ones raise an in-app toast and — when the person has
 * allowed it — a device notification. (Works while the app/tab is open or installed as a PWA.
 * True background push when the app is closed needs Web Push; see README → "Next steps".)
 */
export function useNotifications(user, toast) {
  const [data, setData] = useState({ items: [], unread: 0 });
  const seen = useRef(Number(localStorage.getItem('mccia_att_seen') || 0));
  const first = useRef(true);

  const load = useCallback(async () => {
    try {
      const d = await api('/notifications');
      setData(d);
      const fresh = d.items.filter((n) => n.id > seen.current && !n.read).reverse();
      if (d.items.length) {
        seen.current = Math.max(seen.current, d.items[0].id);
        localStorage.setItem('mccia_att_seen', String(seen.current));
      }
      if (!first.current || fresh.length) {
        for (const n of fresh.slice(-3)) {
          toast({ title: n.title, body: n.body, ms: 9000 });
          if ('Notification' in window && Notification.permission === 'granted') {
            try { new Notification(n.title, { body: n.body || '', icon: `${import.meta.env.BASE_URL}logo.png`, tag: 'mccia-' + n.id }); } catch {}
          }
        }
      }
      first.current = false;
    } catch {}
  }, [toast]);

  useEffect(() => {
    if (!user) return;
    load();
    const h = setInterval(load, 30_000);
    const v = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', v);
    return () => { clearInterval(h); document.removeEventListener('visibilitychange', v); };
  }, [user, load]);

  const markRead = async () => { await api('/notifications/read', { method: 'POST' }); load(); };
  const enable = async () => { if ('Notification' in window) await Notification.requestPermission(); load(); };
  return { ...data, markRead, enable, reload: load };
}
