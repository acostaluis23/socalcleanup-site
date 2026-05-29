// api/submit.js — Vercel Serverless Function (CommonJS)

const https = require('https');

const SUPABASE_URL       = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TURNSTILE_SECRET   = process.env.TURNSTILE_SECRET;

// ── Simple fetch using built-in https ─────────────────────────
function postJSON(url, payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const opts = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = https.request(url, opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function supabaseFetch(path, method, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const url  = new URL(SUPABASE_URL + path);
    const data = body ? JSON.stringify(body) : null;
    const opts = {
      hostname: url.hostname,
      path    : url.pathname + url.search,
      method,
      headers : {
        'apikey'       : SUPABASE_SERVICE_KEY,
        'Authorization': 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type' : 'application/json',
        'Prefer'       : 'return=minimal',
        ...extraHeaders,
      },
    };
    if (data) opts.headers['Content-Length'] = Buffer.byteLength(data);

    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: raw ? JSON.parse(raw) : {} }); }
        catch { resolve({ status: res.statusCode, body: raw }); }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function supabaseUpload(filePath, fileBuffer, mimeType) {
  return new Promise((resolve, reject) => {
    const url  = new URL(`${SUPABASE_URL}/storage/v1/object/lead-photos/${filePath}`);
    const opts = {
      hostname: url.hostname,
      path    : url.pathname,
      method  : 'POST',
      headers : {
        'apikey'        : SUPABASE_SERVICE_KEY,
        'Authorization' : 'Bearer ' + SUPABASE_SERVICE_KEY,
        'Content-Type'  : mimeType,
        'Content-Length': fileBuffer.length,
      },
    };
    const req = https.request(opts, (res) => {
      let raw = '';
      res.on('data', chunk => raw += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: raw }));
    });
    req.on('error', reject);
    req.write(fileBuffer);
    req.end();
  });
}

// ── Parse multipart/form-data ─────────────────────────────────
function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body     = Buffer.concat(chunks);
        const ct       = req.headers['content-type'] || '';
        const bMatch   = ct.match(/boundary=(.+)$/);
        if (!bMatch) return reject(new Error('No boundary in content-type'));
        const boundary = bMatch[1].trim();
        const delimiter = Buffer.from('\r\n--' + boundary);
        const fields   = {};
        const files    = [];

        // Split on boundary
        let start = body.indexOf('--' + boundary);
        while (start !== -1) {
          const end = body.indexOf('\r\n--' + boundary, start + boundary.length + 2);
          if (end === -1) break;
          const part      = body.slice(start + boundary.length + 2, end);
          const headerEnd = part.indexOf('\r\n\r\n');
          if (headerEnd === -1) { start = end; continue; }

          const headerStr  = part.slice(0, headerEnd).toString();
          const content    = part.slice(headerEnd + 4);
          const nameMatch  = headerStr.match(/name="([^"]+)"/);
          const fileMatch  = headerStr.match(/filename="([^"]+)"/);
          const ctMatch    = headerStr.match(/Content-Type:\s*([^\r\n]+)/i);

          if (!nameMatch) { start = end; continue; }
          const name = nameMatch[1];

          if (fileMatch) {
            files.push({
              fieldname: name,
              filename : fileMatch[1],
              mimetype : ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
              buffer   : content,
            });
          } else {
            fields[name] = content.toString();
          }
          start = end;
        }
        resolve({ fields, files });
      } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

// ── Verify Turnstile ──────────────────────────────────────────
async function verifyTurnstile(token, ip) {
  const result = await postJSON('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    secret  : TURNSTILE_SECRET,
    response: token,
    remoteip: ip,
  });
  return result.body.success === true;
}

// ── Main handler ──────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { fields, files } = await parseMultipart(req);

    // Honeypot
    if (fields.website && fields.website.trim()) {
      return res.status(200).json({ success: true }); // silently drop bot
    }

    // Turnstile verification
    const token = fields['cf-turnstile-response'];
    if (!token) return res.status(400).json({ error: 'Missing security token' });
    const ip    = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const valid = await verifyTurnstile(token, ip);
    if (!valid) return res.status(400).json({ error: 'Security check failed. Please try again.' });

    // Basic validation
    if (!fields.first_name?.trim()) return res.status(400).json({ error: 'First name is required' });
    if (!fields.phone?.trim())      return res.status(400).json({ error: 'Phone is required' });
    if (!fields.address?.trim())    return res.status(400).json({ error: 'Address is required' });

    // Upload photos
    const photoUrls  = [];
    const photoFiles = files.filter(f => f.fieldname === 'photos' && f.buffer.length > 0);
    for (const file of photoFiles) {
      const ext      = (file.filename.split('.').pop() || 'jpg').toLowerCase();
      const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const filePath = `leads/${fileName}`;
      const up       = await supabaseUpload(filePath, file.buffer, file.mimetype);
      if (up.status >= 300) throw new Error('Photo upload failed: ' + up.body);
      photoUrls.push(filePath);
    }

    // Insert lead
    const insert = await supabaseFetch('/rest/v1/leads', 'POST', {
      first_name: fields.first_name?.trim() || '',
      last_name : fields.last_name?.trim()  || '',
      phone     : fields.phone?.trim()      || '',
      email     : fields.email?.trim()      || '',
      address   : fields.address?.trim()    || '',
      service   : fields.service            || '',
      message   : fields.message?.trim()    || '',
      photo_urls: photoUrls,
    });

    if (insert.status >= 300) throw new Error('DB insert failed: ' + JSON.stringify(insert.body));

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Submit error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
};
