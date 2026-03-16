# Follow-Up Reminders + Web Push Notifications

## Goal

Automatically remind users to follow up on adoptions via **in-app notifications** (bell icon) AND **device-level push notifications** (lock screen, notification center) — so users are re-engaged even when they're not browsing the app.

---

## Architecture

```
┌──────────────┐    ┌──────────────────┐    ┌──────────────────────────┐
│ CF Worker    │───▶│ Query adoptions  │───▶│ For each due follow-up:  │
│ Cron (daily) │    │ due for follow-up│    │ 1. createNotification()  │
└──────────────┘    └──────────────────┘    │ 2. sendPush()            │
                                            └────────────┬─────────────┘
                                                         │
                                    ┌────────────────────┼────────────────────┐
                                    ▼                    ▼                    ▼
                              Chrome (FCM)        Firefox (autopush)    Safari (APNs)
                                    │                    │                    │
                                    ▼                    ▼                    ▼
                              📱 Device notification on lock screen / desktop tray
```

**Zero third-party services.** Uses the open Web Push protocol — direct HTTP to browser vendor endpoints. Free, self-hosted VAPID keys.

---

## Follow-Up Schedule

| Record Type | Remind At | Message |
|---|---|---|
| `adoption` | 7d, 30d, 90d | "¿Cómo va la adaptación de **{animal}**?" / "Ya pasó un mes..." / "Seguimiento de 3 meses" |
| `adoption_request` | 3d | "¿Se concretó la adopción de **{animal}**?" |
| `returned_pet` | 14d | "¿Encontraste nuevo hogar para **{animal}**?" |

---

## Proposed Changes

### Database

#### [NEW] Migration: `push_subscriptions` table

```sql
CREATE TABLE push_subscriptions (
    id          TEXT PRIMARY KEY,
    user_email  TEXT NOT NULL,
    endpoint    TEXT NOT NULL,
    p256dh      TEXT NOT NULL,
    auth        TEXT NOT NULL,
    created_at  INTEGER DEFAULT (strftime('%s','now')),
    UNIQUE(user_email, endpoint)
);
CREATE INDEX idx_push_user ON push_subscriptions(user_email);
```

#### [MODIFY] [schema.ts](file:///c:/dev/test/src/db/schema.ts)

Add Drizzle definition for `push_subscriptions`.

---

### Cloudflare Worker (Cron)

#### [NEW] `workers/followup-cron/index.ts` (~80 lines)

Runs daily at 09:00 UTC via Cron Trigger:
1. Query all adoptions with `date + interval <= today`
2. Deduplicate: skip if a notification with matching `type='follow_up'` + `adoptionId` + `intervalDays` already exists in `metadata`
3. For each due reminder:
   - `createNotification()` → in-app bell
   - Look up `push_subscriptions` for that user → `sendPush()` to each device
4. Clean up stale subscriptions (410 responses from push endpoints)

#### [NEW] `workers/followup-cron/wrangler.toml` (~15 lines)

```toml
name = "followup-cron"
[triggers]
crons = ["0 9 * * *"]
[[d1_databases]]
binding = "DB"
database_name = "pet-adoption-db"
database_id = "62ec01e7-deae-4536-be62-7c0a0064b45c"
```

---

### Push Infrastructure

#### [NEW] [push.ts](file:///c:/dev/test/src/lib/push.ts) (~40 lines)

Edge-compatible Web Push sender using Web Crypto API (no Node.js `web-push` library). Signs VAPID JWT + encrypts payload + sends via `fetch()`.

#### [NEW] API route: `/api/push/subscribe` (~35 lines)

- **POST**: Save subscription (endpoint + keys) to DB
- **DELETE**: Remove subscription (opt-out)

#### Setup: VAPID Keys (one-time)

```bash
npx web-push generate-vapid-keys
```

Store `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` as Cloudflare env secrets.

---

### Client-Side Components

#### [NEW] [PushOptIn.tsx](file:///c:/dev/test/src/components/PushOptIn.tsx) (~50 lines)

Non-intrusive banner for logged-in users:

```
🔔 ¿Querés recibir recordatorios de seguimiento?
         [Activar]    [Ahora no]
```

- Checks `localStorage` for dismissal (30-day cooldown)
- On iOS without PWA → shows "Instalá la app" variant
- On "Activar" → `Notification.requestPermission()` → subscribe via Service Worker → POST to `/api/push/subscribe`

#### [MODIFY] [sw.js](file:///c:/dev/test/public/sw.js) (~20 lines added)

Add push event listener + notification click handler:

```js
self.addEventListener('push', (event) => {
    const data = event.data?.json() || {};
    event.waitUntil(
        self.registration.showNotification(data.title, {
            body: data.body,
            icon: '/icon-192x192.png',
            data: { url: data.url },
            tag: data.tag,
        })
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(clients.openWindow(event.notification.data?.url || '/'));
});
```

---

### Settings & Layout

#### [MODIFY] [settings/page.tsx](file:///c:/dev/test/src/app/settings/page.tsx)

Add push toggle: "Notificaciones push [🟢 Activado]"

#### [MODIFY] [layout.tsx](file:///c:/dev/test/src/app/layout.tsx)

Render `<PushOptIn />` inside `SessionProvider` for logged-in users.

#### [MODIFY] [es.ts](file:///c:/dev/test/src/i18n/locales/es.ts) + [en.ts](file:///c:/dev/test/src/i18n/locales/en.ts)

Add i18n strings for push opt-in banner, settings toggle, and notification messages.

#### [MODIFY] [.github/workflows/deploy.yml](file:///c:/dev/test/.github/workflows/deploy.yml)

Add Worker deploy step for `followup-cron`.

---

## Platform Support

| Platform | Push without PWA? | Notes |
|---|---|---|
| Chrome (desktop + Android) | ✅ | |
| Firefox | ✅ | |
| Edge | ✅ | |
| Safari macOS 13+ | ✅ | |
| Safari iOS | ❌ | Requires "Add to Home Screen" — banner guides user |

---

## Scope Summary

| Component | Lines | File |
|---|---|---|
| DB migration | ~10 | `drizzle/00XX_push_subscriptions.sql` |
| Schema definition | ~12 | `schema.ts` |
| Cron Worker | ~80 | `workers/followup-cron/index.ts` |
| Worker config | ~15 | `workers/followup-cron/wrangler.toml` |
| Push send utility | ~40 | `lib/push.ts` |
| Push API route | ~35 | `api/push/subscribe/route.ts` |
| PushOptIn component | ~50 | `PushOptIn.tsx` |
| Service Worker handler | ~20 | `sw.js` |
| Settings toggle | ~15 | `settings/page.tsx` |
| Layout integration | ~5 | `layout.tsx` |
| i18n strings | ~15 | `es.ts` + `en.ts` |
| Deploy pipeline | ~10 | `deploy.yml` |
| **Total** | **~307 lines** | **12 files** |

**Dependencies:** None. Zero external services. Free.

---

## Verification

1. Generate VAPID keys → configure env vars
2. Subscribe from Chrome desktop → verify row in `push_subscriptions`
3. Create adoption dated 8 days ago → trigger cron manually → verify:
   - In-app notification in bell ✅
   - Push notification on device ✅
4. Dismiss notification → re-run cron → no duplicate ✅
5. Test Android Chrome, Safari macOS, iOS PWA
6. Unsubscribe from Settings → verify no more pushes
7. Test expired subscription → verify 410 cleanup
