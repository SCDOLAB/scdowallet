# Mac signing (SCDO Wallet 3.0.8)

A normal Mac build does not need an Apple developer account. Developer ID signing and notarization stay off until every required variable is set. Windows targets, the NSIS installer, and Windows signing are not part of this setup.

## Ad-hoc signature (default)

`package.json` sets `build.mac.identity` to `-`. electron-builder then ad-hoc signs the `.app` when the build runs on macOS. `build.afterSign` is `scripts/mac-after-sign.js`. On a Mac host that script runs:

```bash
codesign --force --deep -s - "SCDO Wallet.app"
```

That signature is not a Developer ID signature. Hardened runtime is not left on the finished app, and the app is not notarized. Gatekeeper on another Mac may still ask before opening it. `build.mac.notarize` is `false`, so electron-builder itself never sends the app to Apple.

`npm run dist:mac` is `electron-builder --mac --arm64`. On a machine that is not macOS, `codesign` is not available, so the hook does nothing and electron-builder skips signing. The Windows `beforePack` script is unchanged and still returns immediately for a Mac target.

## Developer ID and notarization

Both stay off unless all four of these are set to a non-empty value:

| Variable | Role |
| --- | --- |
| `APPLE_ID` | Apple ID for `notarytool` |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that Apple ID |
| `APPLE_TEAM_ID` | Team id shown in the developer account |
| `CSC_LINK` | Developer ID Application `.p12`, as a file path or base64 |

`CSC_KEY_PASSWORD` is optional. Set it when the `.p12` has a password.

When all four are set and the build host is macOS, `scripts/mac-after-sign.js`:

1. Imports `CSC_LINK` into a temporary keychain.
2. Signs the `.app` with the Developer ID Application identity, hardened runtime (`--options runtime`), and `build/entitlements.mac.plist`.
3. Notarizes with `@electron/notarize` (`notarytool`) and staples the ticket.

If any one of the four is missing, the hook keeps the ad-hoc signature and does not notarize.

`build.mac.hardenedRuntime` is `true` and both `entitlements` and `entitlementsInherit` point at `build/entitlements.mac.plist`, so a Developer ID signature uses Electron's JIT entitlements:

- `com.apple.security.cs.allow-jit`
- `com.apple.security.cs.allow-unsigned-executable-memory`
- `com.apple.security.cs.disable-library-validation`
- `com.apple.security.cs.allow-dyld-environment-variables`

The finished ad-hoc app is signed again without `--options runtime`, so hardened runtime is off unless the four variables are set.

## 華語

一般的 Mac 打包不需要 Apple 開發者帳號。`identity` 是 `-`，在 Mac 上會用 `codesign --force --deep -s -` 做本機簽章。沒有同時設定 `APPLE_ID`、`APPLE_APP_SPECIFIC_PASSWORD`、`APPLE_TEAM_ID`、`CSC_LINK` 時，不會做開發者簽章，也不會公證。四個都設定時，才會加上 hardened runtime、Electron 即時編譯所需的 entitlements，並公證。Windows 的打包和簽章沒有改。
