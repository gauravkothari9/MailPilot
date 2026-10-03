// Rule-based pre-send checks for common spam-filter triggers and deliverability mistakes.

const SPAM_WORDS = [
  'free', '100% free', 'act now', 'apply now', 'buy now', 'call now', 'cash', 'cheap', 'click here', 'click below', 'congratulations',
  'credit card', 'dear friend', 'double your', 'earn money', 'extra income', 'fast cash', 'for only', 'get paid', 'guarantee', 'guaranteed',
  'increase sales', 'incredible deal', 'limited time', 'lowest price', 'make money', 'million dollars', 'miracle', 'no catch', 'no cost',
  'no fees', 'no obligation', 'once in a lifetime', 'order now', 'risk-free', 'risk free', 'satisfaction guaranteed', 'special promotion',
  'this is not spam', 'urgent', 'winner', 'you have been selected', 'you won', 'cancel at any time', 'lose weight', 'work from home',
  'best price', 'bonus', 'prize', 'act immediately', 'don\'t delete', 'unsecured', 'while supplies last', '$$$', 'earn $',
];
const SHORTENERS = /\b(bit\.ly|tinyurl\.com|goo\.gl|ow\.ly|t\.co|is\.gd|buff\.ly|rebrand\.ly|cutt\.ly)\//i;

const strip = (html) => String(html || '')
  .replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();

/** Returns { score: 0-100, items: [{ level: 'pass'|'warn'|'fail'|'tip', text }] } */
export function checkContent({ subject = '', preheader = '', html = '', subjectB = '', abEnabled = false }) {
  const items = [];
  const add = (level, text) => items.push({ level, text });
  const text = strip(html);
  const lower = `${subject} ${text}`.toLowerCase();

  // Subject
  if (!subject.trim()) add('fail', 'Subject line is empty.');
  else {
    const len = subject.replace(/\{\{[^}]+\}\}/g, 'Alex').length;
    if (len > 70) add('warn', `Subject is ${len} characters; most inboxes cut it off around 50–60.`);
    else if (len < 10) add('warn', 'Subject is very short. Give people a reason to open.');
    else add('pass', `Subject length looks good (${len} characters).`);
    const capsWords = subject.split(/\s+/).filter((w) => w.length > 3 && /[A-Z]/.test(w) && w === w.toUpperCase());
    if (capsWords.length) add('warn', `ALL-CAPS words in the subject (${capsWords.slice(0, 3).join(', ')}) look spammy.`);
    if ((subject.match(/!/g) || []).length > 1) add('warn', 'Several exclamation marks in the subject can trigger spam filters.');
    if (/^(re|fwd?):/i.test(subject.trim())) add('fail', 'Fake “RE:” / “FWD:” prefixes are deceptive and penalized by spam filters.');
  }
  if (abEnabled && !subjectB.trim()) add('fail', 'A/B test is on but subject B is empty.');
  if (/\{\{\s*first_name/i.test(subject + subjectB)) add('pass', 'Subject is personalized with the contact’s name.');
  if (!preheader.trim()) add('tip', 'Add preview text. It shows next to the subject in most inboxes and raises open rates.');

  // Spam words
  const hits = SPAM_WORDS.filter((w) => new RegExp(`(^|[^a-z])${w.replace(/[.*+?^${}()|[\]\\$]/g, '\\$&')}([^a-z]|$)`, 'i').test(lower));
  if (hits.length >= 4) add('fail', `Lots of spam-trigger phrases: ${hits.slice(0, 6).join(', ')}.`);
  else if (hits.length) add('warn', `Spam-trigger phrases found: ${hits.join(', ')}. One or two is fine; more adds risk.`);
  else add('pass', 'No common spam-trigger phrases.');

  // Body
  const words = text ? text.split(' ').length : 0;
  const images = (html.match(/<img\b/gi) || []).length;
  const links = (html.match(/<a\b[^>]*href=/gi) || []).length;
  if (words < 25) add(images ? 'fail' : 'warn', images ? 'Mostly images with very little text. Image-only emails often go to spam.' : 'Very little text in the email.');
  else if (images && words / images < 40) add('warn', 'High image-to-text ratio. Add more text alongside your images.');
  else add('pass', `Healthy amount of text (${words} words).`);
  if (images && (html.match(/<img\b(?![^>]*\balt=)/gi) || []).length) add('tip', 'Some images have no alt text; it shows when images are blocked.');
  if (links > 15) add('warn', `${links} links is a lot. Keep it focused.`);
  if (SHORTENERS.test(html)) add('fail', 'Link shorteners (bit.ly etc.) are widely used by spammers and hurt deliverability. Use full links.');
  if (/<script|<form|<iframe|<embed|<object/i.test(html)) add('fail', 'Scripts, forms or iframes are stripped by email clients and flagged as spam.');
  if (/\{\{\s*unsubscribe_url\s*\}\}/i.test(html)) add('pass', 'Unsubscribe link is in place.');
  else add('tip', 'No {{unsubscribe_url}} in your content, so an unsubscribe footer is added automatically.');
  if (/https?:\/\/(www\.)?example\.com/i.test(html)) add('warn', 'Your email still links to example.com. Replace placeholder links.');
  if (/\[(your|insert|name)[^\]]*\]|lorem ipsum|write your message here/i.test(text)) add('warn', 'Looks like template placeholder text is still in the email.');

  const penalty = items.reduce((a, i) => a + (i.level === 'fail' ? 25 : i.level === 'warn' ? 8 : 0), 0);
  return { score: Math.max(0, 100 - penalty), items };
}
