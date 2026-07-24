// api/submit.js — Vercel Serverless Function
// Photos are uploaded directly from browser to Supabase Storage.
// This function only verifies Turnstile + inserts the lead row.

const https = require('https');

const SUPABASE_URL         = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TURNSTILE_SECRET     = process.env.TURNSTILE_SECRET;

// ── HTTP helper ───────────────────────────────────────────────
function httpsRequest(options, bodyBuffer) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', chunk => chunks.push(chunk));
      res.on('end', () => resolve({
        status: res.statusCode,
        body  : Buffer.concat(chunks).toString(),
      }));
    });
    req.on('error', reject);
    if (bodyBuffer) req.write(bodyBuffer);
    req.end();
  });
}

// ── Turnstile verification ────────────────────────────────────
async function verifyTurnstile(token, ip) {
  const params = new URLSearchParams({
    secret  : TURNSTILE_SECRET,
    response: token,
    remoteip: ip || '',
  }).toString();
  const buf  = Buffer.from(params);
  const res  = await httpsRequest({
    hostname: 'challenges.cloudflare.com',
    path    : '/turnstile/v0/siteverify',
    method  : 'POST',
    headers : { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': buf.length },
  }, buf);
  const data = JSON.parse(res.body);
  console.log('Turnstile result:', data);
  return data.success === true;
}

// ── Supabase insert ───────────────────────────────────────────
async function insertLead(lead) {
  const body = Buffer.from(JSON.stringify(lead));
  return httpsRequest({
    hostname: new URL(SUPABASE_URL).hostname,
    path    : '/rest/v1/leads',
    method  : 'POST',
    headers : {
      'apikey'        : SUPABASE_SERVICE_KEY,
      'Authorization' : 'Bearer ' + SUPABASE_SERVICE_KEY,
      'Content-Type'  : 'application/json',
      'Content-Length': body.length,
      'Prefer'        : 'return=minimal',
    },
  }, body);
}

// ── Parse simple multipart (text fields only) ─────────────────
function parseFields(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        const body     = Buffer.concat(chunks);
        const ct       = req.headers['content-type'] || '';
        const bMatch   = ct.match(/boundary=(.+)$/);
        if (!bMatch) return reject(new Error('No boundary'));
        const boundary = bMatch[1].trim();
        const fields   = {};

        let pos = body.indexOf('--' + boundary);
        const delim = Buffer.from('\r\n--' + boundary);

        while (pos !== -1) {
          pos += boundary.length + 2;
          const nextDelim = body.indexOf(delim, pos);
          const partEnd   = nextDelim === -1 ? body.length : nextDelim;
          const part      = body.slice(pos, partEnd);
          const hEnd      = part.indexOf('\r\n\r\n');
          if (hEnd === -1) break;

          const headerStr = part.slice(0, hEnd).toString();
          const content   = part.slice(hEnd + 4).toString().replace(/\r\n$/, '');
          const nameMatch = headerStr.match(/name="([^"]+)"/);
          const fileMatch = headerStr.match(/filename="/);

          // Skip file parts — photos come as paths, not binary
          if (nameMatch && !fileMatch) {
            fields[nameMatch[1]] = content;
          }

          if (nextDelim === -1) break;
          pos = nextDelim;
          if (body.slice(pos + delim.length, pos + delim.length + 2).toString() === '--') break;
        }
        resolve(fields);
      } catch (err) { reject(err); }
    });
    req.on('error', reject);
  });
}

// ── Resend email notification ─────────────────────────────────
async function sendLeadEmail(lead) {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(' ') || 'Unknown';
  const photoCount = (lead.photo_urls || []).length;
  const photosLine = photoCount > 0
    ? `<p style="margin:0 0 8px"><strong>📷 Photos:</strong> ${photoCount} photo${photoCount > 1 ? 's' : ''} attached — view in admin dashboard</p>`
    : `<p style="margin:0 0 8px;color:#888"><strong>Photos:</strong> None submitted</p>`;

  const html = `<!DOCTYPE html><html><body style="margin:0;padding:0;background:#f4f4f0;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f0;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">
        <tr><td style="background:#1a5c1a;padding:24px 32px;">
          <p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.6);">New Lead</p>
          <h1 style="margin:6px 0 0;font-size:22px;font-weight:700;color:#fff;">SoCal Cleanup & Hauling</h1>
        </td></tr>
        <tr><td style="background:#f5a623;padding:12px 32px;">
          <p style="margin:0;font-size:14px;font-weight:700;color:#0d0d0d;">🚛 New quote request received</p>
        </td></tr>
        <tr><td style="padding:28px 32px;">
          <h2 style="margin:0 0 16px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#888;border-bottom:1px solid #eee;padding-bottom:8px;">Contact Info</h2>
          <p style="margin:0 0 8px"><strong>👤 Name:</strong> ${name}</p>
          <p style="margin:0 0 8px"><strong>📞 Phone:</strong> <a href="tel:${lead.phone}" style="color:#1a5c1a;font-weight:700;">${lead.phone || '—'}</a></p>
          ${lead.email ? `<p style="margin:0 0 8px"><strong>✉️ Email:</strong> ${lead.email}</p>` : ''}
          <p style="margin:0 0 24px"><strong>📍 Address:</strong> ${lead.address || '—'}</p>
          <h2 style="margin:0 0 16px;font-size:12px;letter-spacing:1.5px;text-transform:uppercase;color:#888;border-bottom:1px solid #eee;padding-bottom:8px;">Job Details</h2>
          <p style="margin:0 0 8px"><strong>🔧 Service:</strong> ${lead.service || 'Not specified'}</p>
          ${lead.message
            ? `<p style="margin:0 0 8px"><strong>💬 Message:</strong></p><p style="margin:0 0 16px;padding:12px 16px;background:#f9f9f9;border-left:3px solid #1a5c1a;border-radius:4px;color:#333;">${lead.message}</p>`
            : `<p style="margin:0 0 16px;color:#888">No message provided.</p>`}
          ${photosLine}
          <div style="margin-top:28px;text-align:center;">
            <a href="https://socalcleanup-site.vercel.app/admin.html" style="display:inline-block;padding:14px 32px;background:#1a5c1a;color:#fff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;">View in Admin Dashboard →</a>
          </div>
        </td></tr>
        <tr><td style="padding:16px 32px;background:#f9f9f9;border-top:1px solid #eee;">
          <p style="margin:0;font-size:12px;color:#aaa;text-align:center;">SoCal Cleanup & Hauling · Yorba Linda, CA · (951) 573-2144</p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body></html>`;

  const body = Buffer.from(JSON.stringify({
    from   : 'SoCal Cleanup <notifications@socalcleanupandhauling.com>',
    to     : ['alvarez_sergio1997@outlook.com', 'luism@computerdoctorsla.com', 'acostaluis23@gmail.com'],
    subject: `🚛 New Lead: ${name} — ${lead.service || 'Quote Request'}`,
    html,
  }));

  return httpsRequest({
    hostname: 'api.resend.com',
    path    : '/emails',
    method  : 'POST',
    headers : {
      'Authorization' : 'Bearer ' + process.env.RESEND_API_KEY,
      'Content-Type'  : 'application/json',
      'Content-Length': body.length,
    },
  }, body);
}

// ── Main handler ──────────────────────────────────────────────
module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Content-Type', 'application/json');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST')   return res.status(405).json({ error: 'Method not allowed' });

  try {
    const fields = await parseFields(req);

    // Honeypot check
    if (fields.website && fields.website.trim()) {
      console.log('Honeypot triggered');
      return res.status(200).json({ success: true });
    }

    // Turnstile verification
    const token = fields['cf-turnstile-response'];
    if (!token) return res.status(400).json({ error: 'Missing security token. Please refresh and try again.' });
    const ip    = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    const valid = await verifyTurnstile(token, ip);
    if (!valid) return res.status(400).json({ error: 'Security check failed. Please refresh and try again.' });

    // Basic validation
    if (!fields.first_name?.trim()) return res.status(400).json({ error: 'First name is required.' });
    if (!fields.phone?.trim())      return res.status(400).json({ error: 'Phone number is required.' });
    if (!fields.address?.trim())    return res.status(400).json({ error: 'Address is required.' });

    // Parse photo URLs (sent as JSON string)
    let photoUrls = [];
    try { photoUrls = JSON.parse(fields.photo_urls || '[]'); } catch {}

    // Insert lead
    const result = await insertLead({
      first_name: fields.first_name?.trim() || '',
      last_name : fields.last_name?.trim()  || '',
      phone     : fields.phone?.trim()      || '',
      email     : fields.email?.trim()      || '',
      address   : fields.address?.trim()    || '',
      service   : fields.service            || '',
      message   : fields.message?.trim()    || '',
      photo_urls: photoUrls,
    });

    console.log('Insert result:', result.status, result.body);
    if (result.status >= 300) throw new Error('DB insert failed (' + result.status + '): ' + result.body);

    // ── Send email notification ──
    // Must be awaited: Vercel can freeze/terminate the function right after
    // the response is sent, killing any in-flight "fire and forget" promise
    // before the outbound request to Resend ever completes.
    try {
      const emailResult = await sendLeadEmail({
        first_name: fields.first_name?.trim() || '',
        last_name : fields.last_name?.trim()  || '',
        phone     : fields.phone?.trim()      || '',
        email     : fields.email?.trim()      || '',
        address   : fields.address?.trim()    || '',
        service   : fields.service            || '',
        message   : fields.message?.trim()    || '',
        photo_urls: photoUrls,
      });
      console.log('Resend result:', emailResult.status, emailResult.body);
    } catch (err) {
      // Don't fail the whole submission just because the email failed —
      // the lead is already saved. Just log it so it shows up in Vercel logs.
      console.error('Email notify failed:', err.message);
    }

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Submit error:', err.message);
    return res.status(500).json({ error: err.message || 'Server error. Please try again or call (951) 573-2144.' });
  }
};
