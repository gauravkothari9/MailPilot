// DNS-based deliverability checks for a sender's domain: MX, SPF, DKIM, DMARC.
const dns = require('dns').promises;

const FREE_MAIL = new Set(['gmail.com', 'googlemail.com', 'yahoo.com', 'yahoo.co.in', 'outlook.com', 'hotmail.com', 'live.com', 'icloud.com', 'aol.com', 'rediffmail.com', 'zoho.com', 'proton.me', 'protonmail.com', 'gmx.com', 'yandex.com']);
const DKIM_SELECTORS = ['google', 'selector1', 'selector2', 'default', 'dkim', 'mail', 'k1', 'k2', 's1', 's2', 'smtp', 'zoho', 'zmail', 'hostinger', 'mx', 'mandrill', 'sendgrid', 'em', 'brevo', 'mailjet', 'pm', 'amazonses'];

async function txt(name) {
  try { return (await dns.resolveTxt(name)).map((parts) => parts.join('')); } catch { return []; }
}

async function checkDomain(email) {
  const domain = String(email).split('@')[1]?.toLowerCase();
  if (!domain) return { domain: null, checks: [], score: 0 };
  const checks = [];
  const add = (id, label, status, detail, fix) => checks.push({ id, label, status, detail, fix });

  if (FREE_MAIL.has(domain)) {
    add('domain', 'Sending domain', 'warn', `${domain} is a free mailbox provider.`,
      'Free mailboxes are fine for small volumes, but for bulk marketing use your own domain (e.g. hello@yourbusiness.com). Gmail/Yahoo enforce strict limits and their DMARC policy can send bulk mail from other servers to spam.');
  } else {
    add('domain', 'Sending domain', 'pass', `Sending from your own domain ${domain}.`);
  }

  let mx = [];
  try { mx = await dns.resolveMx(domain); } catch { /* none */ }
  if (mx.length) add('mx', 'MX records', 'pass', `Mail servers: ${mx.sort((a, b) => a.priority - b.priority).slice(0, 3).map((m) => m.exchange).join(', ')}`);
  else add('mx', 'MX records', 'fail', 'No MX records found, so replies and bounces cannot be received.', 'Add MX records at your DNS provider for your email host.');

  const spf = (await txt(domain)).filter((t) => /^v=spf1/i.test(t));
  if (spf.length === 1) {
    const strict = /[-~]all\b/.test(spf[0]);
    add('spf', 'SPF', strict ? 'pass' : 'warn', spf[0],
      strict ? undefined : 'End your SPF record with "~all" or "-all" so receivers can reject spoofed mail.');
  } else if (spf.length > 1) {
    add('spf', 'SPF', 'fail', 'Multiple SPF records found. Receivers treat this as an SPF error.', 'Merge them into a single TXT record that starts with v=spf1.');
  } else {
    add('spf', 'SPF', 'fail', 'No SPF record.', 'Add a TXT record on your domain such as "v=spf1 include:<your email provider> ~all" (your email host documents the exact include).');
  }

  const dkimFound = [];
  await Promise.all(DKIM_SELECTORS.map(async (sel) => {
    const recs = await txt(`${sel}._domainkey.${domain}`);
    if (recs.some((r) => /v=DKIM1|k=rsa|p=/i.test(r))) dkimFound.push(sel);
    else {
      try { if ((await dns.resolveCname(`${sel}._domainkey.${domain}`)).length) dkimFound.push(sel); } catch { /* none */ }
    }
  }));
  if (dkimFound.length) add('dkim', 'DKIM', 'pass', `DKIM key found (selector: ${dkimFound.join(', ')}).`);
  else add('dkim', 'DKIM', 'warn', 'No DKIM key found on common selectors.', 'Enable DKIM signing in your email provider\'s admin panel and publish the TXT/CNAME record it gives you. (If you use a custom selector, it may exist but not be detectable here.)');

  const dmarc = (await txt(`_dmarc.${domain}`)).find((t) => /^v=DMARC1/i.test(t));
  if (dmarc) {
    const policy = (dmarc.match(/p=(\w+)/i) || [])[1] || 'none';
    add('dmarc', 'DMARC', 'pass', dmarc, policy === 'none' ? 'Policy is p=none (monitoring). That meets Gmail/Yahoo bulk-sender rules; move to quarantine once SPF and DKIM are passing.' : undefined);
  } else {
    add('dmarc', 'DMARC', 'fail', 'No DMARC record. Gmail and Yahoo require one for bulk senders.', `Add a TXT record at _dmarc.${domain} with "v=DMARC1; p=none; rua=mailto:dmarc@${domain}".`);
  }

  const weight = { pass: 1, warn: 0.5, fail: 0 };
  const score = Math.round((100 * checks.reduce((a, c) => a + weight[c.status], 0)) / checks.length);
  return { domain, checks, score };
}

module.exports = { checkDomain };
