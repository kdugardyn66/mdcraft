#!/usr/bin/env bash
# Builds release binaries and packs them for Linux: a tarball, plus .deb and .rpm when
# nfpm (https://nfpm.goreleaser.com) is installed.   ./packaging/linux/package.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
VERSION=$(grep -m1 '^version' Cargo.toml | cut -d'"' -f2)
ARCH=$(uname -m)
cargo build --release -p mdcraft -p mdcraft-cli
STAGE=$(mktemp -d)
install -Dm755 target/release/mdcraft "$STAGE/usr/bin/mdcraft"
install -Dm755 target/release/mdcraft-cli "$STAGE/usr/bin/mdcraft-cli"
install -Dm644 packaging/linux/io.github.kdugardyn.mdcraft.desktop "$STAGE/usr/share/applications/io.github.kdugardyn.mdcraft.desktop"
install -Dm644 packaging/linux/io.github.kdugardyn.mdcraft.metainfo.xml "$STAGE/usr/share/metainfo/io.github.kdugardyn.mdcraft.metainfo.xml"
mkdir -p "$STAGE/usr/share/icons"
cp -r assets/app-icon/hicolor "$STAGE/usr/share/icons/hicolor"
for f in README.md LICENSE-MIT LICENSE-APACHE NOTICE THIRD_PARTY_NOTICES.md; do install -Dm644 "$f" "$STAGE/usr/share/doc/mdcraft/$f"; done
mkdir -p dist
tar -C "$STAGE" -czf "dist/mdcraft-$VERSION-linux-$ARCH.tar.gz" usr
echo "dist/mdcraft-$VERSION-linux-$ARCH.tar.gz"
if command -v nfpm >/dev/null; then
  export VERSION STAGE NFPM_ARCH=$([ "$ARCH" = x86_64 ] && echo amd64 || echo arm64)
  sed "s|\${STAGE}|$STAGE|g" packaging/linux/nfpm.yaml > "$STAGE/nfpm.yaml"
  nfpm package -f "$STAGE/nfpm.yaml" -p deb -t dist/
  nfpm package -f "$STAGE/nfpm.yaml" -p rpm -t dist/
fi
