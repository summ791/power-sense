# Power Sense

Power Sense is an electricity bill and consumption analysis portal for reviewing real PDF/image bills without creating an account. It extracts readable bill text in the browser, presents editable fields for verification, stores session-scoped records, visualises consumption history, and creates transparent next-month estimates.

## Features

- Real PDF text extraction and browser OCR for JPG, JPEG, and PNG bills using `pdfjs-dist` and `tesseract.js`.
- Editable extraction review for consumer details, readings, units, charges, dates, tariff and total amount.
- Meter-reading validation with a calculated units check and mismatch warning.
- Consumption history, monthly usage and bill charts using actual saved data.
- Trend-based next-month consumption and indicative bill-range prediction with documented method, MAE and MAPE when enough history exists.
- Session-based bill history with search, edit and delete.
- Supabase PostgreSQL, private Storage and row-level security when configured; local browser persistence is available for preview mode.
- Responsive, accessible utility-board presentation with no login or registration.

## Technology stack

React, TypeScript, Vite, Tailwind CSS, Recharts, Supabase JS, Supabase PostgreSQL, Supabase Storage, `pdfjs-dist`, and `tesseract.js`.

## Local installation

```bash
pnpm install
cp .env.example .env
pnpm dev
```

Open the Vite URL shown in the terminal. The project can be previewed without Supabase keys; in that mode bills are stored in `localStorage` for the current browser only.

## Supabase setup

1. Create a Supabase project.
2. Open the SQL Editor and run [`supabase/migrations/001_power_sense.sql`](supabase/migrations/001_power_sense.sql).
3. Copy the project URL and public anonymous key into `.env` as `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`.
4. Restart Vite after changing `.env`.

The migration creates the `bills` table, indexes, a private `electricity-bills` bucket, and RLS policies. A browser session UUID is sent as `x-session-id` and is used to scope both rows and file paths. The service-role key is never used in the frontend.

### Database model

`bills` stores consumer details, dates, meter readings, consumption, charges, total amount, tariff metadata, source file path, OCR confidence, and timestamps. The migration indexes session ID, billing date and consumer number.

## OCR process

PDFs with a selectable text layer are parsed with `pdfjs-dist`. Images are passed to `tesseract.js` for real OCR in the browser. The parser accepts common label variants such as Previous Reading, Opening Reading, Present Reading, Units Consumed, Energy Charge, Amount Payable and Net Payable. Because utility bills vary, the result is always shown as an editable form and should be verified before saving.

Scanned/image-only PDFs currently surface a clear message asking for a clear image export. This avoids pretending that an unreadable PDF was successfully processed. A production deployment can extend the same `extractBillText` service with a Supabase Edge Function that rasterises PDF pages before Tesseract processing.

## Prediction methodology

With fewer than two bills, the portal does not claim a reliable prediction. With two or three bills it uses a weighted average. With four or more it uses a least-squares linear trend across chronological consumption values. The range expands with observed historical variation. When enough history exists, the portal back-tests the same forecast method and reports mean absolute error (MAE) and mean absolute percentage error (MAPE). Bill estimates apply an extensible indicative slab tariff, fixed charge and tax; they are not official bills.

## Test and build

```bash
pnpm test
pnpm check
pnpm build
```

`pnpm build` creates a Vite production bundle and the static host server bundle supplied by the WebDev scaffold.

## Deployment

For Vercel, Netlify or Cloudflare Pages, deploy the Vite output with the existing project configuration, set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as public build-time environment variables, and configure SPA fallback to `index.html`. Supabase remains the only application backend. Never expose a service-role key.

## Privacy and limitations

No login is required. A random browser session ID associates records with the current session. With Supabase configured, uploaded source files are private and protected by Storage policies. With preview mode, records and files stay in the browser session. OCR and prediction results are estimates and should be verified against the official bill and provider tariff.

## Troubleshooting

- **OCR confidence is low:** upload a higher-resolution scan with good contrast and minimal skew.
- **PDF cannot be read:** export the page as a clear PNG/JPG or configure a server-side rasterisation function as described above.
- **Supabase permission error:** rerun the migration and confirm the anonymous key is from the same project; check that the `x-session-id` header is allowed by the RLS policies.
- **No saved history:** confirm that the browser has not cleared local storage when using preview mode, or inspect the Supabase `bills` table.
- **Build errors after dependency changes:** run `pnpm install`, then `pnpm check` and `pnpm build`.
