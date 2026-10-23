This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Development

```bash
npm run dev     # local dev server
npm run build   # production build
npm run lint    # eslint
npm test        # pipeline + lib unit tests (needs Node 22.18+, which strips
                # the types in lib/*.test.ts without a build step)
```

## Feeds and crawlable endpoints

| Path                 | What it is                                                          |
| -------------------- | ------------------------------------------------------------------- |
| `/rss.xml`           | RSS 2.0 feed of the latest articles. Consumed by Spin Detector.      |
| `/sitemap.xml`       | Every page, for the general crawler.                                 |
| `/news-sitemap.xml`  | Google News sitemap — articles from the last 48 hours only.          |
| `/og.png`            | Default 1200×630 social card.                                        |
| `/article/<slug>/og.png` | Per-article social card.                                        |
| `/logo.png`          | 600×60 publisher logo named by the site's structured data.           |

Articles live at `/article/<headline-slug>-<id>`. The id is the lookup key, so a
re-worded headline changes the URL without orphaning the page; the old URL —
including the bare `/article/<id>` form the site used to serve — 308-redirects
to the current one. See `lib/slug.ts`.

Submitting the site to Google News is documented in
[`docs/google-news-submission.md`](docs/google-news-submission.md).

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
