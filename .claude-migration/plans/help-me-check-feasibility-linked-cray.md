# Feasibility & Plan: Floating Support Chat Routed via Telegram

## Context

You want to add a floating chat widget (bottom-right) so any visitor — signed-in or anonymous — can request a conversation with an admin. The admin reads/replies from their personal Telegram client. Two hard constraints:

1. The admin's IP must never be exposed to the user.
2. The implementation should fit the existing stack (Next.js 15 App Router on Cloudflare Pages + D1 + edge runtime) without introducing infra primitives the project doesn't already use.

### Feasibility verdict

**Yes — fully feasible** on the current stack. The Telegram-bot relay model naturally satisfies the IP-privacy constraint: the admin's Telegram client connects only to Telegram's servers; the user's browser connects only to the app's domain; the app's edge worker is the only thing that talks to both Telegram and the user. Admin's IP and user's IP never share a connection.

Decisions captured upfront (from clarifying questions):

- **Audience**: anonymous + signed-in. Anon visitors get a `crypto.randomUUID()` session ID in localStorage.
- **Routing**: single admin Telegram chat. One bot, one chat_id.
- **History**: persisted in D1 so users see their own messages on refresh and admins can audit.
- **Realtime**: short-poll every 3–5s while the widget is open; pause when tab hidden.

## Architecture

```
┌──────────────┐  POST /api/chat (send)   ┌────────────────┐
│  Browser     │─────────────────────────▶│  Edge Worker   │
│  ChatWidget  │◀─── GET  /api/chat/poll ─│  (Next.js API) │
└──────────────┘                          │                │
                                          │  D1: chat_*    │
                                          │  tables        │
                                          └───────┬────────┘
                                                  │ fetch
                                                  ▼
                                          ┌────────────────┐
                                          │ Telegram Bot   │
                                          │  api.telegram  │
                                          └───────┬────────┘
                                                  │ push
                                                  ▼
                                          ┌────────────────┐
                                          │ Admin's        │
                                          │ Telegram app   │
                                          └───────┬────────┘
                                                  │ admin types reply
                                                  ▼
                                          ┌────────────────┐
                                          │ Telegram → app │
                                          │ /api/telegram/ │
                                          │  webhook       │
                                          └───────┬────────┘
                                                  ▼ writes to D1
                                          (user polls and sees the reply)
```

## Schema additions (`src/db/schema.ts`)

Two new tables. Both use Drizzle, follow existing snake_case + timestamp-mode conventions:

```ts
export const chatConversations = sqliteTable("chat_conversations", {
  id: text("id").primaryKey(),                       // UUID, also user's localStorage anchor
  userEmail: text("user_email"),                     // null for anon
  userLabel: text("user_label"),                     // for the admin's Telegram preview
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s','now'))`),
  lastMessageAt: integer("last_message_at", { mode: "timestamp" }),
  blocked: integer("blocked").default(0),            // admin can mute a conversation
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  conversationId: text("conversation_id").notNull(),
  direction: text("direction").notNull(),            // 'user' | 'admin'
  body: text("body").notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).default(sql`(strftime('%s','now'))`),
  telegramMessageId: integer("telegram_message_id"), // bot's message-id when forwarded; lets admin reply-to-thread
}, (table) => ({
  convIdx: index("idx_chat_msgs_conv").on(table.conversationId),
}));
```

Schema-sync workflow per `.agents/workflows/schema-sync.md` after migration.

## Telegram threading (the only non-obvious bit)

A single admin Telegram chat carries N concurrent conversations. Strategy:

1. When the user sends a message, the bot's `sendMessage` forwards it to the admin chat formatted as:
   ```
   [#abc12345] (anon) message body
   ```
   `abc12345` = first 8 chars of the conversation ID.
2. We store the returned `message_id` from Telegram in `chatMessages.telegramMessageId`.
3. Admin uses Telegram's native **Reply** gesture on the bot's forwarded message to reply.
4. Telegram's webhook delivers the admin's reply with `message.reply_to_message.text` containing `[#abc12345]`. We extract the prefix, look up the conversation by ID-prefix, and route.
5. Fallback: if the admin sends a plain message (no reply), bot answers privately: *"Use Reply on the user's message to direct your reply."*

This avoids Telegram forum/topic mode (which requires group setup) and avoids "most-recently-active-user" guessing (fragile under concurrent chats).

## Privacy analysis (admin IP)

| Hop | Source | Destination | Admin IP exposed? |
|-----|--------|-------------|-------------------|
| 1 | Browser | App edge worker | No (admin not involved) |
| 2 | App edge worker | Telegram Bot API | No (admin not involved) |
| 3 | Telegram servers | Admin's Telegram client | Telegram ↔ admin only — invisible to app and to user |
| 4 | Admin's Telegram client | Telegram servers | Admin ↔ Telegram only — same |
| 5 | Telegram servers | App `/api/telegram/webhook` | App's IP visible to Telegram, admin's not |
| 6 | App edge worker | Browser (poll response) | No |

**Conclusion**: admin's IP only appears between the admin's device and Telegram's servers. Telegram does not relay client IPs to bots. ✅

## Files to add / modify

### New
- `src/db/schema.ts` — append the two tables (above)
- `drizzle/<n>_chat_tables.sql` — generated by `drizzle-kit generate`
- `src/lib/telegram.ts` — thin wrapper: `sendMessage(chatId, text)`, `verifyWebhookSecret(headers)`
- `src/app/api/chat/route.ts` — `POST` (user sends), `GET` (user polls). Edge runtime. Reads `conversationId` from cookie or request body; rate-limits per ID.
- `src/app/api/telegram/webhook/route.ts` — `POST` only. Verifies `X-Telegram-Bot-Api-Secret-Token` header against `TELEGRAM_WEBHOOK_SECRET`. Parses the Telegram update, extracts conversation prefix from `reply_to_message.text`, persists, marks conversation lastMessageAt.
- `src/components/ChatWidget.tsx` — floating button (bottom-right, `z-[80]`, theme tokens per `docs/design-style-guide.md`); panel with message list + composer; polling `useEffect` with `document.visibilityState` gate; localStorage `chat_session_id` (uuid v4); reuses existing `useShowToast` for delivery errors.
- `src/config/features.ts` — add `ENABLE_CHAT_WIDGET` flag (existing pattern, DB-backed via appConfig with env fallback).

### Modify
- `src/app/admin/config/page.tsx` — add `TELEGRAM_ADMIN_CHAT_ID` field (chat_id is admin-configurable; the bot token is a secret only). Add the new feature flag toggle.
- `src/app/api/admin/config/route.ts` — extend the GET response shape (the four-place duplication noted in v2.14.4's known wart — apply same).
- `src/app/layout.tsx` (or a layout that wraps marketing + app pages) — mount `<ChatWidget />` once, gated on `ENABLE_CHAT_WIDGET`.

### Cloudflare secrets (set via `wrangler secret put` or dashboard, **not** `wrangler.toml`)
- `TELEGRAM_BOT_TOKEN` — bot token from BotFather
- `TELEGRAM_WEBHOOK_SECRET` — random 32-byte string; passed to Telegram on `setWebhook` and verified on every incoming webhook request

### AppConfig keys
- `TELEGRAM_ADMIN_CHAT_ID` — the admin's personal chat_id, captured by sending `/start` to the bot once and reading the `chat.id` from the first webhook
- `ENABLE_CHAT_WIDGET` — feature flag

## Reused existing patterns

- D1 access: `getDb()` from `src/lib/db.ts` (auto-detects Cloudflare context)
- Logging: `logger.info/warn/error` per `src/lib/logger.ts`; catch blocks must include `conversationId` per CLAUDE.md
- Edge runtime + auth: `await auth()` from `src/auth.ts` (returns `null` for anon — that's the signal)
- Toast: `useShowToast()` from `src/components/ui/Toast.tsx` for send errors
- Theme tokens: `--surface-card`, `--accent`, `--border-default`, `--text-primary` per `docs/design-style-guide.md`
- AppConfig + admin UI: pattern from `src/app/admin/config/page.tsx` and `src/app/api/admin/config/route.ts`
- Rate-limit: there's no shared helper today; implement inline in `/api/chat` POST as `now - lastMessageAt < 5000ms` short-circuit + a per-hour counter on the conversation row (cheaper than a separate table)
- D1 IN-clause workaround per `docs/D1_COMPATIBILITY.md`: any multi-id lookup loops via `Promise.all`

## Spam & abuse mitigation

- **Rate limit per session**: ≤1 message per 5s, ≤30 messages per rolling hour. Stored on `chat_conversations` as a counter+timestamp; reset hourly.
- **Honeypot input** in the composer (hidden field that bots fill in).
- **Admin block flag** (`chat_conversations.blocked = 1`): subsequent sends from that conversationId are dropped server-side without Telegram forwarding. The bot has a `/block` command on a forwarded message that flips the flag.
- **Conversation-id forgery**: conversationId is a UUID v4 (≈122 bits). Brute-force enumeration to hijack another conversation is infeasible. Optionally HMAC-sign with `TELEGRAM_WEBHOOK_SECRET` for stronger guarantee — defer unless real abuse appears.

## Notification UX

- Floating button shows a small accent dot when there are unread admin messages (computed from `lastMessageAt > lastSeenAt` localStorage value).
- Optional soft "ping" sound on new admin reply (off by default, toggle in widget header).
- No browser-Notification API push — would require permission prompts; not worth it for v1.

## Open implementation choices to revisit during build

1. **Cookie vs localStorage for conversation ID**: localStorage is simpler and keeps server endpoints stateless; cookies would let SSR pre-fetch unread count. Default: localStorage, since the widget mounts client-side anyway.
2. **D1 fan-out under concurrency**: at expected volume (single-admin, support chat) this is dominated by Telegram's own rate limits, not D1.
3. **Bot setup automation**: the BotFather steps and `setWebhook` registration are one-time manual ops. Document them in `docs/CHAT_SETUP.md` rather than scripting (deploys don't need to repeat them).

## Verification plan

End-to-end on staging before considering this done:

1. **TypeScript**: `npx tsc --noEmit` clean.
2. **Lint**: `npx next lint` warning count ≤ 122 ratchet.
3. **Migration**: `npx drizzle-kit generate` produces a clean migration; `npx wrangler d1 migrations apply pet-adoption-db-staging --remote` applies cleanly. `/schema-sync` for local D1.
4. **Telegram setup smoke**:
   - Create test bot via BotFather → secret stored as `TELEGRAM_BOT_TOKEN` on the staging Pages project
   - `setWebhook` to `https://staging.verazadoptantes2.pages.dev/api/telegram/webhook` with `secret_token`
   - Send `/start` from your personal Telegram → verify webhook fires and you can capture the chat_id
   - Save chat_id in admin config UI
5. **End-to-end manual on staging**:
   - Open staging in incognito (no auth) → click chat icon → send "test"
   - Confirm a forwarded message arrives in your Telegram with `[#xxxxxxxx]` prefix
   - Reply to that message in Telegram
   - Confirm the widget displays the reply within ~5s of sending
   - Sign in, send another message → confirm prefix changes (different conversationId per session) and the user label says the email
   - Refresh the incognito browser → confirm prior messages reload from D1 (history persistence)
6. **Privacy spot-check**: in the staging session, capture the `Network` tab — confirm the only outbound hosts the browser sees are `staging.verazadoptantes2.pages.dev` (and existing third-party hosts). No `t.me`/`telegram.org` from the browser.
7. **Webhook auth**: send a forged POST to `/api/telegram/webhook` without the `X-Telegram-Bot-Api-Secret-Token` header → expect 401.
8. **Rate limit**: from the widget, paste 10 messages in 5 seconds → expect the 2nd–10th to surface a "Slow down — wait a moment" toast.
9. **e2e**: a single Playwright test that mocks the Telegram fetch (so it doesn't hit real Telegram in CI) and exercises POST /api/chat → DB row → poll round-trip.

## Estimated scope

| Piece | Size |
|-------|------|
| Schema + migration | XS |
| `/api/chat` POST + GET | S |
| `/api/telegram/webhook` + signature verify | S |
| `src/lib/telegram.ts` | XS |
| `ChatWidget.tsx` (UI + polling effect) | M |
| Admin config UI extension | XS |
| Feature flag + layout mount | XS |
| Setup docs + Cloudflare secrets | XS |
| One Playwright e2e | S |

Roughly 1–2 focused days. The widget UI is the biggest single piece; the rest is glue.

## What this plan does NOT include (defer)

- File / image attachments in chat (Telegram supports them; widget doesn't initially).
- Admin-broadcast messages from app → Telegram triggered by other events (e.g. flagged adopter).
- Chat transcript export.
- Multi-admin routing.
- HMAC-signed conversation IDs (revisit only if abuse appears).
