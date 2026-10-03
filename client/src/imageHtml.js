// Builds email-safe HTML for inserted images (stacked or as a gallery table).
export const CONTENT_WIDTH = 560; // usable width inside a typical 600px email
const GAP = 8;
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

const wrapLink = (inner, link) => (link ? `<a href="${esc(link)}" target="_blank" style="text-decoration:none;">${inner}</a>` : inner);

/** Email-safe HTML for one or more images. layout: 'stack' | 'grid2' | 'grid3'. */
export function imagesHtml(items, { layout = 'stack', width = CONTENT_WIDTH, full = false, align = 'center' }) {
  if (layout === 'stack' || items.length === 1) {
    const margin = align === 'center' ? 'margin:0 auto;' : align === 'right' ? 'margin-left:auto;' : '';
    const style = `display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:100%;${full ? 'width:100%;' : ''}${margin}`;
    return items.map((it) => {
      const img = `<img src="${esc(it.url)}" alt="${esc(it.alt)}" width="${full ? '100%' : Math.round(width)}" style="${style}" />`;
      return `\n<div style="margin:0 0 16px;text-align:${align};">${wrapLink(img, it.link)}</div>`;
    }).join('') + '\n';
  }
  // Gallery: a table is the only layout that holds side-by-side in Outlook and Gmail.
  const cols = layout === 'grid3' ? 3 : 2;
  const cellW = Math.floor((CONTENT_WIDTH - GAP * (cols - 1)) / cols);
  const pct = `${Math.floor(100 / cols)}%`;
  const rows = [];
  for (let i = 0; i < items.length; i += cols) rows.push(items.slice(i, i + cols));
  const trs = rows.map((row) => {
    const tds = row.map((it, j) => {
      const pad = `padding:0 ${j < cols - 1 ? GAP / 2 : 0}px ${GAP}px ${j > 0 ? GAP / 2 : 0}px;`;
      const img = `<img src="${esc(it.url)}" alt="${esc(it.alt)}" width="${cellW}" style="display:block;width:100%;max-width:100%;height:auto;border:0;outline:none;" />`;
      return `<td width="${pct}" valign="top" style="${pad}">${wrapLink(img, it.link)}</td>`;
    });
    while (tds.length < cols) tds.push(`<td width="${pct}"></td>`);
    return `<tr>${tds.join('')}</tr>`;
  }).join('\n  ');
  return `\n<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 ${16 - GAP}px;">\n  ${trs}\n</table>\n`;
}
