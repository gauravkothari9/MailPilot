import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../context';
import { Icon, Loading, Field, Modal, Badge, Spinner, fmtNum, useDebounced } from '../components/ui';
import SegmentBuilder from '../components/SegmentBuilder';
import ImageModal from '../components/ImageModal';
import ButtonModal from '../components/ButtonModal';
import { placementIndexes } from '../placement';
import { checkContent } from '../contentCheck';

const LEVEL = { pass: ['green', '✓'], warn: ['amber', '!'], fail: ['red', '✕'], tip: ['blue', 'i'] };
const toLocalInput = (d) => {
  const x = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
  return x.toISOString().slice(0, 16);
};

export default function CampaignEditor() {
  const { id } = useParams();
  const { businessId, toast } = useApp();
  const navigate = useNavigate();
  const [c, setC] = useState(null);
  const [senders, setSenders] = useState([]);
  const [lists, setLists] = useState([]);
  const [fields, setFields] = useState([]);
  const [tags, setTags] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [images, setImages] = useState([]);
  const [preview, setPreview] = useState(null);
  const [audience, setAudience] = useState(null);
  const [saveState, setSaveState] = useState('saved');
  const [device, setDevice] = useState('desktop');
  const [modal, setModal] = useState(null);
  const [testTo, setTestTo] = useState('');
  const [sendMode, setSendMode] = useState('now');
  const [when, setWhen] = useState(() => toLocalInput(new Date(Date.now() + 3600000)));
  const [busy, setBusy] = useState(false);
  const [tplName, setTplName] = useState('');
  const htmlRef = useRef();
  const dirty = useRef(false);

  useEffect(() => {
    api.get(`/campaigns/${id}`).then((d) => {
      if (!['draft', 'paused'].includes(d.status)) return navigate(`/campaigns/${id}`, { replace: true });
      setC(d);
    }).catch((e) => toast(e.message, 'error'));
    api.get(`/businesses/${businessId}/senders`).then(setSenders).catch(() => {});
    api.get(`/businesses/${businessId}/lists`).then(setLists).catch(() => {});
    api.get(`/businesses/${businessId}/fields`).then(setFields).catch(() => {});
    api.get(`/businesses/${businessId}/tags`).then(setTags).catch(() => {});
    api.get(`/businesses/${businessId}/images`).then(setImages).catch(() => {});
  }, [id, businessId, navigate, toast]);

  const update = (patch) => { dirty.current = true; setSaveState('unsaved'); setC((x) => ({ ...x, ...patch })); };
  const updateAb = (patch) => update({ abTest: { ...c.abTest, ...patch } });

  const payload = useMemo(() => c && ({
    name: c.name, subject: c.subject, preheader: c.preheader, html: c.html, sender: c.sender || null, list: c.list || null,
    trackOpens: c.trackOpens, trackClicks: c.trackClicks, rules: c.rules, abTest: c.abTest,
  }), [c]);
  const debounced = useDebounced(payload, 800);

  const save = useCallback(async (body) => {
    setSaveState('saving');
    try {
      await api.put(`/campaigns/${id}`, body);
      dirty.current = false;
      setSaveState('saved');
      api.get(`/campaigns/${id}/audience`).then((a) => setAudience(a.count)).catch(() => {});
      return true;
    } catch (e) {
      setSaveState('error');
      toast(e.message, 'error');
      return false;
    }
  }, [id, toast]);

  // Autosave + live preview.
  useEffect(() => { if (debounced && dirty.current) save(debounced); }, [debounced, save]);
  useEffect(() => {
    if (!debounced) return;
    api.post(`/campaigns/${id}/preview`, { subject: debounced.subject, preheader: debounced.preheader, html: debounced.html, list: debounced.list }).then(setPreview).catch(() => {});
  }, [debounced, id]);
  useEffect(() => { if (c?._id) api.get(`/campaigns/${id}/audience`).then((a) => setAudience(a.count)).catch(() => {}); }, [c?._id, id]);
  useEffect(() => {
    const warn = (e) => { if (dirty.current) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, []);

  const check = useMemo(() => c && checkContent({ subject: c.subject, preheader: c.preheader, html: c.html, subjectB: c.abTest?.subjectB, abEnabled: c.abTest?.enabled }), [c]);

  // Remembers the cursor so a modal (e.g. image picker) can insert where the user was typing.
  const cursor = useRef(null);
  const insertText = (text) => {
    const el = htmlRef.current;
    if (!el) return;
    const s = cursor.current?.start ?? el.selectionStart;
    const e = cursor.current?.end ?? el.selectionEnd;
    cursor.current = null;
    update({ html: c.html.slice(0, s) + text + c.html.slice(e) });
    requestAnimationFrame(() => { el.focus(); el.selectionStart = el.selectionEnd = s + text.length; });
  };
  const insertTag = (tag) => insertText(`{{${tag}}}`);
  // Opens an insert modal (image picker, button) remembering the cursor.
  const openInsert = (which) => {
    const el = htmlRef.current;
    // A cursor counts only if the user actually clicked into the HTML box.
    const hasCursor = !!el && (document.activeElement === el || el.selectionStart > 0);
    cursor.current = hasCursor ? { start: el.selectionStart, end: el.selectionEnd, real: true } : null;
    setModal(which);
  };
  const insertBlock = (html, placement, message) => {
    let at = null;
    if (placement !== 'cursor' || !cursor.current?.real) at = placementIndexes(c.html)[placement === 'cursor' ? 'top' : placement];
    if (at !== null && at !== undefined) cursor.current = { start: at, end: at };
    insertText(html);
    setModal(null);
    toast(message, 'success');
  };
  const insertImages = (html, count, placement) => insertBlock(html, placement, count > 1 ? `${count} images inserted` : 'Image inserted');
  const closeInsert = () => { cursor.current = null; setModal(null); };

  const flush = async () => (dirty.current ? save(payload) : true);

  const sendTest = async (e) => {
    e.preventDefault();
    if (!(await flush())) return;
    setBusy(true);
    try {
      await api.post(`/campaigns/${id}/test`, { to: testTo });
      toast('Test email sent. Check your inbox (and spam folder)', 'success');
      setModal(null);
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };

  const launch = async () => {
    if (!(await flush())) return;
    setBusy(true);
    try {
      if (c.status === 'paused') await api.post(`/campaigns/${id}/resume`);
      else await api.post(`/campaigns/${id}/send`, sendMode === 'schedule' ? { scheduledAt: new Date(when).toISOString() } : {});
      toast(sendMode === 'schedule' && c.status !== 'paused' ? 'Campaign scheduled' : 'Sending started 🚀', 'success');
      navigate(`/campaigns/${id}`);
    } catch (err) { toast(err.message, 'error'); } finally { setBusy(false); }
  };

  const applyTemplate = async (tid) => {
    if (!(await flush())) return;
    await api.post(`/campaigns/${id}/apply-template`, { templateId: tid });
    const d = await api.get(`/campaigns/${id}`);
    setC(d);
    setModal(null);
    toast('Template applied', 'success');
  };
  const saveTemplate = async (e) => {
    e.preventDefault();
    if (!(await flush())) return;
    await api.post(`/businesses/${businessId}/templates`, { name: tplName, campaignId: id });
    toast('Saved to your templates', 'success');
    setModal(null);
  };

  if (!c) return <Loading />;
  const sender = senders.find((s) => s._id === c.sender);
  const isFollowUp = c.audience !== 'list';
  const blockers = [
    !c.subject.trim() && 'Add a subject line',
    !c.sender && 'Choose a sender email',
    !isFollowUp && !c.list && 'Choose a contact list',
    audience === 0 && 'No subscribed contacts match this audience',
    c.abTest?.enabled && !c.abTest.subjectB?.trim() && 'Add subject B for the A/B test',
  ].filter(Boolean);
  const testCount = audience && c.abTest?.enabled ? Math.max(2, Math.ceil((audience * c.abTest.testPercent) / 100)) : 0;
  const allTags = preview?.tags || ['first_name', 'last_name', 'email', 'company', 'business_name'];

  return (
    <>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <Link to="/campaigns" className="small muted back"><Icon name="arrowLeft" size={14} /> Campaigns</Link>
          <input className="title-input" value={c.name} onChange={(e) => update({ name: e.target.value })} aria-label="Campaign name" />
        </div>
        <div className="row">
          <span className={`save-state ${saveState}`}>{saveState === 'saving' ? 'Saving…' : saveState === 'unsaved' ? 'Unsaved changes' : saveState === 'error' ? 'Save failed' : '✓ Saved'}</span>
          <button className="btn" onClick={() => { setTplName(c.name); setModal('saveTpl'); }}><Icon name="template" />Save as template</button>
          <button className="btn" onClick={() => setModal('test')} disabled={!c.sender}><Icon name="send" />Send test</button>
          <button className="btn btn-primary" onClick={() => setModal('send')}><Icon name="play" />{c.status === 'paused' ? 'Review & resume' : 'Review & send'}</button>
        </div>
      </div>
      {c.status === 'paused' && <div className="alert warn"><Icon name="pause" size={16} />This campaign is paused{c.note ? `: ${c.note}` : ''}. Fix anything you need, then resume.</div>}

      <div className="editor">
        <div className="editor-side">
          <section className="card card-pad">
            <h3 className="section-title" style={{ marginTop: 0 }}>1 · From & to</h3>
            <Field label="Send from">
              <select value={c.sender || ''} onChange={(e) => update({ sender: e.target.value })}>
                <option value="">Choose sender…</option>
                {senders.map((s) => <option key={s._id} value={s._id}>{s.fromName} &lt;{s.fromEmail}&gt;{s.verified ? '' : ' (not connected)'}</option>)}
              </select>
            </Field>
            {!senders.length && <p className="small"><Link to="/senders">Connect a sender email</Link> first.</p>}
            {isFollowUp ? (
              <div className="alert info small"><Icon name="refresh" size={15} />Follow-up campaign: sends to {c.audience === 'non_openers' ? 'people who did not open' : 'people who did not click'} the original campaign.</div>
            ) : (
              <Field label="Send to list">
                <select value={c.list || ''} onChange={(e) => update({ list: e.target.value })}>
                  <option value="">Choose list…</option>
                  {lists.map((l) => <option key={l._id} value={l._id}>{l.name} ({fmtNum(l.active)} subscribed)</option>)}
                </select>
              </Field>
            )}
            <span className="label-text">Segment <span className="muted small">(optional)</span></span>
            <SegmentBuilder rules={c.rules || []} onChange={(rules) => update({ rules })} fields={fields} tags={tags} />
            <div className="audience-count">
              <Icon name="users" size={16} />
              {audience === null ? <Spinner /> : <><b>{fmtNum(audience)}</b>&nbsp;subscribed contacts will receive this</>}
            </div>
          </section>

          <section className="card card-pad">
            <h3 className="section-title" style={{ marginTop: 0 }}>2 · Subject</h3>
            <Field label={c.abTest?.enabled ? 'Subject A' : 'Subject line'}><input type="text" value={c.subject} onChange={(e) => update({ subject: e.target.value })} placeholder="e.g. {{first_name}}, your exclusive offer inside" /></Field>
            <Field label="Preview text" hint="Shown after the subject in the inbox list"><input type="text" value={c.preheader} onChange={(e) => update({ preheader: e.target.value })} /></Field>
            <label className="check"><input type="checkbox" checked={!!c.abTest?.enabled} onChange={(e) => updateAb({ enabled: e.target.checked })} disabled={c.status !== 'draft'} /><Icon name="split" size={15} /> A/B test the subject line</label>
            {c.abTest?.enabled && (
              <div className="ab-box">
                <Field label="Subject B"><input type="text" value={c.abTest.subjectB} onChange={(e) => updateAb({ subjectB: e.target.value })} disabled={c.status !== 'draft'} /></Field>
                <div className="form-row">
                  <Field label="Test group size" hint={audience ? `${fmtNum(testCount)} people (half get A, half get B)` : undefined}>
                    <select value={c.abTest.testPercent} onChange={(e) => updateAb({ testPercent: Number(e.target.value) })} disabled={c.status !== 'draft'}>
                      {[10, 20, 30, 40, 50, 100].map((p) => <option key={p} value={p}>{p === 100 ? 'Everyone (50/50 split)' : `${p}% of audience`}</option>)}
                    </select>
                  </Field>
                  <Field label="Pick winner after">
                    <select value={c.abTest.waitHours} onChange={(e) => updateAb({ waitHours: Number(e.target.value) })} disabled={c.status !== 'draft'}>
                      {[1, 2, 4, 8, 12, 24, 48].map((h) => <option key={h} value={h}>{h} hour{h > 1 ? 's' : ''}</option>)}
                    </select>
                  </Field>
                </div>
                <Field label="Winner is the subject with the higher">
                  <select value={c.abTest.metric} onChange={(e) => updateAb({ metric: e.target.value })} disabled={c.status !== 'draft'}>
                    <option value="opens">Open rate</option>
                    <option value="clicks">Click rate</option>
                  </select>
                </Field>
                <p className="small muted" style={{ margin: 0 }}>The rest of your audience automatically gets the winning subject.</p>
              </div>
            )}
          </section>

          <section className="card card-pad">
            <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
              <h3 className="section-title" style={{ margin: 0 }}>3 · Content</h3>
              <div className="row" style={{ gap: 6 }}>
                <button className="btn btn-sm btn-primary" onMouseDown={(e) => e.preventDefault()} onClick={() => openInsert('image')}><Icon name="image" />Insert image</button>
                <button className="btn btn-sm" onMouseDown={(e) => e.preventDefault()} onClick={() => openInsert('button')} title="A button linking to a web page or a PDF / file"><Icon name="button" />Insert button</button>
                <button className="btn btn-sm" onClick={() => { setModal('tpl'); api.get(`/businesses/${businessId}/templates`).then(setTemplates); }}><Icon name="template" />Templates</button>
              </div>
            </div>
            <span className="label-text">Personalize: click to insert at cursor</span>
            <div className="chips" style={{ margin: '6px 0 10px' }}>
              {allTags.map((t) => <button type="button" key={t} className="chip" onClick={() => insertTag(t)}>{`{{${t}}}`}</button>)}
              <button type="button" className="chip" onClick={() => insertTag('unsubscribe_url')}>{'{{unsubscribe_url}}'}</button>
            </div>
            <p className="small muted" style={{ marginTop: 0 }}>Fallback for empty values: <code>{'{{first_name|there}}'}</code></p>
            {images.length > 0 && (
              <>
                <span className="label-text">Your images: click to insert at cursor</span>
                <div className="chips" style={{ margin: '6px 0 6px' }}>
                  {images.map((img) => (
                    <button type="button" key={img._id} className="chip chip-image" title={img.name} onClick={() => insertText(`{{image:${img.tag}}}`)}>
                      <img src={img.url} alt="" />{`{{image:${img.tag}}}`}
                    </button>
                  ))}
                </div>
                <p className="small muted" style={{ marginTop: 0 }}>
                  Different image per contact: <code>{'{{image:banner_[country]|banner_default}}'}</code> picks <code>banner_norway</code>, <code>banner_new_zealand</code>… from the contact's country, else <code>banner_default</code>. Rename tags in <b>Insert image → Image library</b>.
                </p>
              </>
            )}
            <textarea ref={htmlRef} className="code" value={c.html} onChange={(e) => update({ html: e.target.value })} spellCheck={false} aria-label="Email HTML" />
            <div className="row" style={{ marginTop: 10 }}>
              <label className="check"><input type="checkbox" checked={c.trackOpens} onChange={(e) => update({ trackOpens: e.target.checked })} />Track opens</label>
              <label className="check"><input type="checkbox" checked={c.trackClicks} onChange={(e) => update({ trackClicks: e.target.checked })} />Track clicks</label>
            </div>
          </section>

          <section className="card card-pad">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <h3 className="section-title" style={{ margin: 0 }}>Spam & content check</h3>
              <span className={`score-chip ${check.score >= 80 ? 'good' : check.score >= 55 ? 'ok' : 'bad'}`}>{check.score}/100</span>
            </div>
            <ul className="check-items">
              {check.items.map((i, k) => <li key={k}><span className={`lvl ${LEVEL[i.level][0]}`}>{LEVEL[i.level][1]}</span>{i.text}</li>)}
            </ul>
          </section>
        </div>

        <div className="card preview-card">
          <div className="preview-bar">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div style={{ minWidth: 0 }}>
                <div className="small muted truncate">From: {sender ? `${sender.fromName} <${sender.fromEmail}>` : '—'} · To: {preview?.sampleEmail || '…'}</div>
                <div className="subj truncate">{preview?.subject || c.subject || <span className="muted">No subject</span>}</div>
              </div>
              <div className="device-toggle">
                <button className={device === 'desktop' ? 'active' : ''} onClick={() => setDevice('desktop')}>Desktop</button>
                <button className={device === 'mobile' ? 'active' : ''} onClick={() => setDevice('mobile')}>Mobile</button>
              </div>
            </div>
          </div>
          <div className={`preview-stage ${device}`}>
            <iframe className="preview-frame" title="Email preview" sandbox="allow-same-origin" srcDoc={preview?.html || ''} />
          </div>
          <div className="small muted" style={{ padding: '8px 14px' }}>Preview uses real data from {preview?.sampleEmail || 'a sample contact'}. Tracking links are added when sending.</div>
        </div>
      </div>

      {modal === 'test' && (
        <Modal title="Send a test email" onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" form="test-form" disabled={busy}>{busy ? 'Sending…' : 'Send test'}</button></>}>
          <form id="test-form" onSubmit={sendTest}>
            <Field label="Send to" hint="Up to 5 addresses, comma separated. Personalized with a sample contact from your list. Not tracked.">
              <input type="text" autoFocus required value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
            </Field>
          </form>
        </Modal>
      )}

      {modal === 'send' && (
        <Modal title={c.status === 'paused' ? 'Resume campaign' : 'Review & send'} onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Back to editing</button>
            <button className="btn btn-primary" onClick={launch} disabled={busy || blockers.length > 0}>
              {busy ? <Spinner /> : <Icon name={sendMode === 'schedule' ? 'clock' : 'send'} />}
              {c.status === 'paused' ? 'Resume sending' : sendMode === 'schedule' ? 'Schedule campaign' : `Send to ${fmtNum(audience)} contacts`}
            </button></>}>
          {blockers.length > 0 && <div className="alert error"><div><b>Before sending:</b><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{blockers.map((b) => <li key={b}>{b}</li>)}</ul></div></div>}
          <dl className="kv review">
            <dt>From</dt><dd>{sender ? `${sender.fromName} <${sender.fromEmail}>` : '—'}{sender && !sender.verified && <Badge color="red">not connected</Badge>}</dd>
            <dt>To</dt><dd><b>{fmtNum(audience)}</b> contacts{c.rules?.length ? ` (${c.rules.length} segment filter${c.rules.length > 1 ? 's' : ''})` : ''}</dd>
            <dt>Subject</dt><dd>{c.subject}{c.abTest?.enabled && <div className="small">B: {c.abTest.subjectB} · test {fmtNum(testCount)} people, winner after {c.abTest.waitHours}h by {c.abTest.metric === 'clicks' ? 'click' : 'open'} rate</div>}</dd>
            <dt>Speed</dt><dd>{sender ? `${sender.ratePerMinute}/min · max ${fmtNum(sender.dailyLimit)}/day` : '—'}{sender && audience > sender.dailyLimit && <div className="small text-amber">This audience is larger than the daily limit, so sending continues over {Math.ceil(audience / sender.dailyLimit)} days.</div>}</dd>
            <dt>Content check</dt><dd>{check.score}/100{check.items.some((i) => i.level === 'fail') && <span className="small text-red"> · has issues, see the checklist</span>}</dd>
          </dl>
          {c.status !== 'paused' && (
            <div className="send-mode">
              <label className={`radio-card ${sendMode === 'now' ? 'on' : ''}`}><input type="radio" checked={sendMode === 'now'} onChange={() => setSendMode('now')} /><div><b>Send now</b><div className="small muted">Starts immediately</div></div></label>
              <label className={`radio-card ${sendMode === 'schedule' ? 'on' : ''}`}><input type="radio" checked={sendMode === 'schedule'} onChange={() => setSendMode('schedule')} /><div><b>Schedule</b><div className="small muted">Pick a date & time</div></div></label>
            </div>
          )}
          {sendMode === 'schedule' && c.status !== 'paused' && (
            <Field label="Send at" hint={`Your time zone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}`}>
              <input type="datetime-local" value={when} min={toLocalInput(new Date())} onChange={(e) => setWhen(e.target.value)} />
            </Field>
          )}
        </Modal>
      )}

      {modal === 'tpl' && (
        <Modal title="Choose a template" onClose={() => setModal(null)} wide>
          <p className="small muted" style={{ marginTop: 0 }}>Replaces the current email content. Subject and preview text are filled only if empty.</p>
          <div className="template-pick">
            {templates.map((t) => (
              <button type="button" key={t._id} className="tpl-card" onClick={() => applyTemplate(t._id)}>
                <iframe className="tpl-thumb" title={t.name} srcDoc={t.html} tabIndex={-1} sandbox="" />
                <b className="truncate">{t.name}</b>{!t.builtIn && <span className="small muted">Saved</span>}
              </button>
            ))}
          </div>
        </Modal>
      )}

      {modal === 'image' && (
        <ImageModal hasCursor={!!cursor.current?.real} spots={placementIndexes(c.html)} onLibraryChange={setImages} onClose={closeInsert} onInsert={insertImages} />
      )}
      {modal === 'button' && (
        <ButtonModal hasCursor={!!cursor.current?.real} spots={placementIndexes(c.html)} onClose={closeInsert} onInsert={(html, placement) => insertBlock(html, placement, 'Button inserted')} />
      )}

      {modal === 'saveTpl' && (
        <Modal title="Save as template" onClose={() => setModal(null)}
          footer={<><button className="btn" onClick={() => setModal(null)}>Cancel</button><button className="btn btn-primary" form="tpl-form">Save template</button></>}>
          <form id="tpl-form" onSubmit={saveTemplate}><Field label="Template name"><input type="text" autoFocus required value={tplName} onChange={(e) => setTplName(e.target.value)} /></Field></form>
        </Modal>
      )}
    </>
  );
}
