import { useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { Field, Icon, Loading } from '../components/ui';

export default function Settings() {
  const { toast } = useApp();
  const [s, setS] = useState(null);
  const [url, setUrl] = useState('');
  const [pw, setPw] = useState({ current: '', next: '' });
  const [check, setCheck] = useState(null);

  useEffect(() => { api.get('/settings').then((d) => { setS(d); setUrl(d.public_url); }); }, []);

  const saveUrl = async (e) => {
    e.preventDefault();
    try {
      await api.put('/settings', { public_url: url });
      toast('Tracking URL saved', 'success');
      setCheck(null);
    } catch (err) { toast(err.message, 'error'); }
  };
  const testUrl = async () => {
    setCheck('checking');
    try {
      const r = await fetch(`${url.replace(/\/+$/, '')}/u/preview`, { mode: 'no-cors' });
      setCheck(r.type === 'opaque' || r.ok ? 'ok' : 'fail');
    } catch { setCheck('fail'); }
  };
  const changePw = async (e) => {
    e.preventDefault();
    try {
      await api.post('/auth/password', pw);
      setPw({ current: '', next: '' });
      toast('Password changed', 'success');
    } catch (err) { toast(err.message, 'error'); }
  };

  if (!s) return <Loading />;
  const local = /localhost|127\.0\.0\.1/.test(url);
  return (
    <>
      <div className="page-head"><div><h1>Settings</h1></div></div>
      <div className="grid g2" style={{ alignItems: 'start' }}>
        <form className="card card-pad" onSubmit={saveUrl}>
          <h2>Tracking & unsubscribe address</h2>
          <p className="muted small">Open pixels, click redirects and unsubscribe links inside your emails point to this address, so recipients' email apps must be able to reach it over the internet.</p>
          <Field label="Public URL" hint="e.g. https://mail.yourbusiness.com, or your ngrok/Render/Railway URL">
            <input type="url" value={url} onChange={(e) => setUrl(e.target.value)} required />
          </Field>
          {local && <div className="alert warn small"><Icon name="alert" size={16} /><div>“localhost” only works on this computer. Opens and clicks from real recipients will not be tracked until you use a public address.</div></div>}
          {check === 'ok' && <div className="alert success small">Reachable from this browser ✓</div>}
          {check === 'fail' && <div className="alert error small">Could not reach that address from this browser.</div>}
          <div className="row">
            <button className="btn btn-primary">Save</button>
            <button type="button" className="btn" onClick={testUrl} disabled={check === 'checking'}>Test address</button>
          </div>
          <h3 className="section-title">How tracking works</h3>
          <ul className="small muted how">
            <li><b>Delivered</b>: your SMTP server accepted the email.</li>
            <li><b>Opens</b>: a tiny invisible image loads when the email is viewed with images on. Apple Mail Privacy Protection can pre-load it, and some people block images, so treat open rates as an estimate.</li>
            <li><b>Clicks</b>: links are routed through your server, logged, then redirected instantly. Clicks also count as opens.</li>
            <li><b>Bots</b>: corporate security scanners that open or click within seconds of delivery are recorded but excluded from your stats.</li>
            <li><b>Unsubscribes</b>: every email carries a one-click unsubscribe link and header (required by Gmail/Yahoo); those contacts are skipped automatically from then on.</li>
            <li><b>Failures & bounces</b>: rejected recipients are marked failed; hard bounces (5xx) are excluded from future campaigns.</li>
          </ul>
        </form>

        <form className="card card-pad" onSubmit={changePw}>
          <h2>Change password</h2>
          <Field label="Current password"><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required autoComplete="current-password" /></Field>
          <Field label="New password" hint="At least 8 characters"><input type="password" minLength={8} value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} required autoComplete="new-password" /></Field>
          <button className="btn btn-primary">Update password</button>
        </form>
      </div>
    </>
  );
}
