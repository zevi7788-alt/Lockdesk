# LockDesk iPhone app

The iPhone app is a native shell (Capacitor) around the same `index.html` that runs on the web, so every web update ships to the app on its next build.

* Built automatically on GitHub's Macs by `.github/workflows/ios.yml`.
* Icons and splash screens are generated from `assets/`.
* Bundle ID: `com.zevineiman.lockdesk`. Seller: Zevi Neiman.

Signing and App Store upload switch on once these repository secrets exist:
`ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_KEY_P8` (App Store Connect API key), `APPLE_TEAM_ID`.
