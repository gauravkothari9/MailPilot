// Identifies uploaded files from their first bytes (never trust the browser's mimetype or the file name alone).

const IMAGE_TYPES = {
  jpg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp',
};

/** Real image type, or null. SVG is refused: it can carry scripts. */
function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return { mime: IMAGE_TYPES.jpg, ext: 'jpg' };
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return { mime: IMAGE_TYPES.png, ext: 'png' };
  if (buf.subarray(0, 4).toString('ascii') === 'GIF8') return { mime: IMAGE_TYPES.gif, ext: 'gif' };
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return { mime: IMAGE_TYPES.webp, ext: 'webp' };
  return null;
}

/** Pixel size read from the image header: { width, height } (zeros when unknown). */
function imageSize(buf, ext) {
  try {
    if (ext === 'png') return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) };
    if (ext === 'gif') return { width: buf.readUInt16LE(6), height: buf.readUInt16LE(8) };
    if (ext === 'webp') {
      const chunk = buf.subarray(12, 16).toString('ascii');
      if (chunk === 'VP8 ') return { width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff };
      if (chunk === 'VP8L') {
        const b = buf.readUInt32LE(21);
        return { width: (b & 0x3fff) + 1, height: ((b >> 14) & 0x3fff) + 1 };
      }
      if (chunk === 'VP8X') return { width: buf.readUIntLE(24, 3) + 1, height: buf.readUIntLE(27, 3) + 1 };
    }
    if (ext === 'jpg') {
      // Walk the JPEG segments to the first SOFn frame header.
      let i = 2;
      while (i + 9 < buf.length) {
        if (buf[i] !== 0xff) { i++; continue; }
        const marker = buf[i + 1];
        if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
          return { width: buf.readUInt16BE(i + 7), height: buf.readUInt16BE(i + 5) };
        }
        i += 2 + buf.readUInt16BE(i + 2);
      }
    }
  } catch { /* truncated header */ }
  return { width: 0, height: 0 };
}

// Documents people link to from email buttons. HTML, SVG and scripts are never accepted:
// files are served from our own domain, so they must not be able to run code there.
const DOC_TYPES = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  xls: 'application/vnd.ms-excel',
  ppt: 'application/vnd.ms-powerpoint',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  zip: 'application/zip',
  csv: 'text/csv; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  mp3: 'audio/mpeg',
  mp4: 'video/mp4',
};

/** Real type of a downloadable file, or null when it isn't one we accept. */
function sniffFile(buf, name = '') {
  const image = sniffImage(buf);
  if (image) return image;
  if (!buf || buf.length < 4) return null;
  const ext = (String(name).match(/\.([a-z0-9]+)$/i)?.[1] || '').toLowerCase();
  const head = buf.subarray(0, 8);
  const ok = (e) => ({ mime: DOC_TYPES[e], ext: e });
  if (head.subarray(0, 4).toString('ascii') === '%PDF') return ok('pdf');
  // Office Open XML files are zip archives; trust the extension only between those formats.
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) return ok(['docx', 'xlsx', 'pptx'].includes(ext) ? ext : 'zip');
  // Legacy Office (OLE compound file).
  if (head.equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]))) return ok(['doc', 'xls', 'ppt'].includes(ext) ? ext : 'doc');
  if (head.subarray(0, 3).toString('ascii') === 'ID3' || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0)) return ok('mp3');
  if (buf.length >= 12 && buf.subarray(4, 8).toString('ascii') === 'ftyp') return ok('mp4');
  if (['csv', 'txt'].includes(ext)) {
    // Plain text only: no NUL bytes and nothing that looks like markup.
    const sample = buf.subarray(0, 4096);
    if (sample.includes(0)) return null;
    if (/<\s*(html|script|svg|!doctype|iframe)/i.test(sample.toString('utf8'))) return null;
    return ok(ext);
  }
  return null;
}

const FILE_EXTENSIONS = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'zip', 'csv', 'txt', 'mp3', 'mp4', 'jpg', 'png', 'gif', 'webp'];

module.exports = { sniffImage, imageSize, sniffFile, FILE_EXTENSIONS };
