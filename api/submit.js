// api/submit.js — Vercel Serverless Function
// Verifies Cloudflare Turnstile token, uploads photos, inserts lead into Supabase

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL      = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;
const TURNSTILE_SECRET  = process.env.TURNSTILE_SECRET;

export const config = {
  api: { bodyParser: false }, // we parse multipart manually
};

// ── Helpers ───────────────────────────────────────────────────────────────────

async function verifyTurnstile(token, ip) {
  const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      secret: TURNSTILE_SECRET,
      response: token,
      remoteip: ip,
    }),
  });
  const data = await res.json();
  return data.success === true;
}

async function parseMultipart(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      const boundary = req.headers['content-type'].split('boundary=')[1];
      if (!boundary) return reject(new Error('No boundary'));

      const parts = body.toString('binary').split('--' + boundary);
      const fields = {};
      const files  = [];

      for (const part of parts) {
        if (!part || part === '--\r\n' || part.trim() === '--') continue;
        const [rawHeader, ...rawBodyParts] = part.split('\r\n\r\n');
        if (!rawHeader) continue;
        const rawBody = rawBodyParts.join('\r\n\r\n').replace(/\r\n$/, '');

        const nameMatch     = rawHeader.match(/name="([^"]+)"/);
        const filenameMatch = rawHeader.match(/filename="([^"]+)"/);
        const ctMatch       = rawHeader.match(/Content-Type:\s*([^\r\n]+)/i);

        if (!nameMatch) continue;
        const name = nameMatch[1];

        if (filenameMatch) {
          files.push({
            fieldname: name,
            filename : filenameMatch[1],
            mimetype : ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
            buffer   : Buffer.from(rawBody, 'binary'),
          });
        } else {
          fields[name] = rawBody;
        }
      }
      resolve({ fields, files });
    });
    req.on('error', reject);
  });
}

// ── Handler ───────────────────────────────────────────────────────────────────

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // 1. Parse form data
    const { fields, files } = await parseMultipart(req);

    // 2. Verify Turnstile
    const token = fields['cf-turnstile-response'];
    if (!token) return res.status(400).json({ error: 'Missing security token' });

    const ip = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '';
    const valid = await verifyTurnstile(token, ip);
    if (!valid) return res.status(400).json({ error: 'Security check failed. Please try again.' });

    // 3. Basic validation
    if (!fields.first_name?.trim()) return res.status(400).json({ error: 'First name is required' });
    if (!fields.phone?.trim())      return res.status(400).json({ error: 'Phone is required' });
    if (!fields.address?.trim())    return res.status(400).json({ error: 'Address is required' });

    // Honeypot check — bots fill this, humans don't see it
    if (fields.website?.trim()) return res.status(200).json({ success: true }); // silently drop

    // 4. Upload photos using service key (bypasses RLS for storage)
    const supabase   = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
    const photoUrls  = [];
    const photoFiles = files.filter(f => f.fieldname === 'photos');

    for (const file of photoFiles) {
      if (file.buffer.length === 0) continue;
      const ext      = file.filename.split('.').pop().toLowerCase();
      const fileName = `${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
      const filePath = `leads/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('lead-photos')
        .upload(filePath, file.buffer, { contentType: file.mimetype });

      if (uploadError) throw new Error('Photo upload failed: ' + uploadError.message);
      photoUrls.push(filePath);
    }

    // 5. Insert lead
    const { error: insertError } = await supabase.from('leads').insert({
      first_name : fields.first_name?.trim(),
      last_name  : fields.last_name?.trim()  || '',
      phone      : fields.phone?.trim(),
      email      : fields.email?.trim()      || '',
      address    : fields.address?.trim(),
      service    : fields.service            || '',
      message    : fields.message?.trim()    || '',
      photo_urls : photoUrls,
    });

    if (insertError) throw new Error('DB insert failed: ' + insertError.message);

    return res.status(200).json({ success: true });

  } catch (err) {
    console.error('Submit error:', err);
    return res.status(500).json({ error: err.message || 'Server error' });
  }
}
