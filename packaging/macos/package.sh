#!/usr/bin/env bash
# Builds mdcraft.app (universal) and a .dmg.   ./packaging/macos/package.sh
# Sign afterwards with: codesign --deep --force --options runtime -s "Developer ID Application: …" dist/mdcraft.app
set -euo pipefail
cd "$(dirname "$0")/../.."
VERSION=$(grep -m1 '^version' Cargo.toml | cut -d'"' -f2)
export MACOSX_DEPLOYMENT_TARGET=11.0
rustup target add aarch64-apple-darwin x86_64-apple-darwin >/dev/null
for t in aarch64-apple-darwin x86_64-apple-darwin; do cargo build --release --target $t -p mdcraft -p mdcraft-cli; done
APP=dist/mdcraft.app
rm -rf "$APP"; mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
for b in mdcraft mdcraft-cli; do
  lipo -create target/aarch64-apple-darwin/release/$b target/x86_64-apple-darwin/release/$b -output "$APP/Contents/MacOS/$b"
done
sed "s/@VERSION@/$VERSION/g" packaging/macos/Info.plist.in > "$APP/Contents/Info.plist"
cp assets/app-icon/mdcraft.icns "$APP/Contents/Resources/mdcraft.icns"
hdiutil create -volname mdcraft -srcfolder "$APP" -ov -format UDZO "dist/mdcraft-$VERSION-macos-universal.dmg"
