// api/notify.js
// Called by Supabase webhook on every new lead INSERT
// Sends an email notification via Resend

module.exports = async function handler(req, res) {
  // Only accept POST
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Supabase sends the new row under req.body.record
  const lead = req.body?.record;
  if (!lead) {
    return res.status(400).json({ error: 'No record in payload' });
  }

  const {
    first_name, last_name, phone, email,
    address, service, message, photo_urls, created_at
  } = lead;

  const name = [first_name, last_name].filter(Boolean).join(' ') || 'Unknown';
  const date = new Date(created_at).toLocaleString('en-US', {
    timeZone: 'America/Los_Angeles',
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', hour12: true
  });

  const photoCount = (photo_urls || []).length;
  const photosLine = photoCount > 0
    ? `<p style="margin:0 0 8px"><strong>📷 Photos:</strong> ${photoCount} photo${photoCount > 1 ? 's' : ''} attached (view in admin dashboard)</p>`
    : `<p style="margin:0 0 8px;color:#888"><strong>Photos:</strong> None submitted</p>`;

  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="margin:0;padding:0;background:#f4f4f0;font-family:'Helvetica Neue',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f0;padding:32px 16px;">
    <tr><td align="center">
      <table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 16px rgba(0,0,0,0.08);">

        <!-- Header -->
        <tr>
          <td style="background:#1a5c1a;padding:24px 32px;">
            <p style="margin:0;font-size:11px;letter-spacing:2px;text-transform:uppercase;color:rgba(255,255,255,0.6);">New Lead</p>
            <h1 style="margin:6px 0 0;font-size:22px;font-weight:700;color:#ffffff;">SoCal Cleanup & Hauling</h1>
          </td>
        </tr>

        <!-- Alert bar -->
        <tr>
          <td style="background:#f5a623;padding:12px 32px;">
            <p style="margin:0;font-size:14px;font-weight:700;color:#0d0d0d;">🚛 New quote request received — ${date}</p>
          </td>
        </tr>

        <!-- Body -->
        <tr>
          <td style="padding:28px 32px;">

            <!-- Contact -->
            <h2 style="margin:0 0 16px;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#888;border-bottom:1px solid #eee;padding-bottom:8px;">Contact Info</h2>
            <p style="margin:0 0 8px"><strong>👤 Name:</strong> ${name}</p>
            <p style="margin:0 0 8px"><strong>📞 Phone:</strong> <a href="tel:${phone}" style="color:#1a5c1a;font-weight:700;">${phone || '—'}</a></p>
            ${email ? `<p style="margin:0 0 8px"><strong>✉️ Email:</strong> <a href="mailto:${email}" style="color:#1a5c1a;">${email}</a></p>` : ''}
            <p style="margin:0 0 24px"><strong>📍 Address:</strong> ${address || '—'}</p>

            <!-- Job -->
            <h2 style="margin:0 0 16px;font-size:13px;letter-spacing:1.5px;text-transform:uppercase;color:#888;border-bottom:1px solid #eee;padding-bottom:8px;">Job Details</h2>
            <p style="margin:0 0 8px"><strong>🔧 Service:</strong> ${service || 'Not specified'}</p>
            ${message
              ? `<p style="margin:0 0 8px"><strong>💬 Message:</strong></p>
                 <p style="margin:0 0 16px;padding:12px 16px;background:#f9f9f9;border-left:3px solid #1a5c1a;border-radius:4px;color:#333;line-height:1.6;">${message}</p>`
              : `<p style="margin:0 0 16px;color:#888"><strong>Message:</strong> None provided</p>`
            }
            ${photosLine}

            <!-- CTA -->
            <div style="margin-top:28px;text-align:center;">
              <a href="https://socalcleanup-site.vercel.app/admin.html"
                 style="display:inline-block;padding:14px 32px;background:#1a5c1a;color:#ffffff;text-decoration:none;border-radius:8px;font-weight:700;font-size:15px;letter-spacing:0.5px;">
                View in Admin Dashboard →
              </a>
            </div>

          </td>
        </tr>

        <!-- Footer -->
        <tr>
          <td style="padding:16px 32px;background:#f9f9f9;border-top:1px solid #eee;">
            <p style="margin:0;font-size:12px;color:#aaa;text-align:center;">
              SoCal Cleanup & Hauling · Yorba Linda, CA · (951) 573-2144
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: 'SoCal Cleanup <onboarding@resend.dev>',
        to: ['acostaluis23@gmail.com'],
        subject: `🚛 New Lead: ${name} — ${service || 'Quote Request'}`,
        html,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Resend error:', data);
      return res.status(500).json({ error: 'Failed to send email', details: data });
    }

    return res.status(200).json({ success: true, id: data.id });
  } catch (err) {
    console.error('Notify error:', err);
    return res.status(500).json({ error: err.message });
  }
};
