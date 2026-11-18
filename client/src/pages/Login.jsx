import { useState } from 'react';
import { api } from '../api.js';
import { LOGO } from '../ui.jsx';

export default function Login({ onLogin }) {
  const [f, setF] = useState({ emp_code: '', pin: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setErr('');
    try { const d = await api('/login', { method: 'POST', body: f }); onLogin(d.token, d.user); }
    catch (x) { setErr(x.message); } finally { setBusy(false); }
  };

  return (
    <div className="login">
      <div className="box">
        <div className="brand"><img src={LOGO} alt="MCCIA" /><p>Attendance Tracker</p></div>
        <form className="card stack" onSubmit={submit}>
          <div className="field"><label htmlFor="c">Employee code</label><input id="c" autoFocus autoCapitalize="characters" placeholder="e.g. INT1001" value={f.emp_code} onChange={(e) => setF({ ...f, emp_code: e.target.value })} /></div>
          <div className="field"><label htmlFor="p">PIN</label><input id="p" type="password" inputMode="numeric" placeholder="••••" value={f.pin} onChange={(e) => setF({ ...f, pin: e.target.value })} /></div>
          {err && <div className="err" role="alert">{err}</div>}
          <button className="btn primary" disabled={busy || !f.emp_code || !f.pin} style={{ padding: 12, fontSize: 15 }}>{busy ? 'Signing in…' : 'Sign in'}</button>
        </form>
        <p className="small muted center" style={{ margin: 0 }}>Use the code and PIN given by HR. Demo: HR001 / 1234 · INT1001 / 1111</p>
      </div>
    </div>
  );
}
