# Quran Digital — Versioning Guide

This project uses **Semantic Versioning (SemVer)** for both the frontend and backend, tracked independently.

## Current Versions

| Project  | Version | File                    |
|----------|---------|-------------------------|
| Frontend | `0.0.0` | `frontend/package.json` |
| Backend  | `0.0.0` | `backend/package.json`  |

---

## Version Format: `MAJOR.MINOR.PATCH`

| Part      | Meaning                                                                     |
|-----------|-----------------------------------------------------------------------------|
| `MAJOR`   | Breaking changes (auth overhaul, API contract change, DB migration)         |
| `MINOR`   | New feature (new page, new component, new endpoint)                         |
| `PATCH`   | Bug fix, style fix, refactor, copy change, performance tweak                |

---

## Rules

1. **Every code change = version bump** in the relevant `package.json`
2. Frontend and backend are versioned **independently**
3. **PATCH resets to 0** when MINOR bumps; **MINOR resets to 0** when MAJOR bumps
4. Do **not** update root `package.json` version — it is not tracked

### Quick Guide

```
Bug fix / style change   → PATCH  (0.0.0 → 0.0.1)
New feature              → MINOR  (0.0.1 → 0.1.0)
Breaking change          → MAJOR  (0.1.0 → 1.0.0)
```

---

## For Agents

See `.agent/workflows/versioning.md` for the full agent workflow and checklist.
