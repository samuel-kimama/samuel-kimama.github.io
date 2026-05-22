# personal-site

Astro single-page portfolio site configured for free GitHub Pages hosting at the root URL, suitable for a user-site repo like `samuel-kimama.github.io` with optional custom domain support.

## Structure

- `#home` hero and overview
- `#about` profile and strengths
- `#projects` selected initiatives
- `#resume` detailed experience, technologies, and education

The layout keeps the compact single-page navigation feel from `vmello.com`, adds a dedicated projects section, and uses a richer editorial portfolio presentation inspired by the referenced Astro theme.

## Local development

```bash
npm install
npm run dev
```

## Customization

Edit site content in [`src/data/site.ts`](./src/data/site.ts).

The resume has also been serialized into YAML at [`src/data/resume.yaml`](./src/data/resume.yaml).

Set your production URL in `.env` for local parity:

```bash
PUBLIC_SITE_URL=https://your-domain.com
```

## Versioning and releases

This repo uses [Conventional Commits](https://www.conventionalcommits.org/) for automated semantic versioning via a custom GitHub Actions workflow.

### Commit types and version bumps

| Commit prefix | Version bump | Triggers release? |
|---|---|---|
| `feat:` | minor (0.x.0) | yes |
| `feat!:` / `BREAKING CHANGE:` | major (x.0.0) | yes |
| `fix:`, `perf:`, `refactor:`, `docs:`, `style:`, `test:` | patch (0.0.x) | yes |
| `build:`, `chore:` | none | no |

### Release flow

1. Commit to `main` using conventional commit messages.
2. The `release` workflow inspects commits since the last tag. If any releasable commit exists, it bumps `package.json`, creates a version tag, and publishes a GitHub Release with a grouped changelog.
3. `build:` and `chore:` commits are tracked in git history but never trigger a release.

The site deploys on every push to `main`. Releases tag a versioned snapshot with a changelog.

## Deploy to GitHub Pages

This configuration assumes the published repository is the user-site repository:

- `samuel-kimama.github.io`

That root-repo layout is what lets both URLs work correctly from the same build:

- `https://samuel-kimama.github.io`
- `https://your-domain.com`

1. Push to the `main` branch.
2. Publish this code from the `samuel-kimama.github.io` repository, not the `personal-site` project repo.
3. In GitHub, open `Settings -> Pages`.
4. Set `Source` to `GitHub Actions`.
5. Optional: add a repository variable named `PUBLIC_SITE_URL` with your final custom-domain URL, such as `https://your-domain.com`.
6. Optional: update [`public/CNAME`](./public/CNAME) with your actual domain when you want to enable or change the custom domain.
7. Configure DNS for your domain in your registrar.

Without a custom domain, the site deploys under `https://samuel-kimama.github.io`.

If you deploy this exact config from `personal-site` instead of `samuel-kimama.github.io`, asset paths will be wrong because this build no longer uses a `/personal-site/` base.
