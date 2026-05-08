# Support Chat — Telegram Setup

The floating chat widget routes visitor messages to an admin's personal Telegram chat via a Telegram bot. This doc walks the one-time setup. Once configured, replies happen entirely inside the Telegram app — no admin dashboard needed.

> **Privacy note**: the admin's IP is never exposed to the visitor. The visitor's browser only talks to `buenadoptante.org`; the admin's Telegram client only talks to Telegram's servers; the app's edge worker is the only thing that talks to both.

---

## 1. Create the bot in Telegram

1. Open Telegram, search for **@BotFather**, and start a chat.
2. Send `/newbot`. Pick:
   - **Display name**: `BuenAdoptante Support` (or whatever you like — visible to the admin only)
   - **Username**: must end in `bot`, e.g. `buenadoptante_support_bot`
3. BotFather replies with an **HTTP API token** like `1234567890:AAH...XYZ`. **Save it** — this is the value of the `TELEGRAM_BOT_TOKEN` secret.

> Do **not** commit the token. Do **not** share it. Anyone with this token can pose as your bot.

## 2. Capture your admin chat_id

The chat_id is the numeric identifier of *your* personal chat with the bot. Easiest path:

1. Find the bot you just created (search by its username) and send it `/start`.
2. Open this URL in a browser, replacing `<TOKEN>`:
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
3. Look for `"chat":{"id":<NUMBER>...}`. That number is your chat_id (typically 9–10 digits, sometimes negative for groups).

You'll plug this into the admin config UI in step 5.

## 3. Generate a webhook secret

This is a random string the app uses to authenticate inbound webhook requests. Without it, anyone could forge admin replies.

```bash
# Any 32+ random hex chars works. From a Unix shell:
openssl rand -hex 32
```

Save the output as the value of `TELEGRAM_WEBHOOK_SECRET`.

## 4. Set the Cloudflare secrets

Both secrets must be set on the Cloudflare Pages project — **never** committed to `wrangler.toml`. From the project root, in a shell with `wrangler` authenticated:

```bash
# Production
npx wrangler pages secret put TELEGRAM_BOT_TOKEN --project-name verazadoptantes2
npx wrangler pages secret put TELEGRAM_WEBHOOK_SECRET --project-name verazadoptantes2

# Staging (preview environment)
# Cloudflare exposes preview-environment secrets via the dashboard:
#   Workers & Pages → verazadoptantes2 → Settings → Environment variables
#   Add variables to the "Preview" environment, mark them as "Encrypted"
```

(The Pages dashboard UI is fine if you prefer; same effect.)

Confirm with:

```bash
npx wrangler pages secret list --project-name verazadoptantes2
```

You should see both names listed without their values.

## 5. Register the webhook with Telegram

Tell Telegram where to deliver incoming messages, and pass the secret so we can authenticate them.

```bash
# Production
curl -F "url=https://buenadoptante.org/api/telegram/webhook" \
     -F "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
     "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook"

# Staging (after you've confirmed it works on prod-like preview)
curl -F "url=https://staging.verazadoptantes2.pages.dev/api/telegram/webhook" \
     -F "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
     "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook"
```

Telegram replies with `{"ok":true,"result":true,"description":"Webhook was set"}`.

> Note: Telegram only allows one webhook per bot. You can either (a) keep one bot for one environment, or (b) create two bots (one for staging, one for prod) and store separate tokens per environment.

To verify the webhook is registered:

```bash
curl "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/getWebhookInfo"
```

Look for `"url"` and `"has_custom_certificate":false`. `pending_update_count` should be 0; if it's growing, the worker is rejecting calls (most likely the secret doesn't match).

## 6. Enable in the admin UI

1. Go to `/admin/config`.
2. Under **Telegram Support Chat**, paste the chat_id from step 2 and click **Save chat_id**.
3. Under **Feature Flags**, enable **Support Chat Widget**.
4. Reload any page — the floating bubble appears at the bottom-right.

## 7. Smoke-test

1. Open the site in an incognito window (so you're testing as an anonymous visitor).
2. Click the chat bubble → type "hello" → send.
3. In your Telegram, you should see a message from the bot:
   ```
   [#abc12345] (es) anon
   hello
   ```
4. **Long-press / right-click** the bot's message and choose **Reply**. Type "hi back" and send.
5. Within ~5 seconds the visitor's chat panel should display "hi back".

If steps 3 or 5 fail, check `/api/health` and the Cloudflare Pages logs (Workers & Pages → verazadoptantes2 → Real-time logs). The most common failures:

| Symptom | Likely cause |
|---------|--------------|
| Visitor send returns 403 | Feature flag is off, or `TELEGRAM_ADMIN_CHAT_ID` empty in admin config |
| Visitor send "succeeds" but no Telegram message arrives | `TELEGRAM_BOT_TOKEN` not set as a Cloudflare secret, or wrong env (preview vs prod) |
| Telegram dashboard shows webhook errors with "401 Forbidden" | `TELEGRAM_WEBHOOK_SECRET` mismatch between `setWebhook` call and the Cloudflare secret |
| Admin reply via Telegram doesn't reach the visitor | Admin sent a plain message instead of a Reply on the bot's forwarded message — bot will respond to the admin guiding them to Reply |

## Operating the chat

- **Multiple concurrent conversations**: each visitor message arrives prefixed with `[#xxxxxxxx]`. Always use the Reply gesture on the *specific* message you're answering. The bot routes by that prefix.
- **Mute a conversation**: Reply to a forwarded message with `/block`. The visitor's subsequent messages are dropped silently — they don't see a "blocked" notice. Reply with `/unblock` to undo.
- **History**: visitor messages are stored in `chat_messages` (D1). The visitor's localStorage holds their own conversationId, so refreshing the page restores their thread. There's no admin-side dashboard yet — Telegram is the only admin UI.
- **Rate limits**: the API enforces ≤1 message per 5 seconds and ≤30 per rolling hour, per conversation. Tune the constants in `src/app/api/chat/route.ts` if needed.

## Rotating secrets

If a token leaks:

1. In BotFather, send `/revoke` and select the bot — you'll get a new token.
2. Run `npx wrangler pages secret put TELEGRAM_BOT_TOKEN ...` with the new value.
3. Re-run the `setWebhook` call in step 5 (the URL stays the same).

The webhook secret can be rotated independently — just generate a new one, update the Cloudflare secret, and re-run `setWebhook` with the new `secret_token`.
