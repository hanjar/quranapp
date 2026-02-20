---
description: Versioning rules for Quran Digital frontend and backend - must be followed on every change
---

# Versioning Rules - Quran Digital

## Semantic Versioning Format: `MAJOR.MINOR.PATCH`

| Part      | When to Bump                                                               |
|-----------|----------------------------------------------------------------------------|
| **MAJOR** | Breaking changes, major UI overhaul, API contract changes                  |
| **MINOR** | New feature added (UI component, new API endpoint, new page)               |
| **PATCH** | Bug fix, style tweak, typo fix, refactor without new features              |

---

## Scope

There are **two independent versions**:

| Project    | File                          | Starting Version |
|------------|-------------------------------|------------------|
| Frontend   | `frontend/package.json`       | `0.0.0`          |
| Backend    | `backend/package.json`        | `0.0.0`          |

Each version is bumped **independently**. A backend change does not require a frontend version bump, and vice versa.

---

## Rules for All Agents

1. **Every code change must bump the version** in the relevant `package.json`.
   - Frontend-only change → bump `frontend/package.json`
   - Backend-only change → bump `backend/package.json`
   - Full-stack change → bump BOTH

2. **Bump the correct part** of the version:
   - Style fix, bug fix → bump `PATCH` (e.g. `0.1.0` → `0.1.1`)
   - New feature, new page, new endpoint → bump `MINOR` (e.g. `0.1.1` → `0.2.0`)
   - Breaking change (API contract, DB migration, auth change) → bump `MAJOR` (e.g. `0.2.0` → `1.0.0`)

3. **PATCH resets to 0** when MINOR is bumped. **MINOR resets to 0** when MAJOR is bumped.

4. **Version must be updated in the same commit or PR** as the change itself. Never update version without a change, and never make a change without updating the version.

5. **Do NOT update `version` in the monorepo root `package.json`** — it is not versioned.

---

## How to Update

### Frontend
1. Edit `frontend/package.json` → bump `"version"` field
2. Edit `frontend/src/app/version.ts` → update `frontend` value to match

### Backend
1. Edit `backend/package.json` → bump `"version"` field
2. Edit `frontend/src/app/version.ts` → update `backend` value to match

> **Note:** `version.ts` drives the version badge in the UI bottom bar. Always keep it in sync.

---

## Examples

| Change Type                          | Scope    | Old Version | New Version |
|--------------------------------------|----------|-------------|-------------|
| Fix ayah number alignment            | Frontend | `0.0.0`     | `0.0.1`     |
| Add Surah search feature             | Frontend | `0.0.1`     | `0.1.0`     |
| Fix bookmark API returning 500 error | Backend  | `0.0.0`     | `0.0.1`     |
| Add new `/api/v1/tafsir` endpoint    | Backend  | `0.0.1`     | `0.1.0`     |
| Redesign auth flow (breaking)        | Both     | FE `0.1.0` / BE `0.1.0` | FE `1.0.0` / BE `1.0.0` |

---

## Verification Checklist (for agents)

Before marking any task complete, verify:
- [ ] Correct `package.json` was updated
- [ ] `frontend/src/app/version.ts` was updated to match
- [ ] Version number was bumped (not same as before)
- [ ] The bump type (PATCH/MINOR/MAJOR) matches the type of change
