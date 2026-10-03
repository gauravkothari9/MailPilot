import { useCallback, useEffect, useState } from 'react';
import { api } from '../api';
import { useApp } from '../context';
import { Field, Modal, Icon, Loading, Badge, Empty, Progress, fmtNum, useConfirm, Spinner } from '../components/ui';

const PRESETS = {
  gmail: { name: 'Gmail / Google Workspace', host: 'smtp.gmail.com', port: 465, secure: true, limit: 500,
    hint: 'Turn on 2-Step Verification, then create an App Password at myaccount.google.com/apppasswords and paste it as the password. Your normal Gmail password will not work. Gmail allows ~500/day (2,000 on Workspace).' },
  outlook: { name: 'Outlook.com / Hotmail', host: 'smtp-mail.outlook.com', port: 587, secure: false, limit: 300, hint: 'Use your Outlook email and password (or an app password if 2FA is on).' },
  m365: { name: 'Microsoft 365', host: 'smtp.office365.com', port: 587, secure: false, limit: 10000, hint: 'SMTP AUTH must be enabled for the mailbox in the Microsoft 365 admin center.' },
  zoho: { name: 'Zoho Mail', host: 'smtp.zoho.com', port: 465, secure: true, limit: 500, hint: 'If your account is in India use smtp.zoho.in, in Europe smtp.zoho.eu. Use an app-specific password if 2FA is on.' },
  hostinger: { name: 'Hostinger', host: 'smtp.hostinger.com', port: 465, secure: true, limit: 1000, hint: 'Use your full mailbox address and its password.' },
  godaddy: { name: 'GoDaddy', host: 'smtpout.secureserver.net', port: 465, secure: true, limit: 250, hint: 'Use your full GoDaddy email address and password.' },
  yahoo: { name: 'Yahoo Mail', host: 'smtp.mail.yahoo.com', port: 465, secure: true, limit: 500, hint: 'Generate an app password in Yahoo account security settings.' },
  sendgrid: { name: 'SendGrid', host: 'smtp.sendgrid.net', port: 587, secure: false, limit: 100000, user: 'apikey', hint: 'Username is literally "apikey"; the password is your SendGrid API key. Verify your sender/domain in SendGrid first.' },
  brevo: { name: 'Brevo (Sendinblue)', host: 'smtp-relay.brevo.com', port: 587, secure: false, limit: 300, hint: 'Use the SMTP login and key from Brevo → SMTP & API.' },
  mailgun: { name: 'Mailgun', host: 'smtp.mailgun.org', port: 587, secure: false, limit: 10000, hint: 'Use the SMTP credentials from your Mailgun domain settings.' },
  ses: { name: 'Amazon SES', host: 'email-smtp.us-east-1.amazonaws.com', port: 587, secure: false, limit: 50000, hint: 'Replace the region in the host with your SES region. Use SES SMTP credentials (not IAM keys).' },
  custom: { name: 'Other / custom SMTP', host: '', port: 587, secure: false, limit: 500, hint: 'Your email host lists these under "SMTP settings". Port 465 uses SSL; 587 uses STARTTLS.' },
};

function SenderModal({ initial, onClose, onSaved }) {
  const { businessId, toast } = useApp();
  const isEdit = !!initial?._id;
  const [preset, setPreset] = useState(isEdit ? 'custom' : 'gmail');
  const [f, setF] = useState(() => initial?._id ? { ...initial, smtpPass: '' } : {
    label: '', fromName: '', fromEmail: '', replyTo: '', smtpHost: PRESETS.gmail.host, smtpPort: 465, smtpSecure: true, smtpUser: '', smtpPass: '', ratePerMinute: 20, dailyLimit: 500,
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const pickPreset = (key) => {
    setPreset(key);
    const p = PRESETS[key];
    setF((x) => ({ ...x, smtpHost: p.host, smtpPort: p.port, smtpSecure: p.secure, dailyLimit: p.limit, smtpUser: p.user || x.smtpUser }));
  };

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = { ...f, smtpUser: f.smtpUser || f.fromEmail };
      const r = isEdit ? await api.put(`/senders/${initial._id}`, body) : await api.post(`/businesses/${businessId}/senders`, body);
      if (r.verify?.ok) {
        toast('Sender connected and verified ✓', 'success');
        onSaved();
      } else {
        setError(`Saved, but the SMTP login failed: ${r.verify?.error}. Check the details and save again.`);
        onSaved(true);
      }
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };

  return (
    <Modal title={isEdit ? 'Edit sender email' : 'Connect a sender email'} onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Close</button><button className="btn btn-primary" form="sender-form" disabled={busy}>{busy ? <><Spinner /> Connecting…</> : 'Save & test connection'}</button></>}>
      <form id="sender-form" onSubmit={submit}>
        {error && <div className="alert error">{error}</div>}
        <Field label="Email provider">
          <select value={preset} onChange={(e) => pickPreset(e.target.value)}>
            {Object.entries(PRESETS).map(([k, p]) => <option key={k} value={k}>{p.name}</option>)}
          </select>
        </Field>
        <div className="alert info"><Icon name="alert" size={16} /><div>{PRESETS[preset].hint}</div></div>
        <div className="form-row">
          <Field label="From name" hint="What recipients see, e.g. “Acme Bakery”"><input type="text" value={f.fromName} onChange={set('fromName')} required /></Field>
          <Field label="From email"><input type="email" value={f.fromEmail} onChange={set('fromEmail')} required /></Field>
        </div>
        <div className="form-row">
          <Field label="Reply-to (optional)"><input type="email" value={f.replyTo} onChange={set('replyTo')} /></Field>
          <Field label="Label (optional)" hint="Internal name, e.g. “Promotions”"><input type="text" value={f.label} onChange={set('label')} /></Field>
        </div>
        <h3 className="section-title">SMTP connection</h3>
        <div className="form-row">
          <Field label="SMTP host"><input type="text" value={f.smtpHost} onChange={set('smtpHost')} required /></Field>
          <div className="form-row">
            <Field label="Port"><input type="number" value={f.smtpPort} onChange={set('smtpPort')} required /></Field>
            <label className="check" style={{ marginTop: 22 }}><input type="checkbox" checked={!!f.smtpSecure} onChange={set('smtpSecure')} />SSL (465)</label>
          </div>
        </div>
        <div className="form-row">
          <Field label="Username" hint="Usually your full email address"><input type="text" value={f.smtpUser} onChange={set('smtpUser')} placeholder={f.fromEmail} /></Field>
          <Field label="Password / app password" hint={isEdit ? 'Leave blank to keep the saved password' : 'Stored encrypted (AES-256)'}>
            <input type="password" value={f.smtpPass} onChange={set('smtpPass')} required={!isEdit} autoComplete="new-password" />
          </Field>
        </div>
        <h3 className="section-title">Sending limits</h3>
        <div className="form-row">
          <Field label="Emails per minute" hint="Slower sending looks more natural and protects your reputation"><input type="number" min="1" value={f.ratePerMinute} onChange={set('ratePerMinute')} /></Field>
          <Field label="Daily limit" hint="Sending pauses at this number and resumes the next day"><input type="number" min="1" value={f.dailyLimit} onChange={set('dailyLimit')} /></Field>
        </div>
      </form>
    </Modal>
  );
}

const STATUS_COLOR = { pass: 'green', warn: 'amber', fail: 'red' };

function DeliverabilityModal({ sender, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api.get(`/senders/${sender._id}/deliverability`).then(setData).catch((e) => setError(e.message)); }, [sender._id]);
  return (
    <Modal title={`Deliverability check: ${sender.fromEmail}`} onClose={onClose} wide>
      {error && <div className="alert error">{error}</div>}
      {!data && !error && <Loading />}
      {data && (
        <>
          <div className="deliv-score">
            <div className={`score-ring ${data.score >= 80 ? 'good' : data.score >= 50 ? 'ok' : 'bad'}`}>{data.score}</div>
            <div>
              <h3>{data.score >= 80 ? 'Looking good' : data.score >= 50 ? 'Some fixes recommended' : 'High risk of landing in spam'}</h3>
              <p className="muted small" style={{ margin: 0 }}>DNS checks for <b>{data.domain}</b>. Gmail and Yahoo require SPF, DKIM and DMARC for bulk senders.</p>
            </div>
          </div>
          <div className="check-list">
            {data.checks.map((c) => (
              <div key={c.id} className="check-item">
                <Badge color={STATUS_COLOR[c.status]}>{c.status === 'pass' ? '✓ Pass' : c.status === 'warn' ? '! Warning' : '✕ Missing'}</Badge>
                <div style={{ minWidth: 0 }}>
                  <b>{c.label}</b>
                  <div className="small muted mono break">{c.detail}</div>
                  {c.fix && <div className="small fix">{c.fix}</div>}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

export default function Senders() {
  const { businessId, business, toast } = useApp();
  const [senders, setSenders] = useState(null);
  const [editing, setEditing] = useState(null);
  const [deliv, setDeliv] = useState(null);
  const [testing, setTesting] = useState(null);
  const [testTo, setTestTo] = useState('');
  const [busy, setBusy] = useState('');
  const [confirm, dialog] = useConfirm();

  const load = useCallback(() => api.get(`/businesses/${businessId}/senders`).then(setSenders).catch((e) => toast(e.message, 'error')), [businessId, toast]);
  useEffect(() => { load(); }, [load]);

  const verify = async (s) => {
    setBusy(s._id);
    const r = await api.post(`/senders/${s._id}/verify`).catch((e) => ({ ok: false, error: e.message }));
    setBusy('');
    toast(r.ok ? 'Connection OK ✓' : `Connection failed: ${r.error}`, r.ok ? 'success' : 'error');
    load();
  };
  const sendTest = async (e) => {
    e.preventDefault();
    setBusy('test');
    try {
      await api.post(`/senders/${testing._id}/test`, { to: testTo });
      toast(`Test email sent to ${testTo}`, 'success');
      setTesting(null);
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(''); }
  };
  const remove = async (s) => {
    if (!(await confirm({ title: 'Remove sender?', danger: true, confirmLabel: 'Remove', message: `Campaigns using ${s.fromEmail} will pause until you pick another sender.` }))) return;
    await api.del(`/senders/${s._id}`);
    load();
  };

  if (!senders) return <Loading />;
  return (
    <>
      <div className="page-head">
        <div><h1>Sender emails</h1><p>Email accounts {business?.name} sends from. Connect as many as you like; each has its own speed and daily limit.</p></div>
        <button className="btn btn-primary" onClick={() => setEditing({})}><Icon name="plus" />Connect email</button>
      </div>

      {senders.length ? (
        <div className="grid g2">
          {senders.map((s) => (
            <div key={s._id} className="card sender-card">
              <div className="top">
                <span className="avatar" style={{ background: s.verified ? 'var(--green)' : 'var(--faint)' }}><Icon name="mail" size={18} /></span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <h3 className="truncate">{s.fromName}</h3>
                    {s.verified ? <Badge color="green">Connected</Badge> : <Badge color="red">Not connected</Badge>}
                    {s.label && <Badge>{s.label}</Badge>}
                  </div>
                  <div className="muted truncate">{s.fromEmail}</div>
                </div>
              </div>
              {s.lastError && <div className="alert error small" style={{ margin: 0 }}>{s.lastError}</div>}
              <dl className="kv">
                <dt>SMTP</dt><dd className="mono small">{s.smtpHost}:{s.smtpPort}{s.smtpSecure ? ' (SSL)' : ''}</dd>
                <dt>Speed</dt><dd>{s.ratePerMinute} emails / minute</dd>
                <dt>Today</dt><dd>
                  <div className="row" style={{ gap: 8 }}><span>{fmtNum(s.sentToday)} / {fmtNum(s.dailyLimit)}</span></div>
                  <Progress value={(100 * s.sentToday) / s.dailyLimit} color={s.sentToday >= s.dailyLimit ? 'var(--amber)' : undefined} />
                </dd>
              </dl>
              <div className="row">
                <button className="btn btn-sm" onClick={() => { setTesting(s); setTestTo(''); }}><Icon name="send" />Send test</button>
                <button className="btn btn-sm" onClick={() => setDeliv(s)}><Icon name="shield" />Deliverability</button>
                <button className="btn btn-sm" onClick={() => verify(s)} disabled={busy === s._id}>{busy === s._id ? <Spinner /> : <Icon name="refresh" />}Re-check</button>
                <span className="spacer" />
                <button className="btn btn-sm btn-ghost" onClick={() => setEditing(s)} aria-label="Edit"><Icon name="edit" /></button>
                <button className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(s)} aria-label="Remove"><Icon name="trash" /></button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="card">
          <Empty title="No sender emails yet" action={<button className="btn btn-primary" onClick={() => setEditing({})}>Connect your first email</button>}>
            Connect Gmail, Outlook, Zoho, your hosting email, or a sending service like SendGrid or Amazon SES.
          </Empty>
        </div>
      )}

      {editing && <SenderModal initial={editing} onClose={() => setEditing(null)} onSaved={(keepOpen) => { load(); if (!keepOpen) setEditing(null); }} />}
      {deliv && <DeliverabilityModal sender={deliv} onClose={() => setDeliv(null)} />}
      {testing && (
        <Modal title={`Send a test from ${testing.fromEmail}`} onClose={() => setTesting(null)}
          footer={<><button className="btn" onClick={() => setTesting(null)}>Cancel</button><button className="btn btn-primary" form="test-form" disabled={busy === 'test'}>{busy === 'test' ? 'Sending…' : 'Send test'}</button></>}>
          <form id="test-form" onSubmit={sendTest}>
            <Field label="Send to"><input type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} required autoFocus placeholder="you@example.com" /></Field>
          </form>
        </Modal>
      )}
      {dialog}
    </>
  );
}
