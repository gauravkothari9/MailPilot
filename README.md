# MailPilot: MERN email marketing platform

Self-hosted email marketing for multiple businesses: import contacts from Excel, send personalized campaigns through your own email accounts, and track every email.

**Stack:** MongoDB · Express · React (Vite) · Node.js

## Features

**Businesses & senders**
- Several businesses in one workspace, each with its own senders, contacts, lists, campaigns and reports
- Connect any SMTP account (Gmail, Outlook, Microsoft 365, Zoho, Hostinger, GoDaddy, SendGrid, Brevo, Mailgun, Amazon SES, or custom). Presets and setup hints are built in.
- Speed (emails/min) and daily limit per sender; sending pauses at the limit and resumes the next day
- Deliverability checker: SPF, DKIM, DMARC and MX DNS checks with fix instructions
- SMTP passwords encrypted at rest (AES-256-GCM)

**Contacts**
- Excel / CSV import (.xlsx, .xls, .csv) with automatic column matching, preview, multi-sheet support, de-duplication and invalid-email report
- Extra columns are kept as custom fields, so they work as merge tags (`{{city}}`) and segment filters
- Lists, tags, bulk actions (add to list, tag, unsubscribe, delete), CSV export
- 0–100 engagement score per contact from opens, clicks and recency; full email and activity history per contact

**Campaigns**
- HTML editor with live desktop/mobile preview using real contact data
- Personalization: `{{first_name}}`, `{{company}}`, any Excel column, fallbacks (`{{first_name|there}}`)
- Segments: list + rules (field is / contains / empty… , has tag)
- **A/B subject testing**: send A and B to a test slice, then the winning subject (by opens or clicks) goes to everyone else automatically after the wait time; you can also pick the winner manually
- Schedule for later, pause / resume / stop, retry failed sends
- Follow-up campaigns to **non-openers** or **non-clickers** in one click
- Template library (4 built-in + save your own)
- Spam & content checker (trigger words, caps, image/text ratio, link shorteners, placeholders…)
- Autosave

**Tracking**
- Delivered / failed / skipped for every recipient, with SMTP error messages
- Opens (tracking pixel), clicks per link (redirect tracking), unsubscribes (one-click, RFC 8058 `List-Unsubscribe` header)
- **Bot filtering**: security scanners and link prefetchers are recorded but kept out of your stats
- Hard bounces (5xx) are marked and skipped in future campaigns
- Live activity feed, per-recipient timeline, hourly engagement chart, device breakdown, best-time-to-send heatmap
- CSV export of recipients for any filter (opened, not opened, clicked, failed…)

## Requirements

- Node.js 22.13 or newer
- MongoDB 6+ (local install, or a free MongoDB Atlas cluster)

## Setup

```bash
npm run install:all
```

Settings live in `server/.env` (already created with random secret keys; see `server/.env.example`):

| Variable | Meaning |
|---|---|
| `MONGODB_URI` | MongoDB connection string |
| `PORT` | API port (default 5000) |
| `PUBLIC_URL` | Public address of the server, used in tracking and unsubscribe links (can also be set in the app under Settings) |
| `ENCRYPTION_KEY` | 64 hex chars; encrypts SMTP passwords. **Back it up and never change it** after adding senders, or saved passwords can't be decrypted |
| `JWT_SECRET` | Signs login sessions |

## Run

**Development** (API on :5000 and React on :5173 with hot reload):

```bash
npm run dev
```

Open http://localhost:5173. The first visit asks you to create the admin account.

**Production** (one server on :5000 serving the built React app):

```bash
npm run build
npm start
```

## Important: tracking needs a public URL

Opens, clicks and unsubscribe links point to `PUBLIC_URL`. While that is `localhost`, emails still send, but recipients' email apps can't reach your computer, so **opens and clicks won't be recorded**. To fix this:

- **Testing:** run a tunnel, e.g. `ngrok http 5000`, and paste the https URL into **Settings → Public URL**
- **Production:** deploy (Render, Railway, a VPS, etc.), set `MONGODB_URI` to MongoDB Atlas, and set the public URL to your domain

## Sending tips

- **Gmail**: turn on 2-Step Verification and use an **App Password** (myaccount.google.com/apppasswords). The limit is about 500/day (2,000 on Workspace).
- For volume, use your own domain with SPF, DKIM and DMARC set up (check it with **Sender emails → Deliverability**), or a sending service such as Amazon SES, SendGrid or Brevo.
- Only email people who agreed to hear from you. Every email includes an unsubscribe link, and your business address goes in the footer (required by CAN-SPAM / GDPR).
- Open rates are estimates: Apple Mail Privacy Protection pre-loads images, and some people block them. Clicks are the more reliable signal.

## Project structure

```
server/src/
  index.js                 Express app, Mongo connection, worker start
  models/index.js          Mongoose schemas
  routes/                  auth, businesses+senders, contacts+lists+import, campaigns, templates, analytics, tracking (public)
  services/mailer.js       rendering, personalization, tracking injection, throttled send queue
  services/audience.js     lists, follow-up audiences, segment rules
  services/abtest.js       A/B variant stats and winner selection
  services/deliverability.js  SPF/DKIM/DMARC/MX checks
client/src/
  pages/                   Dashboard, Campaigns, CampaignEditor, CampaignReport, Contacts, Lists, Templates, Senders, Activity, Businesses, Settings
  components/              UI kit, charts, import wizard, contact modal, segment builder
  contentCheck.js          spam & content checker
```
