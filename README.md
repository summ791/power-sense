# Power Sense

Power Sense is an electricity-bill and consumption-analysis portal. Users sign in with email and password, review real PDF/image bills, visualize their own usage history, and view transparent next-month estimates. Saved records and source documents are account-scoped.

## Features

- Email/password sign-up, login, logout, profile name updates, and password reset.
- Real PDF text extraction and browser OCR for selectable-text and scanned PDFs, plus JPG, JPEG, and PNG bills using `pdfjs-dist` and `tesseract.js`.
- Editable extraction review for consumer details, readings, units, charges, dates, tariff and total amount.
- Meter-reading validation with a calculated units check and mismatch warning.
- Account-specific bill history with search, edit, delete, and CSV/JSON export.
- Consumption history, monthly usage, and bill charts using saved data.
- Trend-based next-month consumption and indicative bill-range prediction with documented method, MAE, and MAPE when enough history exists.
- Supabase PostgreSQL and private Storage protected with row-level security; all bill rows and source files are owned by the authenticated user.
- Responsive, accessible utility-board presentation.

## Technology stack

React, TypeScript, Vite, Tailwind CSS, Recharts, Supabase JS, Supabase PostgreSQL, Supabase Storage, `pdfjs-dist`, and `tesseract.js`.

## Local installation

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the public values for the Supabase project. Authentication is required for bill analysis and saved data; the app does not fall back to local anonymous storage.

## Supabase setup

For a new project, apply migrations in order:

1. [`supabase/migrations/001_power_sense.sql`](supabase/migrations/001_power_sense.sql) creates the bill table, private `electricity-bills` bucket, and the original policies.
2. [`supabase/migrations/002_user_owned_auth.sql`](supabase/migrations/002_user_owned_auth.sql) makes `user_id` required, removes anonymous `session_id` ownership, and replaces row/file policies with `auth.uid()` ownership.

The second migration requires the old anonymous rows to be safely migrated to a verified owner or removed first. It is safe to apply to an empty `bills` table. For existing records, never assign ownership based on browser identity without explicit owner confirmation.

Configure Supabase Auth's email provider and URL settings:

- Set the Site URL to the production origin.
- Allow the production origin and `/reset-password` redirect, plus the local development origin when testing locally.
- Configure a reliable SMTP provider for production email confirmation and password-reset delivery.

Only the public project URL and publishable/anonymous key belong in the browser environment. Never expose a service-role key in the frontend.

### Database and Storage ownership

`public.bills.user_id` references `auth.users.id` and is non-null. RLS restricts reads, inserts, updates, and deletes to `auth.uid()`. Private files are stored under `{user_id}/{bill_id}-{filename}` and Storage policies restrict upload/read/delete to the matching authenticated user folder.

## OCR process

PDFs with a selectable text layer are parsed with `pdfjs-dist`. Scanned PDFs and images are rendered and passed to `tesseract.js` for real OCR in the browser. The parser accepts common label variants such as Previous Reading, Opening Reading, Present Reading, Units Consumed, Energy Charge, Amount Payable, and Net Payable. Because utility bills vary, extracted results are shown as an editable form and should be verified before saving.

## Prediction methodology

With fewer than two bills, the portal does not claim a reliable prediction. With two or three bills it uses a weighted average. With four or more it uses a least-squares linear trend across chronological consumption values. The range expands with observed historical variation. When enough history exists, the portal back-tests the same forecast method and reports mean absolute error (MAE) and mean absolute percentage error (MAPE). Bill estimates apply an extensible indicative slab tariff, fixed charge and tax; they are not official bills.

## Test and build

```bash
pnpm test
pnpm check
pnpm build
```

## Deployment

The existing Vercel project builds the Vite output and uses `vercel.json` rewrites for direct application and Auth routes. Ensure the public `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` build variables are set. Supabase is the only application backend.

## Privacy and limitations

A user must sign in to access the application. Database row-level security and private Storage policies enforce account ownership independently of client-side filters. Signed source-file links are short-lived. OCR and prediction results are estimates and should be checked against the official bill and applicable tariff.

## Troubleshooting

- **Email confirmation/reset link does not return to Power Sense:** add the production origin and `/reset-password` to Supabase Auth's allowed redirect URLs.
- **Auth emails are delayed or not delivered:** configure custom SMTP in Supabase Auth for production use.
- **Storage or bill permission error:** confirm migrations are applied, the user is signed in, and the private Storage folder begins with that user's Auth UUID.
- **OCR confidence is low:** upload a higher-resolution scan with good contrast and minimal skew.
- **Build errors after dependency changes:** run `pnpm install`, then `pnpm check` and `pnpm build`.
