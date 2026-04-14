# macOS App

The macOS app is currently versioned in this repository as a built app bundle at:

- `macos/GardenApp/dist/GardenApp.app`

Generated artifacts are intentionally not versioned:

- `macos/GardenApp/.build/`
- `macos/GardenApp/.release/`

Release packaging is handled by:

- `scripts/build-standalone-cli.mjs`
- `scripts/macos-release-build.sh`
