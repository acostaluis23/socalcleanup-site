# SoCal Cleanup & Hauling — Website

Business website for **SoCal Cleanup & Hauling**, a junk removal and yard cleanup service based in Yorba Linda & Orange County, CA.

## 🌐 Live Site
- Production: https://socalcleanup-site.vercel.app (custom domain: socalcleanupandhauling.com)
- Admin dashboard: `/admin.html` (login required)

## 📋 Pages & Sections
- **Hero** — Tagline, CTA buttons, trust indicators, photo slideshow
- **Services** — Junk Removal, Garage Cleanouts, Yard Cleanup, Furniture Hauling, Pet Waste, Moving Cleanups
- **Gallery** — Before/after job photos
- **Pricing & Service Area** — Pricing guide + cities served
- **Why Us** — Owner-operated, same-day, free quotes, no hidden fees
- **Quote Form** — Name, phone, email, address, service type, **preferred date**, message, photo upload (up to 6 photos)
- **Admin** (`admin.html`) — Sergio's lead dashboard: search/filter, status tracking, private notes, photo viewer, preferred date

## 🛠️ Tech Stack
- Static HTML/CSS/JS — no framework, no build step
- **Vercel** — hosting + serverless function (`api/submit.js`)
- **Supabase** — Postgres (`leads` table), Auth (admin login), Storage (`lead-photos` bucket)
- **flatpickr** — date picker for the Preferred Date field (loaded from jsDelivr CDN)
- **Cloudflare Turnstile** — bot protection on the quote form (plus a honeypot field)
- **Resend** — email notification to Sergio on each new lead

## 🔄 How a Quote Request Flows
1. Customer fills out the form. Photos are compressed in the browser and uploaded straight to Supabase Storage.
2. The form posts the text fields + photo paths to `/api/submit`.
3. `api/submit.js` verifies Turnstile, validates/sanitizes the fields, inserts a row into `leads` (service-role key), and emails Sergio via Resend.
4. Sergio signs in at `/admin.html` to view and manage leads.

## 🗄️ Database
`leads` table columns used by the app: `id`, `created_at`, `first_name`, `last_name`, `phone`, `email`, `address`, `service`, `message`, `preferred_date` (date, optional), `photo_urls` (array of storage paths), `status`, `notes`.

Adding the preferred date column (run once in the Supabase SQL editor):

```sql
alter table leads add column preferred_date date;
```

Row Level Security should allow only the `authenticated` role to select/update/delete `leads`. Inserts happen server-side with the service key. Public sign-ups should be disabled so only Sergio's account can log in.

## 🔐 Environment Variables (Vercel → Project Settings → Environment Variables)
| Name | Purpose |
|---|---|
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_KEY` | Service-role key (server only — never put in client code) |
| `TURNSTILE_SECRET` | Cloudflare Turnstile secret key |
| `RESEND_API_KEY` | Resend API key |
| `NOTIFY_TO` | *(optional)* comma-separated recipients; defaults to Sergio + Luis. Set this to your own email when testing. |

## 💻 Run Locally
Requires Node.js and the [Vercel CLI](https://vercel.com/docs/cli) (`npm i -g vercel`).

1. Create `.env.local` in the project root (it must be in `.gitignore`):
   ```
   SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   SUPABASE_SERVICE_KEY=your-service-role-key
   TURNSTILE_SECRET=1x0000000000000000000000000000000AA
   RESEND_API_KEY=your-resend-key
   NOTIFY_TO=you@example.com
   ```
   The Turnstile secret above is Cloudflare's official always-passes **test** secret.
2. For local testing only, temporarily change `data-sitekey` in `index.html` to Cloudflare's test site key `1x00000000000000000000AA` (or add `localhost` to the widget's allowed hostnames in the Cloudflare dashboard). **Change it back before committing.**
3. Run `vercel dev` and open http://localhost:3000 (admin at http://localhost:3000/admin.html).
4. Submit the form and check: new row in Supabase → `leads`, email arrives at `NOTIFY_TO`, lead shows in the admin dashboard.

Note: opening `index.html` directly from disk or with a plain static server won't work for submissions, because `/api/submit` only runs under `vercel dev` or on Vercel.

## 🚀 Deploy
Push to GitHub; Vercel builds automatically. Pushing to a branch other than `main` creates a Vercel **preview** URL you can test before merging. Run any SQL changes in Supabase *before* deploying code that depends on them.

## ✅ To-Do
- [ ] Add Instagram link
- [ ] Consider adding an `updated_at` column and a "scheduled for" filter/sort in the admin dashboard

## 📞 Business Contact
- Phone: (951) 573-2144
- Email: alvarez_sergio1997@outlook.com
- Instagram:
