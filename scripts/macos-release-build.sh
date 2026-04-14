#!/usr/bin/env bash
set -euo pipefail
export COPYFILE_DISABLE=1

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_PATH_DEFAULT="$ROOT_DIR/macos/GardenApp/dist/GardenApp.app"
RELEASE_DIR_DEFAULT="$ROOT_DIR/macos/GardenApp/.release"
ENTITLEMENTS_PATH="$ROOT_DIR/macos/GardenApp/GardenApp.entitlements"

APP_PATH="$APP_PATH_DEFAULT"
RELEASE_DIR="$RELEASE_DIR_DEFAULT"
VERSION=""
BUNDLE_VERSION=""
SIGN=false
NOTARIZE=false
GH_RELEASE_TAG=""

usage() {
  cat <<EOF
Usage: ./scripts/macos-release-build.sh [options]

Build installable macOS artifacts for the local Garden app bundle.

Options:
  --app-path <path>        App bundle to package (default: $APP_PATH_DEFAULT)
  --release-dir <path>     Output directory (default: $RELEASE_DIR_DEFAULT)
  --version <x.y.z>        Release version (default: package.json version)
  --bundle-version <n>     CFBundleVersion override (default: same as --version)
  --sign                   Sign the app, CLI binary, and package
  --notarize               Notarize the generated .pkg and .dmg
  --gh-release <tag>       Upload generated artifacts to an existing GitHub release
  --help                   Show this help

Signing env vars:
  DEVELOPER_ID_APPLICATION
  DEVELOPER_ID_INSTALLER
  APPLE_TEAM_ID
  APPLE_ID
  APPLE_APP_SPECIFIC_PASSWORD
EOF
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

info() {
  echo "==> $*"
}

read_package_version() {
  node -e 'const fs=require("node:fs"); const pkg=JSON.parse(fs.readFileSync("package.json","utf8")); console.log(pkg.version);'
}

find_identity() {
  local hint="$1"
  local explicit_identity="${2:-}"

  if [ -n "$explicit_identity" ]; then
    printf '%s\n' "$explicit_identity"
    return 0
  fi

  security find-identity -v -p codesigning 2>/dev/null | \
    grep "$hint" | \
    head -1 | \
    awk '{print $2}'
}

set_plist_value() {
  local plist_path="$1"
  local key="$2"
  local value="$3"

  if /usr/libexec/PlistBuddy -c "Print :$key" "$plist_path" >/dev/null 2>&1; then
    /usr/libexec/PlistBuddy -c "Set :$key $value" "$plist_path"
  else
    /usr/libexec/PlistBuddy -c "Add :$key string $value" "$plist_path"
  fi
}

notarize_file() {
  local artifact="$1"

  info "Submitting $(basename "$artifact") for notarization"
  xcrun notarytool submit "$artifact" \
    --apple-id "$APPLE_ID" \
    --password "$APPLE_APP_SPECIFIC_PASSWORD" \
    --team-id "$APPLE_TEAM_ID" \
    --wait

  info "Stapling $(basename "$artifact")"
  xcrun stapler staple "$artifact"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --app-path)
      APP_PATH="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
      shift 2
      ;;
    --release-dir)
      RELEASE_DIR="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
      shift 2
      ;;
    --version) VERSION="$2"; shift 2 ;;
    --bundle-version) BUNDLE_VERSION="$2"; shift 2 ;;
    --sign) SIGN=true; shift ;;
    --notarize) NOTARIZE=true; shift ;;
    --gh-release) GH_RELEASE_TAG="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) die "Unknown option: $1" ;;
  esac
done

if [ "$(uname -s)" != "Darwin" ]; then
  die "macos-release-build.sh must run on macOS."
fi

[ -d "$APP_PATH" ] || die "App bundle not found at $APP_PATH"
[ -f "$APP_PATH/Contents/Info.plist" ] || die "Info.plist not found in $APP_PATH"

VERSION="${VERSION:-$(cd "$ROOT_DIR" && read_package_version)}"
BUNDLE_VERSION="${BUNDLE_VERSION:-$VERSION}"

APP_BUNDLE_NAME="$(basename "$APP_PATH")"
APP_NAME="${APP_BUNDLE_NAME%.app}"
APP_LABEL="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleDisplayName' "$APP_PATH/Contents/Info.plist" 2>/dev/null || true)"
APP_LABEL="${APP_LABEL:-$APP_NAME}"
BUNDLE_ID="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$APP_PATH/Contents/Info.plist" 2>/dev/null || true)"
BUNDLE_ID="${BUNDLE_ID:-com.stangirard.garden.app}"
PKG_IDENTIFIER="${BUNDLE_ID}.installer"

APP_CERT=""
INSTALLER_CERT=""
if [ "$SIGN" = true ]; then
  APP_CERT="$(find_identity 'Developer ID Application' "${DEVELOPER_ID_APPLICATION:-}")"
  [ -n "$APP_CERT" ] || die "No Developer ID Application certificate found."

  INSTALLER_CERT="$(find_identity 'Developer ID Installer' "${DEVELOPER_ID_INSTALLER:-}")"
  [ -n "$INSTALLER_CERT" ] || die "No Developer ID Installer certificate found."
fi

if [ "$NOTARIZE" = true ]; then
  [ "$SIGN" = true ] || die "--notarize requires --sign"
  [ -n "${APPLE_ID:-}" ] || die "APPLE_ID is required for notarization"
  [ -n "${APPLE_APP_SPECIFIC_PASSWORD:-}" ] || die "APPLE_APP_SPECIFIC_PASSWORD is required for notarization"
  [ -n "${APPLE_TEAM_ID:-}" ] || die "APPLE_TEAM_ID is required for notarization"
fi

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/garden-release-XXXXXX")"
PAYLOAD_ROOT="$TMP_DIR/payload"
APP_INSTALL_DIR="$PAYLOAD_ROOT/Applications"
CLI_INSTALL_DIR="$PAYLOAD_ROOT/usr/local/bin"
DMG_SOURCE_DIR="$TMP_DIR/dmg"
STAGED_APP="$APP_INSTALL_DIR/$APP_BUNDLE_NAME"
STANDALONE_CLI="$CLI_INSTALL_DIR/garden"
CLI_ARTIFACT_PATH="$RELEASE_DIR/garden"
PKG_PATH="$RELEASE_DIR/${APP_NAME}-v${VERSION}.pkg"
DMG_PATH="$RELEASE_DIR/${APP_NAME}-v${VERSION}.dmg"

cleanup() {
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

mkdir -p "$APP_INSTALL_DIR" "$CLI_INSTALL_DIR" "$DMG_SOURCE_DIR" "$RELEASE_DIR"
rm -f "$PKG_PATH" "$DMG_PATH"

info "Building Garden CLI dist"
cd "$ROOT_DIR"
npm run build

info "Building standalone Garden CLI"
node ./scripts/build-standalone-cli.mjs --output "$CLI_ARTIFACT_PATH" --smoke-test

info "Staging $APP_BUNDLE_NAME"
ditto "$APP_PATH" "$STAGED_APP"
cp "$CLI_ARTIFACT_PATH" "$STANDALONE_CLI"
xattr -cr "$CLI_ARTIFACT_PATH" "$STANDALONE_CLI" "$STAGED_APP" 2>/dev/null || true
set_plist_value "$STAGED_APP/Contents/Info.plist" "CFBundleShortVersionString" "$VERSION"
set_plist_value "$STAGED_APP/Contents/Info.plist" "CFBundleVersion" "$BUNDLE_VERSION"

if [ "$SIGN" = true ]; then
  info "Signing standalone CLI"
  codesign --force --options runtime --timestamp --sign "$APP_CERT" "$CLI_ARTIFACT_PATH"
  codesign --verify --strict "$CLI_ARTIFACT_PATH"
  cp "$CLI_ARTIFACT_PATH" "$STANDALONE_CLI"
  codesign --verify --strict "$STANDALONE_CLI"

  info "Signing app bundle"
  CODESIGN_ARGS=(--force --deep --options runtime --timestamp --sign "$APP_CERT")
  if [ -f "$ENTITLEMENTS_PATH" ]; then
    CODESIGN_ARGS+=(--entitlements "$ENTITLEMENTS_PATH")
  fi
  codesign "${CODESIGN_ARGS[@]}" "$STAGED_APP"
  codesign --verify --deep --strict "$STAGED_APP"
fi

find "$PAYLOAD_ROOT" \( -name '.DS_Store' -o -name '._*' \) -delete

info "Building installer package"
PKGBUILD_ARGS=(
  --root "$PAYLOAD_ROOT"
  --identifier "$PKG_IDENTIFIER"
  --version "$VERSION"
  --ownership recommended
)
if [ "$SIGN" = true ]; then
  PKGBUILD_ARGS+=(--sign "$INSTALLER_CERT" --timestamp)
fi
pkgbuild "${PKGBUILD_ARGS[@]}" "$PKG_PATH"

info "Building DMG wrapper"
cp "$PKG_PATH" "$DMG_SOURCE_DIR/"
hdiutil create \
  -volname "$APP_LABEL Installer" \
  -srcfolder "$DMG_SOURCE_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH" >/dev/null

if [ "$NOTARIZE" = true ]; then
  notarize_file "$PKG_PATH"
  notarize_file "$DMG_PATH"
fi

if [ -n "$GH_RELEASE_TAG" ]; then
  command -v gh >/dev/null 2>&1 || die "gh CLI is required for --gh-release"
  info "Uploading artifacts to GitHub release $GH_RELEASE_TAG"
  gh release upload "$GH_RELEASE_TAG" "$PKG_PATH" "$DMG_PATH" --clobber
fi

echo
echo "Release artifacts:"
echo "  PKG: $PKG_PATH"
echo "  DMG: $DMG_PATH"
echo "  CLI: $CLI_ARTIFACT_PATH"
