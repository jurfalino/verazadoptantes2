# Support Chat — Telegram Setup

The floating chat widget routes visitor messages to an admin's personal Telegram chat via a Telegram bot. This doc walks the one-time setup. Once configured, replies happen entirely inside the Telegram app — no admin dashboard needed.

> **Privacy note**: the admin's IP is never exposed to the visitor. The visitor's browser only talks to `buenadoptante.org`; the admin's Telegram client only talks to Telegram's servers; the app's edge worker is the only thing that talks to both.

There are **two paths** depending on how you want to store secrets.

---

## Path A — All in the admin UI (recommended for solo operators)

Everything happens in `/admin/config` → "Telegram Support Chat".

### 1. Create the bot in Telegram

1. Open Telegram, search for **@BotFather**, and start a chat.
2. Send `/newbot`. Pick:
   - **Display name**: `BuenAdoptante Support` (or whatever you like — visible to the admin only)
   - **Username**: must end in `bot`, e.g. `buenadoptante_support_bot`
3. BotFather replies with an **HTTP API token** like `1234567890:AAH...XYZ`. **Keep this tab open** — you'll paste this token in step 4.

### 2. Capture your admin chat_id

The chat_id is the numeric identifier of *your* personal chat with the bot. The app needs it to know which Telegram chat to forward visitor messages to.

1. In Telegram, find the bot you just created (search by its username) and **send it `/start`** (or any message).
2. Open this URL in a browser, replacing `<TOKEN>`:
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
3. Look for `"chat":{"id":<NUMBER>...}`. That number (typically 9–10 digits) is your chat_id.

> Do this **before** you register the webhook. Once a webhook is registered, `getUpdates` returns nothing because Telegram only delivers updates one way.

### 3. Generate a webhook secret

A random string the app uses to authenticate inbound webhook requests. Without it, anyone could forge admin replies.

```bash
openssl rand -hex 32
```

Copy the output — you'll paste it in step 4.

### 4. Save everything in the admin UI

1. Go to `/admin/config`.
2. Under **Telegram Support Chat**:
   - Paste the **bot token** (from step 1) into the first field.
   - Paste the **webhook secret** (from step 3) into the second field.
   - Paste the **admin chat_id** (from step 2) into the third field.
3. Click **Save & register webhook**. The server stores the values and immediately calls Telegram's `setWebhook` for you. A green "✓ Saved + webhook registered at ..." confirms success.
4. Under **Feature Flags**, enable **Support Chat Widget**.

> The bot token and webhook secret are stored in the app database (`appConfig` table). They're visible to anyone with admin DB access. For higher isolation, see Path B.

### 5. Smoke-test

1. Open the site in an **incognito window** (so you're testing as an anonymous visitor).
2. Click the chat bubble at the bottom-right → type "hello" → send.
3. In your Telegram, you should see a message from the bot:
   ```
   [#abc12345] (es) anon
   hello
   ```
4. **Long-press / right-click** the bot's message and choose **Reply**. Type "hi back" and send.
5. Within ~5 seconds the visitor's chat panel should display "hi back".

---

## Path B — Cloudflare secrets (more isolated)

If you'd rather keep the bot token and webhook secret out of the database, store them as Cloudflare Pages secrets instead. The app reads DB first and falls back to the Cloudflare secret when the DB row is empty.

```bash
# Production
npx wrangler pages secret put TELEGRAM_BOT_TOKEN --project-name verazadoptantes2
npx wrangler pages secret put TELEGRAM_WEBHOOK_SECRET --project-name verazadoptantes2

# Staging — set via the Cloudflare dashboard:
#   Workers & Pages → verazadoptantes2 → Settings → Environment variables
#   Add to the "Preview" environment, mark "Encrypted"
```

Confirm:

```bash
npx wrangler pages secret list --project-name verazadoptantes2
```

Then in the admin UI:

1. Leave the **bot token** and **webhook secret** fields blank (the app will use the Cloudflare secrets).
2. Paste only the **admin chat_id**.
3. Click **Save & register webhook**.

The admin UI's "(currently set)" indicator next to the password fields shows whether a DB value exists. When both DB fields are blank but the Cloudflare secrets are set, the integration still works — `getTelegramConfig()` resolves DB-first, env-fallback.

---

## Operating the chat

- **Multiple concurrent conversations**: each visitor message arrives prefixed with `[#xxxxxxxx]`. Always use the Reply gesture on the *specific* message you're answering. The bot routes by that prefix.
- **Mute a conversation**: Reply to a forwarded message with `/block`. The visitor's subsequent messages are dropped silently — they don't see a "blocked" notice. Reply with `/unblock` to undo.
- **History**: visitor messages are stored in `chat_messages` (D1). The visitor's localStorage holds their own conversationId, so refreshing the page restores their thread. There's no admin-side dashboard yet — Telegram is the only admin UI.
- **Rate limits**: the API enforces ≤1 message per 5 seconds and ≤30 per rolling hour, per conversation. Tune the constants in `src/app/api/chat/route.ts` if needed.

## Re-registering the webhook

The "Re-register webhook" button in `/admin/config` calls `setWebhook` again with the current values. Use it after:

- Rotating the webhook secret (clear the field, paste a new one, click Save & register).
- Migrating environments (e.g. promoting a bot from staging to prod — re-register against the new host).

## Rotating secrets

If a token leaks:

1. In BotFather, send `/revoke` and select the bot — you'll get a new token.
2. Paste the new token in the admin UI and click **Save & register webhook** (or `wrangler pages secret put` if using Path B).

The webhook secret can be rotated independently — generate a new one, paste it, and click Save & register.

## Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| Visitor send returns 403 | Feature flag is off, or `TELEGRAM_ADMIN_CHAT_ID` is empty |
| Visitor send "succeeds" but no Telegram message arrives | Bot token isn't set in either DB or Cloudflare secret |
| Telegram dashboard shows webhook errors with "401 Forbidden" | Webhook secret mismatch — re-register from the admin UI to push the current secret |
| Admin reply via Telegram doesn't reach the visitor | Admin sent a plain message instead of using Telegram's Reply gesture — the bot will reply guiding the admin to use Reply |
| `/getUpdates` returns nothing | Webhook is already registered. Use the admin UI to re-register or temporarily delete it: `curl https://api.telegram.org/bot<TOKEN>/deleteWebhook` |
