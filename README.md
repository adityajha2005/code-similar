# Code Similarity Detector

A monochrome Next.js MVP for scanning GitHub repositories and surfacing similar code across JavaScript, TypeScript, and Python files.

## What it does

- Accepts multiple GitHub repository URLs
- Indexes supported source files and filters unsupported content
- Scores similarity with token-based, structure-aware, semantic, or hybrid matching
- Highlights repeated code blocks side by side
- Groups similar files into duplicate clusters
- Flags suspiciously similar matches
- Includes seeded sample repositories for quick testing

## Tech stack

- Next.js App Router
- TypeScript
- Tailwind CSS v4
- Native GitHub REST API fetches for repository ingestion
- A local modular similarity engine in `lib/similarity/engine.ts`

## Getting Started

Run the development server:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Notes

- ZIP upload support was intentionally removed from this MVP scope.
- Public GitHub repositories are fetched through the GitHub API and may be subject to rate limits.
- The semantic mode uses lightweight identifier-intent vectors rather than external embeddings, which keeps the app dependency-free.

## Project structure

- `app/page.tsx`: entry page
- `app/api/scan/route.ts`: scan endpoint
- `components/similarity-workbench.tsx`: dashboard, scan, results, and insights UI
- `lib/github.ts`: GitHub ingestion helpers
- `lib/sample-data.ts`: seeded repositories
- `lib/similarity/engine.ts`: normalization, scoring, clustering, and block matching

## Future extensions

- Add persistent scan history with SQLite or PostgreSQL
- Add export to JSON or PDF
- Replace the lightweight structural analysis with Tree-sitter-backed parsers
- Swap semantic vectors for true embedding models when external services are available
