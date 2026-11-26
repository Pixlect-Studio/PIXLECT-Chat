# PIXLECT Chat

A static, no-build chat workspace for PIXLECT Studios. One public `#general` channel, a live member directory, and one-to-one direct messages. Everything runs on plain HTML, CSS, and JavaScript and can be hosted on GitHub Pages.

## Sign in with a real PIXLECT Account

PIXLECT Chat has no local login, demo account chooser, or offline identity. Sign-in always opens the canonical portal:

https://www.account.pixlect-studios.com/index.html

Sign in with Google or an email link. The portal returns the PIXLECT profile (`uid`, and either `username`/`icon` or just `email`) to the app with `postMessage`; when it sends only an email, the app uses the email name as the display name.

For email links, keep the account window open after requesting the link. The link opens a second account tab, which signs in and relays the result back to the open window. If you closed it, click **Sign in with PIXLECT Account** again on the chat gate — the existing portal session finishes immediately. The app keeps that profile in `localStorage` so a refresh does not sign the user out. `js/login.js` is the complete client; there is no `login.html` fallback.

### Allowed origins

The portal checks `https://www.account.pixlect-studios.com/domain.json`. `localhost:8000` and `127.0.0.1:8000` are already registered, along with `PIXLECT Chat` as an allowed app. For another host, add its exact origin to that registry before signing in.

## Data model

Firestore project: `pixlect-chat` (config in `js/cloud.js`).

- `users/{uid}` — public profile: username, emoji avatar, color, `lastSeen`.
- `rooms/{roomId}` — channel metadata, or a DM document with `type: "dm"` and a `members` array.
- `rooms/{roomId}/messages/{messageId}` — messages, ordered by `ts`; reactions live in a `reactions` map.

Direct-message room IDs are deterministic: `dm_<uidA>__<uidB>` with the two UIDs sorted. A DM is created the first time either person opens it. The sidebar lists every DM room the signed-in UID belongs to, plus all registered profiles in Contacts.

Firestore is the only source of truth for messages. There is no local message cache, no seed content, and no local mode: when the listener or a write fails, the sync chip says **Offline** and the send is reported as not sent.

## Run locally

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Open http://127.0.0.1:8000/ (or http://localhost:8000/). Use port 8000 or 8080, because those are the localhost origins in the PIXLECT registry.

## Firebase rules

`firestore.rules` validates document shapes and keeps writes limited to the expected fields. Copy it into the Firebase console for the `pixlect-chat` project and publish it.

Important: these rules allow read access to the room collection because PIXLECT Account authentication happens in a different Firebase project and is not a Firebase Auth session here. Direct messages are 1:1 rooms in the UI, but the rules do not provide cryptographic secrecy. If you need access-controlled DMs, add Firebase Auth to this project and replace the read rules with membership checks.

## Files

- `index.html` — auth gate and chat shell.
- `js/login.js` — PIXLECT Account popup client.
- `js/cloud.js` — Firebase app/Firestore bridge.
- `js/store.js` — live messages, contacts, DM rooms.
- `js/app.js` — UI rendering and events.
- `css/styles.css` — all styling.
- `firestore.rules` — suggested Firestore rules.

## Deploy

Push the folder to GitHub Pages (or any static host). Then add the deployed origin to the PIXLECT registry if it is not already covered by the `PIXLECT Chat` app allowance. No build step or environment variables are required.
