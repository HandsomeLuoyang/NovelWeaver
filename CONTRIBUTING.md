# Contributing

Thanks for contributing to NovelWeaver.

## Development setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

## Branch and commit conventions

- Base branch: `public-main`
- Branch naming:
  - `feature/<short-name>`
  - `fix/<short-name>`
  - `chore/<short-name>`
- Commit style recommendation:
  - `feat: ...`
  - `fix: ...`
  - `chore: ...`
  - `docs: ...`

## Quality gates

Before opening a PR, run:

```bash
npx tsc --noEmit
npm run build
```

## Sensitive data policy

- Do not commit `.env.*` files (except `.env.example`)
- Do not commit `data/local/` contents
- Do not commit API keys, tokens, or private user content
