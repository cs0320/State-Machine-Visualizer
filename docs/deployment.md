# Deploying to GitHub Pages

This is a static Vite/React SPA — `npm run build` produces `dist/`, and that's the entire
deployment artifact (no server, no environment variables, no database). It's deployed as a GitHub
Pages **project page** — served at `https://cs32.github.io/State-Machine-Visualizer/`, not the
domain root — via the GitHub Actions workflow at `.github/workflows/deploy.yml`.

## How it works

On every push to `main`, the workflow:

1. Installs dependencies, runs `npm run lint`, `npm run test`, and `npm run build` — a broken
   build or failing check blocks the deploy.
2. Uploads `dist/` as a Pages artifact and publishes it via `actions/deploy-pages`.

Because this is a project page and not an org/user root page, `vite.config.ts` sets
`base: '/State-Machine-Visualizer/'` for the production build (the dev server still serves from
`/`) — without it, every asset URL in the built `index.html` would 404 once deployed, since the
site doesn't live at the domain root. **If the repo is ever renamed after moving into the org,
this `base` value has to be updated to match**, or the deployed page will load a blank white
screen with 404s in the console for every JS/CSS asset.

## One-time setup (do this once, per repo, after it's transferred into the org)

1. **Transfer the repo into the `cs32` org.** GitHub Settings → General → Danger Zone → Transfer
   ownership, on the current repo. This needs to be done by someone with admin rights on this repo
   *and* the ability to create repos in the `cs32` org — not something scriptable from here.
2. **Enable Pages with GitHub Actions as the source.** The workflow passes `enablement: true` to
   `actions/configure-pages`, which tries to flip this on for you via the API on first run — so
   this step is often unnecessary. If the `configure-pages` step still fails with "Get Pages site
   failed" / "Not Found" (this can happen if Pages is disabled at the org level, or the repo's
   Settings → Actions → General → Workflow permissions aren't set to allow Actions to manage
   Pages), do it manually instead: Settings → Pages → Build and deployment → Source →
   **GitHub Actions**. Don't pick "Deploy from a branch" either way — this workflow pushes
   directly via the Pages deployment API, no `gh-pages` branch involved.
3. **If the repo is private:** GitHub Pages for private repos requires GitHub Team or Enterprise
   Cloud on the org (a plain free/Pro org doesn't unlock it) — confirm the `cs32` org has that
   before assuming a private repo can serve a public Pages site. If it can't, the repo needs to be
   public for Pages to work at all.
4. Push to `main` (or re-run the workflow manually via Actions → Deploy to GitHub Pages → Run
   workflow) to trigger the first deploy.

## Verifying a deploy locally first

```bash
npm run build
npm run preview   # serves dist/ at http://localhost:4173
```

`vite preview` doesn't apply the production `base` path the same way a real Pages deploy does, so
this is a sanity check on the build output (minified, no dev-server conveniences) — not a full
stand-in for the deployed URL.
