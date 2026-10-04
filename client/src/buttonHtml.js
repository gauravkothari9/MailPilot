// Builds an email-safe "bulletproof" button: a table cell with a background colour, so it stays a
// button in Outlook and in clients that strip padding from links.
const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

export const BUTTON_DEFAULTS = { text: '', link: '', bg: '#4f46e5', color: '#ffffff', align: 'center', size: 'md', full: false, radius: 8 };

const SIZES = { sm: [10, 20, 14], md: [14, 28, 16], lg: [18, 36, 18] }; // [padding-y, padding-x, font-size]

export function buttonHtml({ text, link, bg, color, align, size, full, radius }) {
  const [py, px, fs] = SIZES[size] || SIZES.md;
  const r = Math.max(0, Number(radius) || 0);
  const a = `<a href="${esc(link)}" target="_blank" style="display:${full ? 'block' : 'inline-block'};padding:${py}px ${px}px;font:600 ${fs}px/1.2 Arial,Helvetica,sans-serif;color:${esc(color)};text-decoration:none;border-radius:${r}px;background:${esc(bg)};">${esc(text)}</a>`;
  const button = `<table role="presentation" cellpadding="0" cellspacing="0" border="0"${full ? ' width="100%"' : ''} style="border-collapse:separate;">`
    + `<tr><td align="center" bgcolor="${esc(bg)}" style="border-radius:${r}px;">${a}</td></tr></table>`;
  // Outer full-width table positions the button: align on a cell works everywhere, including Outlook.
  return `\n<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 16px;">`
    + `<tr><td align="${align}">${button}</td></tr></table>\n`;
}
