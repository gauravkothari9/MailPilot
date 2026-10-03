// Finds where to insert a block (e.g. images) in campaign HTML for the "Where to put it" choices.
// Each finder returns a character index, or null when the email has no such spot.

const BLOCKS = ['p', 'div', 'td', 'h1', 'h2', 'h3', 'li'];

/** Innermost block element that is still open at idx: { start, contentStart } or null. */
function enclosingBlock(html, idx) {
  const before = html.slice(0, idx);
  const re = new RegExp(`<(/?)(${BLOCKS.join('|')})\\b[^>]*>`, 'gi');
  const stack = [];
  for (let m; (m = re.exec(before));) {
    const tag = m[2].toLowerCase();
    if (!m[1]) stack.push({ tag, start: m.index, contentStart: m.index + m[0].length });
    else {
      const at = stack.map((s) => s.tag).lastIndexOf(tag);
      if (at >= 0) stack.splice(at);
    }
  }
  return stack.pop() || null;
}

/**
 * Where to put a block "above" the element at idx: before its wrapper when the wrapper holds only
 * that element (e.g. <p><a button></a></p>), otherwise directly before the element itself.
 */
function blockStartFor(html, idx) {
  const box = enclosingBlock(html, idx);
  if (!box) return idx;
  const lead = html.slice(box.contentStart, idx).replace(/<[^>]+>/g, '').trim();
  const isOnlyChild = !lead && !/<(p|div|table|h[1-3]|ul|img)\b/i.test(html.slice(box.contentStart, idx));
  return isOnlyChild && !['div', 'td'].includes(box.tag) ? box.start : idx;
}

const FINDERS = {
  // Top of the content box holding the first heading (above any small label), else right after <body>.
  top(html) {
    const h = html.search(/<h[1-3][\s>]/i);
    if (h >= 0) {
      const box = enclosingBlock(html, h);
      return box && ['div', 'td'].includes(box.tag) ? box.contentStart : h;
    }
    const body = html.match(/<body[^>]*>/i);
    return body ? body.index + body[0].length : 0;
  },
  // Right after the first heading.
  afterHeading(html) {
    const m = html.match(/<\/h[1-3]>/i);
    return m ? m.index + m[0].length : null;
  },
  // Above the first button (a link styled with a background colour).
  beforeButton(html) {
    const m = html.match(/<a\b[^>]*style=["'][^"']*background[^"']*["'][^>]*>/i);
    return m ? blockStartFor(html, m.index) : null;
  },
  // End of the message, just above the unsubscribe footer.
  endContent(html) {
    const u = html.search(/\{\{\s*unsubscribe_url\s*\}\}|unsubscribe/i);
    if (u >= 0) {
      // The match is often inside an <a href="…"> tag, so anchor on the footer's own block.
      const box = enclosingBlock(html, u);
      if (box && !['div', 'td'].includes(box.tag)) return box.start;
      return html.lastIndexOf('<', u);
    }
    const end = html.search(/<\/body>/i);
    return end >= 0 ? end : html.length;
  },
};

export const PLACEMENTS = [
  ['cursor', 'Where my cursor is in the HTML'],
  ['top', 'Top of the email (banner)'],
  ['afterHeading', 'Below the headline'],
  ['beforeButton', 'Above the button'],
  ['endContent', 'End of the message (above footer)'],
];

/** { [key]: index | null } for every automatic placement. */
export function placementIndexes(html) {
  return Object.fromEntries(Object.entries(FINDERS).map(([k, f]) => [k, f(html || '')]));
}
