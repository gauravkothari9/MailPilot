// Downloads a file from a public web address on behalf of a user (e.g. "add image from a link").
// Only public internet hosts are allowed: every DNS answer is checked at connect time, so a link
// can't reach this server, the private network or the cloud metadata service, even through redirects.
const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const { HttpError } = require('../utils');

const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 15000;

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224
      || (a === 100 && b >= 64 && b <= 127) // carrier-grade NAT
      || (a === 169 && b === 254) // link-local, cloud metadata
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 168)
      || (a === 192 && b === 0)
      || (a === 198 && (b === 18 || b === 19));
  }
  const v6 = ip.toLowerCase();
  const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIp(mapped[1]);
  // IPv4-mapped in hex form, e.g. ::ffff:7f00:1 (how URL() writes ::ffff:127.0.0.1).
  const hex = v6.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const [hi, lo] = [parseInt(hex[1], 16), parseInt(hex[2], 16)];
    return isPrivateIp([hi >> 8, hi & 255, lo >> 8, lo & 255].join('.'));
  }
  return v6 === '::' || v6 === '::1' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || /^ff/.test(v6) || v6.startsWith('64:ff9b:');
}

// Used as the socket's DNS lookup, so the address that is checked is the address that is connected to.
function publicLookup(hostname, options, callback) {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err);
    const bad = addresses.find((a) => isPrivateIp(a.address));
    if (bad || !addresses.length) return callback(Object.assign(new Error('blocked address'), { code: 'EBLOCKED' }));
    if (options.all) return callback(null, addresses);
    callback(null, addresses[0].address, addresses[0].family);
  });
}

/** Turns common "share" links into direct download links. */
function directLink(raw) {
  let u;
  try { u = new URL(raw); } catch { return raw; }
  const host = u.hostname.toLowerCase();
  if (host === 'drive.google.com') {
    const id = u.pathname.match(/\/file\/d\/([\w-]+)/)?.[1] || u.searchParams.get('id');
    if (id) return `https://drive.google.com/uc?export=download&id=${id}`;
  }
  if (host.endsWith('dropbox.com') && u.searchParams.has('dl')) {
    u.searchParams.set('dl', '1');
    return u.toString();
  }
  return raw;
}

function getOnce(url, maxBytes) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(url, {
      lookup: publicLookup,
      timeout: TIMEOUT_MS,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; MailPilot image fetcher)', Accept: 'image/*,application/pdf,*/*;q=0.8' },
    }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        return resolve({ redirect: new URL(res.headers.location, url) });
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new HttpError(400, `The link answered with an error (HTTP ${res.statusCode}). Check that it is public and opens without logging in.`));
      }
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size > maxBytes) {
          req.destroy();
          reject(new HttpError(400, `The file is larger than ${Math.round(maxBytes / 1048576)} MB. Compress it and try again.`));
        } else chunks.push(c);
      });
      res.on('end', () => resolve({ buffer: Buffer.concat(chunks), contentType: String(res.headers['content-type'] || ''), finalUrl: url }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new HttpError(400, 'The link took too long to answer')));
    req.on('error', (e) => {
      if (e instanceof HttpError) return reject(e);
      if (e.code === 'EBLOCKED') return reject(new HttpError(400, 'That address is not a public website'));
      if (e.code === 'ENOTFOUND') return reject(new HttpError(400, 'That website could not be found. Check the link for typos.'));
      reject(new HttpError(400, `Could not download from that link (${e.code || e.message})`));
    });
  });
}

/** GET a public http(s) URL, following redirects. Resolves { buffer, contentType, finalUrl }. */
async function fetchRemote(raw, { maxBytes }) {
  let url;
  try { url = new URL(directLink(String(raw || '').trim())); } catch { throw new HttpError(400, 'That is not a valid web address'); }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    if (!['http:', 'https:'].includes(url.protocol)) throw new HttpError(400, 'Links must start with https:// or http://');
    if (url.username || url.password) throw new HttpError(400, 'Links with a user name or password are not supported');
    // Node connects to IP-address hosts without a DNS lookup, so check those here.
    const host = url.hostname.replace(/^\[|\]$/g, '');
    if (net.isIP(host) && isPrivateIp(host)) throw new HttpError(400, 'That address is not a public website');
    const r = await getOnce(url, maxBytes);
    if (!r.redirect) return r;
    url = r.redirect;
  }
  throw new HttpError(400, 'The link redirects too many times');
}

module.exports = { fetchRemote, isPrivateIp };
