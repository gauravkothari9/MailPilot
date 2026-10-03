import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api';
import { useApp } from '../context';
import { Icon, Loading, Modal, Badge, useConfirm } from '../components/ui';

export default function Templates() {
  const { businessId, toast } = useApp();
  const navigate = useNavigate();
  const [list, setList] = useState(null);
  const [viewing, setViewing] = useState(null);
  const [confirm, dialog] = useConfirm();

  const load = useCallback(() => api.get(`/businesses/${businessId}/templates`).then(setList).catch((e) => toast(e.message, 'error')), [businessId, toast]);
  useEffect(() => { load(); }, [load]);

  const use = async (t) => {
    const c = await api.post(`/businesses/${businessId}/campaigns`, { name: t.name });
    await api.post(`/campaigns/${c._id}/apply-template`, { templateId: t._id });
    navigate(`/campaigns/${c._id}/edit`);
  };
  const remove = async (t) => {
    if (!(await confirm({ title: `Delete “${t.name}”?`, danger: true, confirmLabel: 'Delete', message: 'Campaigns already using it are not affected.' }))) return;
    await api.del(`/templates/${t._id}`);
    load();
  };

  if (!list) return <Loading />;
  return (
    <>
      <div className="page-head">
        <div><h1>Templates</h1><p>Start campaigns from proven layouts. Save any campaign as a template from the editor.</p></div>
      </div>
      <div className="template-grid">
        {list.map((t) => (
          <div key={t._id} className="card tpl-tile">
            <button className="tpl-preview" onClick={() => setViewing(t)} aria-label={`Preview ${t.name}`}>
              <iframe title={t.name} srcDoc={t.html} tabIndex={-1} sandbox="" />
            </button>
            <div className="tpl-meta">
              <div style={{ minWidth: 0 }}>
                <b className="truncate" style={{ display: 'block' }}>{t.name}</b>
                <span className="small muted truncate" style={{ display: 'block' }}>{t.subject || 'No subject'}</span>
              </div>
              {t.builtIn ? <Badge>Built-in</Badge> : <Badge color="indigo">Yours</Badge>}
            </div>
            <div className="row" style={{ padding: '0 14px 14px', flexWrap: 'nowrap' }}>
              <button className="btn btn-sm btn-primary" onClick={() => use(t)}>Use template</button>
              <button className="btn btn-sm" onClick={() => setViewing(t)}><Icon name="eye" />Preview</button>
              <span className="spacer" />
              {!t.builtIn && <button className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(t)} aria-label="Delete"><Icon name="trash" /></button>}
            </div>
          </div>
        ))}
      </div>
      {viewing && (
        <Modal title={viewing.name} onClose={() => setViewing(null)} wide
          footer={<><button className="btn" onClick={() => setViewing(null)}>Close</button><button className="btn btn-primary" onClick={() => use(viewing)}>Use this template</button></>}>
          <iframe className="preview-frame" style={{ height: 560, border: '1px solid var(--border)', borderRadius: 10 }} title="Template preview" srcDoc={viewing.html} sandbox="" />
        </Modal>
      )}
      {dialog}
    </>
  );
}
