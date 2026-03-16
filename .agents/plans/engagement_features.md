# Engagement Features — Implementation Plan

## Features Overview

1. **Referral Banner** — WhatsApp share to invite rescuers
2. **Milestone Badge** — "Completaste X adopciones" in dashboard
3. **Verified Badge** — Embeddable badge for Instagram bios
4. **Social Proof Feed** — Admin-configurable fake activity counter

---

## 1. Referral Banner (WhatsApp Share)

### What the user sees

A subtle card below the action cards on the homepage:

```
┌──────────────────────────────────────────────────┐
│ 📲                                                │
│ ¿Conocés alguien que necesita dar                │
│ animales en adopción? Invitalo                   │
│                                                   │
│        [📱 Compartir por WhatsApp]                │
│                                     [× Cerrar]   │
└──────────────────────────────────────────────────┘
```

### Implementation

#### [NEW] [ReferralBanner.tsx](file:///c:/dev/test/src/components/ReferralBanner.tsx) (~40 lines)

- Shows only to **logged-in** users
- Dismissable via `localStorage` key `referral_banner_dismissed` (30-day cooldown)
- WhatsApp button uses `https://wa.me/?text=` with a pre-filled message:
  > "Usá BuenAdoptante para registrar adopciones y verificar adoptantes. Es gratis → https://buenadoptante.org/funcionalidades"
- Track click via `zaraz.track('referral_shared', { method: 'whatsapp' })`

#### [MODIFY] [page.tsx](file:///c:/dev/test/src/app/page.tsx)

Add `<ReferralBanner />` between `<InstallCTA />` and `<footer>`.

#### [MODIFY] [es.ts](file:///c:/dev/test/src/i18n/locales/es.ts) + [en.ts](file:///c:/dev/test/src/i18n/locales/en.ts)

Add `referral.title`, `referral.cta`, `referral.message` keys.

**Estimated: ~55 lines, 3 files.**

---

## 2. Milestone Badge ("Completaste X adopciones")

### What the user sees

A compact card in the dashboard showing their adoption milestone:

```
🏆 Completaste 25 adopciones
████████████████░░░░ → Próximo: 50
```

Milestones: **5 → 10 → 25 → 50 → 100 → 250 → 500**

### Implementation

#### [NEW] [MilestoneBadge.tsx](file:///c:/dev/test/src/components/MilestoneBadge.tsx) (~60 lines)

- Fetches user's total adoption count from existing `/api/dashboard` or a new lightweight endpoint
- Computes current milestone tier and progress to next
- Shows gamified progress bar with emoji
- Only shown to logged-in users with ≥1 adoption

#### [MODIFY] [page.tsx](file:///c:/dev/test/src/app/page.tsx)

Add `<MilestoneBadge />` above the action cards, after `SearchSection`.

#### [MODIFY] [dashboard.ts](file:///c:/dev/test/src/app/actions/dashboard.ts)

Add `getUserAdoptionCount(userEmail)` — lightweight `SELECT count(*) FROM adoptions WHERE added_by = ?`.

#### [MODIFY] [es.ts + en.ts](file:///c:/dev/test/src/i18n/locales/es.ts)

Add `milestone.completed`, `milestone.next`, `milestone.first` keys.

**Estimated: ~85 lines, 4 files.**

---

## 3. Verified Badge (Embeddable for Instagram)

### What the user sees

In the Organization settings page, a section:

```
📛 Tu badge de Registro Verificado

  ┌──────────────────────────────┐
  │ ✅ Registro Verificado       │
  │    refugio-patitas           │
  │    buenadoptante.org         │
  └──────────────────────────────┘

  [Copiar enlace]   [Descargar imagen]
```

The badge image links to `https://buenadoptante.org/org/{orgId}` (or the org's public profile, future feature).

### Implementation

#### [NEW] [VerifiedBadge.tsx](file:///c:/dev/test/src/components/VerifiedBadge.tsx) (~70 lines)

- Generates a badge image client-side using `<canvas>` (no server-side image generation needed)
- "Copiar enlace" copies the badge URL to clipboard
- "Descargar imagen" triggers a PNG download of the canvas
- Badge design: teal gradient, shield icon, org name, "Registro Verificado" text

#### [NEW] API route: `/api/badge/[orgId]` (~30 lines)

Returns a dynamically generated SVG badge (for use in linktree, websites, etc):
```
https://buenadoptante.org/api/badge/abc123
```

#### [MODIFY] [organizations/page.tsx](file:///c:/dev/test/src/app/organizations/page.tsx)

Add "Badge" section to the org management view.

#### [MODIFY] [es.ts + en.ts](file:///c:/dev/test/src/i18n/locales/es.ts)

Add `badge.title`, `badge.copy_link`, `badge.download`, `badge.verified` keys.

**Estimated: ~120 lines, 4 files.**

---

## 4. Social Proof Feed (Admin-Configurable)

### What the user sees

A subtle banner on the homepage (below hero, above search):

```
📊 Un refugio en Buenos Aires registró 3 adopciones esta semana
```

Rotates between messages. **Numbers are admin-configured, not real-time.**

### Implementation

#### Admin Configuration

Uses the existing `app_config` table with these keys:

| Key | Example Value | Purpose |
|---|---|---|
| `SOCIAL_PROOF_ENABLED` | `true` | Feature toggle |
| `SOCIAL_PROOF_MESSAGES` | JSON array | Configured messages |

JSON format for messages:
```json
[
    { "city": "Buenos Aires", "count": 3, "period": "esta semana" },
    { "city": "Rosario", "count": 5, "period": "este mes" },
    { "city": "Córdoba", "count": 2, "period": "esta semana" }
]
```

#### [NEW] [SocialProofBanner.tsx](file:///c:/dev/test/src/components/SocialProofBanner.tsx) (~45 lines)

- Fetches config from `/api/admin/config` (already fetched on homepage)
- Picks a random message from the array
- Displays with a subtle entrance animation
- Rotates every 8 seconds with a fade transition
- Dismissable (localStorage, 24-hour cooldown)

#### [MODIFY] [page.tsx](file:///c:/dev/test/src/app/page.tsx)

Add `<SocialProofBanner config={cfg} />` below the header, above search.

#### [MODIFY] [admin/config/page.tsx](file:///c:/dev/test/src/app/admin/config/page.tsx)

Add UI fields for configuring social proof messages in the admin panel.

#### [MODIFY] [es.ts + en.ts](file:///c:/dev/test/src/i18n/locales/es.ts)

Add `social_proof.prefix` ("Un refugio en"), `social_proof.registered` ("registró") keys.

**Estimated: ~80 lines, 4 files.**

---

## Scope Summary

| Feature | Lines | Files | Dependencies |
|---|---|---|---|
| Referral Banner | ~55 | 3 | None |
| Milestone Badge | ~85 | 4 | None |
| Verified Badge | ~120 | 4 | None |
| Social Proof Feed | ~80 | 4 | None |
| **Total** | **~340** | **~12** | **None** |

No new dependencies. No schema migrations. All features are admin-toggleable or dismissable.

---

## Suggested Build Order

1. **Social Proof Feed** — simplest, highest visual impact, drives FOMO
2. **Referral Banner** — easy win, drives viral growth
3. **Milestone Badge** — drives repeat usage
4. **Verified Badge** — most complex, drives org retention
