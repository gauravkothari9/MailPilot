// Builds email-safe "bulletproof" buttons: a table cell with a background colour, so they stay
// buttons in Outlook and in clients that strip padding from links.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export const BUTTON_STYLE = { layout: 'stack', bg: '#4f46e5', color: '#ffffff', align: 'center', size: 'md', full: false, radius: 8 };

const SIZES = { sm: [10, 20, 14], md: [14, 28, 16], lg: [18, 36, 18] }; // [padding-y, padding-x, font-size]
const GAP = 8;

function button({ text, link }, { bg, color, size, radius }, full) {
  const [py, px, fs] = SIZES[size] || SIZES.md;
  const r = Math.max(0, Number(radius) || 0);
  const a = `<a href="${esc(link)}" target="_blank" style="display:${full ? 'block' : 'inline-block'};padding:${py}px ${px}px;font:600 ${fs}px/1.2 Arial,Helvetica,sans-serif;color:${esc(color)};text-decoration:none;border-radius:${r}px;background:${esc(bg)};">${esc(text)}</a>`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${full ? ' width="100%"' : ''} style="border-collapse:separate;">`
    + `<tr><td align="center" bgcolor="${esc(bg)}" style="border-radius:${r}px;">${a}</td></tr></table>`;
}

/** Email-safe HTML for one or more buttons. layout: 'stack' | 'grid2' | 'grid3'. items: [{ text, link }]. */
export function buttonsHtml(items, style) {
  const { layout = 'stack', align = 'center', full = false } = style;
  if (layout === 'stack' || items.length === 1) {
    // Outer full-width table positions each button: align on a cell works everywhere, including Outlook.
    return items.map((it) => `\n<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 ${items.length > 1 ? 10 : 16}px;">`
      + `<tr><td align="${align}">${button(it, style, full)}</td></tr></table>`).join('') + '\n';
  }
  // Side by side: equal-width cells, each button fills its cell.
  const cols = layout === 'grid3' ? 3 : 2;
  const pct = `${Math.floor(100 / cols)}%`;
  const rows = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  const trs = rows.map((row) => {
    const tds = row.map((it, j) => {
      const pad = `padding:0 ${j < cols - 1 ? GAP / 2 : 0}px ${GAP}px ${j > 0 ? GAP / 2 : 0}px;`;
      return `<td width="${pct}" valign="top" style="${pad}">${button(it, style, true)}</td>`;
    });
    while (tds.length < cols) tds.push(`<td width="${pct}"></td>`);
    return `<tr>${tds.join('')}</tr>`;
  }).join('\n  ');
  return `\n<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 ${16 - GAP}px;">\n  ${trs}\n</table>\n`;
}
