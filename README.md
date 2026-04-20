# Job Date Finder

Detects when a job was posted — even when the site hides it. Reads raw HTML source across 4 hidden data layers, using a serverless function as a proxy to bypass browser CORS restrictions.

## How it works

The browser can't fetch arbitrary external URLs due to CORS. So the frontend calls a **Netlify serverless function** (`netlify/functions/fetch-job.js`) which runs on Node.js server-side, fetches the raw HTML of the job URL, and parses it across 4 layers:

| Layer | What it reads | Example |
|-------|--------------|---------|
| 1 | JSON-LD structured data | `<script type="application/ld+json">` with `"datePosted"` |
| 2 | HTML meta tags | `<meta property="article:published_time">` |
| 3 | Microdata / time elements | `itemprop="datePosted"`, `<time datetime="...">` |
| 4 | URL date patterns | `/jobs/2026/04/05/engineer` |

## Deploy to Netlify (2 minutes)

1. Push this repo to GitHub
2. Go to netlify.com → Add new site → Import from Git
3. Select your repo — build settings are auto-detected from netlify.toml
4. Click Deploy site

### Local development

```bash
npm install
npx netlify dev
# Visit http://localhost:8888
```

## Why not GitHub Pages?

GitHub Pages only hosts static files — it can't run the Node.js serverless function. Netlify hosts both together for free.

## Project structure

```
job-date-finder/
├── netlify/
│   └── functions/
│       └── fetch-job.js     <- serverless proxy (Node.js, zero dependencies)
├── public/
│   ├── index.html
│   ├── css/style.css
│   └── js/app.js
├── netlify.toml
├── package.json
└── README.md
```
