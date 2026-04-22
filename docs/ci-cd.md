# CI/CD Guide

This document describes the automated workflows, how to work with them locally, and how to extend them.

---

## Table of Contents

1. [Overview](#overview)
2. [Workflows](#workflows)
   - [CI (ci.yml)](#ci-ciyml)
   - [Docker Publish (docker-publish.yml)](#docker-publish-docker-publishyml)
   - [Desktop Release (release.yml)](#desktop-release-releaseyml)
   - [Selector Probe (selector-probe.yml)](#selector-probe-selector-probeyml)
3. [Running CI Checks Locally](#running-ci-checks-locally)
4. [Coverage Thresholds](#coverage-thresholds)
5. [Dependabot](#dependabot)
6. [Secrets & Permissions](#secrets--permissions)
7. [Adding a New Workflow Step](#adding-a-new-workflow-step)

---

## Overview

```
Push to main  ──► CI (check + docker-smoke) ──► Docker Publish (GHCR)
PR to main    ──► CI (check + docker-smoke)
Push vX.Y.Z   ──► CI ──► Desktop Release (Electron)
                ──► Docker Publish (tagged image)
Nightly cron  ──► Selector Probe (broken-site alert)
```

---

## Workflows

### CI (`ci.yml`)

**Triggers**: push to `main`, pull requests targeting `main`.

**Concurrency**: concurrent runs for the same PR/ref are cancelled so only the latest commit is checked.

| Job | Runs on | Summary |
|-----|---------|---------|
| `check` | `ubuntu-latest` × Node 20 & 22 | Full static analysis + test suite |
| `docker-smoke` | `ubuntu-latest` | Docker build + `/health` liveness probe |

#### `check` job steps

| Step | Command | Purpose |
|------|---------|---------|
| Lint dependencies | `npm run lint:deps:diff -- --skip-security` | Verify new deps comply with TECH_CONSTRAINTS.md |
| Package boundary | `npm run check:package-imports` | No illicit `packages/*` → `src/` imports |
| Route sanitization | `npm run check:route-sanitize` | Error details never leak through route handlers |
| Legacy shim guards | `check:src-shims`, `check:src-routes-shims`, `check:src-adapters-shims` | Guard the monorepo migration shims |
| Security audit | `npm audit --audit-level=high` | Warn (non-blocking) on high/critical CVEs |
| Typecheck backend | `npm run build` | `tsc --noEmit` across all backend workspaces |
| Strict-progress | `npm run check:strict-progress` | `@ts-nocheck` count must not regress past baseline |
| Typecheck UI | `npm run typecheck --workspace @ai-video/app-ui-shell` | Frontend TypeScript |
| Typecheck desktop | `npm run typecheck --workspace @ai-video/app-desktop` | Electron shell TypeScript |
| Test + coverage | `npx vitest run --coverage` | All 2600+ unit tests + coverage threshold enforcement |
| Upload coverage | `actions/upload-artifact@v4` | Coverage report retained 14 days (Node 22 leg only) |

#### `docker-smoke` job steps

Builds the production Docker image from `Dockerfile`, starts it, waits up to 60 s for `GET /health` to respond `200`, then tears it down. Exits non-zero if the container dies before becoming healthy.

---

### Docker Publish (`docker-publish.yml`)

**Triggers**: push to `main`, push of `v*` tags, `workflow_dispatch`.

**Registry**: `ghcr.io` (GitHub Container Registry).

**Image name**: `ghcr.io/<owner>/ai-video`.

#### Tags produced

| Event | Tags |
|-------|------|
| Push to `main` | `latest`, `main`, `sha-<short>` |
| Push `v1.2.3` | `1.2.3`, `1.2`, `1`, `latest`, `sha-<short>` |

#### Platforms

Builds multi-arch (`linux/amd64` + `linux/arm64`) using QEMU + Docker Buildx.

#### Layer caching

Build layers are cached in the GitHub Actions cache (`type=gha`) so only changed layers are rebuilt on each run.

#### Pulling the image

```bash
docker pull ghcr.io/skate0414/ai-video:latest
docker run -d \
  -p 3220:3220 \
  -v /your/data:/data \
  -e GEMINI_API_KEY=your_key \
  ghcr.io/skate0414/ai-video:latest
```

---

### Desktop Release (`release.yml`)

**Triggers**: push of `v*` tags, `workflow_dispatch`.

**Matrix**: builds on Ubuntu 22.04 (Linux), macOS-latest (Mac), Windows-latest (Win).

**Gate**: the `test` job (Ubuntu, Node 22 — typecheck + unit tests) must pass before any platform build starts.

#### Artifacts

Each matrix leg uploads `apps/desktop/release/*` as a GitHub Actions artifact named `desktop-app-<os>`.

For automated GitHub Release asset attachment, set `GITHUB_TOKEN` and configure `electron-builder` to publish (`publish: always`).

---

### Selector Probe (`selector-probe.yml`)

**Triggers**: `cron: '0 18 * * *'` (daily at 02:00 CST), `workflow_dispatch`.

Runs `node scripts/probe-sites.mjs` with Playwright/Chromium to probe the CSS selectors of all registered AI chat sites. If any site is `broken` or `navigation-failed`, a GitHub issue is automatically opened with label `selector-health`.

The probe report JSON is uploaded as the `selector-probe` artifact. Probe results contain:

| Field | Description |
|-------|-------------|
| `id` | Site identifier |
| `status` | `healthy` / `degraded` / `broken` / `navigation-failed` / `probe-error` |
| `healthScore` | 0–100 composite score |
| `broken` | Array of selector keys that failed |

---

## Running CI Checks Locally

Run the full CI gate in one command:

```bash
npm run ci:verify
```

Or run individual checks:

```bash
# Dependency lint
npm run lint:deps:diff -- --skip-security

# Package boundary
npm run check:package-imports

# Route error sanitization
npm run check:route-sanitize

# Shim guards
npm run check:src-shims && npm run check:src-routes-shims && npm run check:src-adapters-shims

# TypeScript (all workspaces)
npm run build
npm run typecheck --workspace @ai-video/app-ui-shell
npm run typecheck --workspace @ai-video/app-desktop

# Tests only (fast feedback)
npm test

# Tests + coverage (enforces thresholds)
npx vitest run --coverage

# Strict-mode progress guard
npm run check:strict-progress
```

---

## Coverage Thresholds

Coverage thresholds are configured in `vitest.config.ts`. The CI `test + coverage` step runs `npx vitest run --coverage` which enforces them automatically.

| Scope | Lines | Functions | Branches | Statements |
|-------|-------|-----------|----------|------------|
| Global | 60% | 60% | 55% | 60% |
| `packages/lib/src/**` | 85% | 90% | 80% | 85% |
| `packages/pipeline-video/src/cir/**` | 85% | 95% | 80% | 85% |
| `packages/pipeline-video/src/stages/**` | 70% | 75% | 55% | 70% |
| `packages/pipeline-core/src/**` | 58% | 58% | 50% | 58% |
| `apps/server/src/routes/**` | 65% | 65% | 55% | 65% |
| `packages/adapter-common/src/**` | 45% | 55% | 30% | 45% |
| `packages/pipeline-core/src/configStore.ts` | 95% | 100% | 95% | 95% |

If a threshold is violated the `check` job fails. To update a threshold after genuinely improving coverage, edit the corresponding entry in `vitest.config.ts`.

---

## Dependabot

Dependabot is configured in `.github/dependabot.yml` and runs weekly (Monday 04:00 CST).

| Ecosystem | Directory | Schedule |
|-----------|-----------|---------|
| npm (root) | `/` | Monday |
| npm (ui-shell) | `/apps/ui-shell` | Monday |
| npm (desktop) | `/apps/desktop` | Tuesday |
| GitHub Actions | `/` | Monday |

Non-major updates within the same group are batched into a single PR. Major version bumps for `electron` and `typescript` are blocked and must be handled manually.

---

## Secrets & Permissions

| Secret | Used by | Description |
|--------|---------|-------------|
| `GITHUB_TOKEN` | All workflows | Automatically injected by GitHub — no setup needed |
| *(none required for CI/CD)* | — | No external API keys are needed to run the CI checks |

To publish to a private registry or deploy to a cloud provider, add the relevant secrets in **Settings → Secrets and variables → Actions**.

---

## Adding a New Workflow Step

1. Edit the relevant `.github/workflows/*.yml` file.
2. If the step requires a new npm script, add it to `package.json` and run it locally first.
3. For a brand-new workflow trigger (e.g. nightly report):
   - Create `.github/workflows/your-workflow.yml`.
   - Use `timeout-minutes` to prevent runaway jobs.
   - Use `actions/upload-artifact@v4` for any file outputs.
   - Add a row to the Overview table at the top of this file.
4. Verify the YAML syntax locally with `actionlint` (install: `brew install actionlint`).
