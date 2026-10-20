# Release checklist (SCDO Wallet desktop, Mac, Android, Linux agent)

1. Build from the tagged release commit; record the commit in the release notes.
2. Compute SHA256 for every artifact; publish `SHA256SUMS` next to the files on `scdo.com.au/downloads/wallet/` (and `linux/`).
3. Update the feeds: `downloads/wallet/latest.json` (Windows), `downloads/wallet/mac/latest.json` (Mac), `downloads/wallet/android/latest.json` (Android), `downloads/wallet/linux/latest.json` (Linux). Version, url, size and sha256 must match the uploaded file.
4. Update the static fallbacks on the site cards (home `/`, `/wallets/`, `/downloads/wallet/`) in both 華語 and English. The cards render versions and links from the feeds via `/scdo-release-vers.js`; the static text is only the fallback.
5. Create the GitHub Release on SCDOLAB/scdowallet (`vX.Y.Z` for desktop/Mac, `linux-agent-vX.Y.Z` for Linux) with the real artifacts and `SHA256SUMS`.

## Definition of done (required)

**No release counts as done until the site cards, the GitHub release and latest.json all show the new version, verified live.**

Verify on every serving domain (scdo.com.au, apeccapital.org, hk.apeccapital.org):
- `curl -s https://<domain>/downloads/wallet/<platform>/latest.json` shows the new version and its sha256 matches `sha256sum` of the downloaded file.
- `/`, `/wallets/` and `/downloads/wallet/` render the new version in both `?lang=zh` and `?lang=en` (headless browser, after JS).
- `gh release view <tag> -R SCDOLAB/scdowallet` shows the release with all artifacts; asset digests match `SHA256SUMS`.
