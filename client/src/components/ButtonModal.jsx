import { useState } from 'react';
import { useApp } from '../context';
import { Modal, Icon, Field } from './ui';
import LinkField, { validLink } from './LinkField';
import { buttonHtml, BUTTON_DEFAULTS } from '../buttonHtml';
import { PLACEMENTS } from '../placement';

/** Insert a button that opens a web page, an email address, or a PDF/file uploaded here. */
export default function ButtonModal({ onInsert, onClose, hasCursor = false, spots = {} }) {
  const { toast } = useApp();
  const [b, setB] = useState(BUTTON_DEFAULTS);
  const [placement, setPlacement] = useState(hasCursor ? 'cursor' : spots.endContent !== null ? 'endContent' : 'top');
  const set = (k) => (e) => setB({ ...b, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const setLink = (link) => setB((x) => ({ ...x, link, text: x.text || (link.startsWith('/i/') ? 'Download' : x.text) }));

  const insert = (e) => {
    e.preventDefault();
    if (!b.text.trim()) return toast('Add the button text', 'error');
    if (!validLink(b.link)) return toast('Add a link starting with https://, or choose a file', 'error');
    onInsert(buttonHtml({ ...b, text: b.text.trim(), link: b.link.trim() }), placement);
  };

  return (
    <Modal title="Insert button" onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn-primary" form="button-form"><Icon name="plus" />Insert button</button></>}>
      <form id="button-form" className="img-settings" onSubmit={insert}>
        <div>
          <div className="img-preview">
            <div className="img-preview-email" style={{ padding: '24px 16px 8px' }} dangerouslySetInnerHTML={{ __html: buttonHtml({ ...b, text: b.text || 'Button text', link: '#' }) }} onClick={(e) => e.preventDefault()} />
          </div>
          <p className="small muted">Preview at email width.</p>
        </div>
        <div>
          <Field label="Button text"><input type="text" value={b.text} onChange={set('text')} placeholder="e.g. Download the brochure" autoFocus /></Field>
          <div className="field">
            <span className="label-text">When clicked, open</span>
            <LinkField value={b.link} onChange={setLink} placeholder="https://example.com/offer or upload a file" ariaLabel="Button link" />
            <span className="hint">A web page, <code>mailto:you@example.com</code>, or a PDF / file you upload with <b>File</b>.</span>
          </div>
          <div className="form-row">
            <Field label="Button colour"><input type="color" value={b.bg} onChange={set('bg')} /></Field>
            <Field label="Text colour"><input type="color" value={b.color} onChange={set('color')} /></Field>
            <Field label="Corners (px)"><input type="number" min="0" max="40" value={b.radius} onChange={set('radius')} /></Field>
          </div>
          <div className="field">
            <span className="label-text">Size</span>
            <div className="seg">
              {[['sm', 'Small'], ['md', 'Medium'], ['lg', 'Large']].map(([v, l]) => <button type="button" key={v} className={b.size === v ? 'active' : ''} onClick={() => setB({ ...b, size: v })}>{l}</button>)}
            </div>
          </div>
          <div className="row">
            <div className="field" style={{ marginBottom: 0 }}>
              <span className="label-text">Alignment</span>
              <div className="seg">
                {['left', 'center', 'right'].map((a) => <button type="button" key={a} disabled={b.full} className={b.align === a ? 'active' : ''} onClick={() => setB({ ...b, align: a })}>{a[0].toUpperCase() + a.slice(1)}</button>)}
              </div>
            </div>
            <label className="check" style={{ marginTop: 18 }}><input type="checkbox" checked={b.full} onChange={set('full')} />Full width</label>
          </div>
          <Field label="Where to put it" style={{ marginTop: 14 }}>
            <select value={placement} onChange={(e) => setPlacement(e.target.value)}>
              {PLACEMENTS.map(([k, label]) => {
                const unavailable = k === 'cursor' ? !hasCursor : spots[k] === null;
                return <option key={k} value={k} disabled={unavailable}>{label}{unavailable ? (k === 'cursor' ? ' (click in the HTML first)' : ' (not in this email)') : ''}</option>;
              })}
            </select>
          </Field>
        </div>
      </form>
    </Modal>
  );
}
