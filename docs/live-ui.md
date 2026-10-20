# Live UI for SCDO Wallet 3.1.9

The desktop wallet can change copy, home cards, and the renderer page without a new installer. Two signed files are published over HTTPS. The wallet tries `apeccapital.org` first, then `scdo.com.au`. It fetches both on launch and every 30 minutes.

The signing key is the same Ed25519 key already used for `latest.json`. The public key embedded in the app is the 32-byte raw key in `src/updater.js` (`PUBKEY_B64`). Sign with an external PEM file. Do not commit that file.

Canonical bytes: copy the object, delete `sig`, sort keys recursively, `JSON.stringify` with no extra space, UTF-8. `sig` is standard base64 of the Ed25519 signature. This is the same canonical form as `sign-latest.js`. The installer manifest and the live `wallet-ui.json` use the field name `signature`. `ui-latest.json` may use `sig`. The wallet accepts either field. Canonical bytes drop both names before hashing.

Anything unsigned, badly signed, or carrying a URL outside the two hosts is ignored. The last good signed copy is used next, then the copy built into the app.

Allowed URLs are `https` on `scdo.com.au` or `apeccapital.org`, with no user name, password, or port other than 443.

## wallet-ui.json

Publish at:

- `https://apeccapital.org/wallet/wallet-ui.json`
- `https://scdo.com.au/wallet/wallet-ui.json`

```json
{
  "v": 1,
  "strings": {
    "en": { "homeLead": "Your SCDO wallet" },
    "zh-Hant": { "homeLead": "你的 SCDO 錢包" }
  },
  "homeCards": [
    {
      "id": "news",
      "title": { "en": "News", "zh-Hant": "消息" },
      "body": { "en": "What changed this week.", "zh-Hant": "本週的變化。" },
      "icon": "news",
      "cta": { "en": "Open", "zh-Hant": "打開" },
      "action": { "type": "open-page", "page": "news" }
    }
  ],
  "banner": { "id": "maint-1", "en": "Scheduled maintenance tonight.", "zh-Hant": "今晚有維護。" },
  "flags": { "inviteGift": true, "payInvoice": true },
  "links": {
    "hub": "https://scdo.com.au/wallet/hub/",
    "news": "https://scdo.com.au/wallet/news/",
    "events": "https://scdo.com.au/wallet/events/",
    "invite": "https://scdo.com.au/wallet/invite/",
    "agents": "https://scdo.com.au/wallet/agents/",
    "pool": "https://scdo.com.au/wallet/pool/",
    "help": "https://scdo.com.au/wallet/help/"
  },
  "cards": [{ "id": "hub", "en": "Wallet hub", "cn": "錢包總覽" }],
  "minVersion": "3.1.9",
  "recommendedVersion": "3.1.9",
  "signature": "<base64>"
}
```

The file published at `https://scdo.com.au/wallet/wallet-ui.json` uses this shape: `links.hub`, `flags`, `banner` (or null), `homeCards` (or an empty list), `strings` (or an empty object), `minVersion`, and `signature`.

`strings` overrides existing i18n keys. `en` is English. `zh-Hant` is both 華語 variants. Only string values are kept. Unknown keys are ignored when the page draws. Values that contain `<` or `>` are dropped. The stay-online lines use `agentStayOpen`, `agentOnlineLine`, `agentOfflineLine`, `trayStayNotice`, `quitAgentMsg`, `quitAgentQuit`, `quitAgentStay`, and `quitAgentDontAsk`. The settings label `loginToggle` is Launch at login (start minimised in tray).

`homeCards` actions are `open-url` (`url` on the allowlist), `open-page` (`page` must be a key in `links`), `start-agent`, `invite`, and `claim`. A bad action or a bad URL rejects the whole file.

`flags` hides a control when the value is `false`. Missing means show. `invite` and `inviteGift` hide Invite with a gift. `send` and `payInvoice` hide Pay invoice. `agent` is reserved for the agent card.

`minVersion` and `recommendedVersion` show a note when this install is older. They do not stop the wallet.

The document is applied on the next paint. No restart.

Sign it:

```bash
node tools/sign-ui-config.js --key /path/to/ed25519.pem --in wallet-ui.json --out wallet-ui.json
```

## ui-latest.json and the renderer zip

Publish:

- `https://apeccapital.org/wallet/ui-latest.json`
- `https://scdo.com.au/wallet/ui-latest.json`
- the zip named in `url`

```json
{
  "v": 1,
  "version": "3.1.9-ui.1",
  "url": "https://scdo.com.au/wallet/ui-bundle-3.1.9-ui.1.zip",
  "sha256": "<64 hex chars>",
  "minShellVersion": "3.1.9",
  "sig": "<base64>"
}
```

`version` matches `3.1.9` or `3.1.9-ui.1`. `url` must end with `/ui-bundle-<version>.zip` on one of the two hosts. `sha256` is the lowercase or mixed-case hex of the zip bytes.

The zip is store or deflate. It must contain, at the top:

- `index.html`
- `manifest.json` with `{ "version", "minShellVersion" }` equal to `ui-latest.json`

Other files may be `.html`, `.css`, `.js`, `.json`, `.svg`, `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.woff`, `.woff2`, `.txt`, or `.map`. Paths with `..`, absolute paths, and other extensions are rejected.

The zip is unpacked under the wallet user-data folder and loaded the next time the window reloads. The main process, `preload.js`, keys, and transaction code stay the ones in the installer. The preload and IPC allowlist do not change. If that `index.html` fails to load, or the renderer crashes twice on the same bundle, the wallet returns to the UI shipped in the installer.

Build it from a directory that already contains `index.html`:

```bash
node tools/build-ui-bundle.js \
  --key /path/to/ed25519.pem \
  --version 3.1.9-ui.1 \
  --min-shell 3.1.9 \
  --src /path/to/renderer \
  --out /path/to/publish \
  --url https://scdo.com.au/wallet/ui-bundle-3.1.9-ui.1.zip
```

That writes `ui-bundle-3.1.9-ui.1.zip` and a signed `ui-latest.json` in the output directory.
