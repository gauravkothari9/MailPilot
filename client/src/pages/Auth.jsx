import { useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { Field, Icon } from '../components/ui';

export default function Auth({ setup }) {
  const { refreshAuth } = useApp();
  const [form, setForm] = useState({ username: '', password: '', confirm: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (setup && form.password !== form.confirm) return setError('Passwords do not match');
    setBusy(true);
    try {
      await api.post(setup ? '/auth/setup' : '/auth/login', { username: form.username, password: form.password });
      await refreshAuth();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <form className="card" onSubmit={submit}>
        <div className="brand"><span className="brand-logo"><Icon name="mail" size={17} /></span>MailPilot</div>
        <h1 style={{ marginBottom: 6 }}>{setup ? 'Create your admin account' : 'Welcome back'}</h1>
        <p className="muted" style={{ marginTop: 0, marginBottom: 20 }}>
          {setup ? 'First-time setup. This account controls every business, sender and campaign.' : 'Log in to manage your email campaigns.'}
        </p>
        {error && <div className="alert error">{error}</div>}
        <Field label="Username"><input type="text" value={form.username} onChange={set('username')} autoFocus required autoComplete="username" /></Field>
        <Field label="Password" hint={setup ? 'At least 8 characters' : undefined}>
          <input type="password" value={form.password} onChange={set('password')} required minLength={setup ? 8 : undefined} autoComplete={setup ? 'new-password' : 'current-password'} />
        </Field>
        {setup && <Field label="Confirm password"><input type="password" value={form.confirm} onChange={set('confirm')} required autoComplete="new-password" /></Field>}
        <button className="btn btn-primary" style={{ width: '100%', marginTop: 6 }} disabled={busy}>{busy ? 'Please wait…' : setup ? 'Create account' : 'Log in'}</button>
      </form>
    </div>
  );
}
