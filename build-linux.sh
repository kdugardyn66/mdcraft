#!/usr/bin/env bash
# mdcraft — build for Linux in one go.
#
#   ./build-linux.sh                  install build dependencies, build, make dist/*.tar.gz
#   ./build-linux.sh --install        … and install for the current user (~/.local)
#   ./build-linux.sh --install-system … and install for all users (/usr/local, uses sudo)
#   ./build-linux.sh --run            … and start mdcraft
#   ./build-linux.sh --no-deps        skip installing system packages (they're already there)
#   ./build-linux.sh --uninstall      remove a ~/.local (or, with --system, /usr/local) install
#   ./build-linux.sh --help
#
# Supported: Ubuntu, Debian, Linux Mint, Zorin OS, Pop!_OS, elementary OS, Kali (apt) ·
# Fedora, RHEL 9+, Rocky, AlmaLinux, CentOS Stream (dnf) · openSUSE Leap/Tumbleweed, SUSE (zypper) ·
# Arch, Manjaro, EndeavourOS (pacman) · Alpine (apk) · Void (xbps) · Solus (eopkg).
# Others: install WebKitGTK 4.1 + GTK 3 development files and a C compiler, then use --no-deps.
#
# mdcraft needs WebKitGTK 4.1: Ubuntu 22.04+, Debian 12+, Mint 21+, Zorin 17+, Fedora 37+,
# RHEL 9+, openSUSE Leap 15.5+/Tumbleweed, current Arch.

set -euo pipefail
cd "$(dirname "$0")"

# ---------------------------------------------------------------- options
DEPS=1 INSTALL="" RUN=0 UNINSTALL=0
for a in "$@"; do
  case "$a" in
    --no-deps) DEPS=0 ;;
    --install) INSTALL=user ;;
    --install-system|--system) INSTALL=system ;;
    --run) RUN=1 ;;
    --uninstall) UNINSTALL=1 ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $a (try --help)"; exit 2 ;;
  esac
done

bold() { printf '\n\033[1m==> %s\033[0m\n' "$*"; }
die() { printf '\n\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"

APP_ID=io.github.kdugardyn.mdcraft
if [ "$INSTALL" = system ]; then PREFIX=/usr/local; else PREFIX="$HOME/.local"; fi

# ---------------------------------------------------------------- uninstall
if [ "$UNINSTALL" = 1 ]; then
  [ "$INSTALL" = system ] || PREFIX="$HOME/.local"
  S=""; [ "$PREFIX" = /usr/local ] && S="$SUDO"
  bold "Removing mdcraft from $PREFIX"
  $S rm -f "$PREFIX/bin/mdcraft" "$PREFIX/bin/mdcraft-cli" \
    "$PREFIX/share/applications/$APP_ID.desktop" "$PREFIX/share/metainfo/$APP_ID.metainfo.xml"
  $S find "$PREFIX/share/icons/hicolor" -name "$APP_ID.*" -delete 2>/dev/null || true
  command -v update-desktop-database >/dev/null && $S update-desktop-database "$PREFIX/share/applications" 2>/dev/null || true
  echo "Done. (Your settings stay in ~/.config/mdcraft.)"
  exit 0
fi

# ---------------------------------------------------------------- 1. system packages
[ -r /etc/os-release ] && . /etc/os-release
DISTRO="${ID:-unknown} ${ID_LIKE:-}"
bold "Linux: ${PRETTY_NAME:-unknown}"

install_deps() {
  case " $DISTRO " in
    *" alpine "*)
      $SUDO apk add --no-cache build-base curl pkgconf webkit2gtk-4.1-dev gtk+3.0-dev ;;
    *" arch "*|*" manjaro "*|*" endeavouros "*|*" garuda "*)
      $SUDO pacman -S --needed --noconfirm base-devel curl pkgconf webkit2gtk-4.1 gtk3 ;;
    *" opensuse"*|*" suse "*|*" sles "*|*" sled "*)
      # by pkg-config name: works whatever SUSE calls the package
      $SUDO zypper --non-interactive install -t pattern devel_basis || true
      $SUDO zypper --non-interactive install curl pkg-config 'pkgconfig(webkit2gtk-4.1)' 'pkgconfig(gtk+-3.0)' ;;
    *" fedora "*|*" rhel "*|*" centos "*|*" rocky "*|*" almalinux "*|*" ol "*|*" amzn "*)
      if [[ " $DISTRO " != *" fedora "* ]]; then
        # RHEL and rebuilds keep the -devel packages in CodeReady Builder (CRB)
        $SUDO dnf install -y dnf-plugins-core || true
        $SUDO dnf config-manager --set-enabled crb 2>/dev/null \
          || $SUDO dnf config-manager --set-enabled powertools 2>/dev/null \
          || { command -v subscription-manager >/dev/null && $SUDO subscription-manager repos --enable "codeready-builder-for-rhel-${VERSION_ID%%.*}-$(uname -m)-rpms"; } \
          || true
      fi
      $SUDO dnf install -y gcc gcc-c++ make curl pkgconf-pkg-config 'pkgconfig(webkit2gtk-4.1)' 'pkgconfig(gtk+-3.0)' ;;
    *" void "*)
      $SUDO xbps-install -Sy base-devel curl pkg-config webkit2gtk-devel gtk+3-devel ;;
    *" solus "*)
      $SUDO eopkg install -y -c system.devel && $SUDO eopkg install -y curl libwebkit-gtk41-devel libgtk-3-devel ;;
    *" debian "*|*" ubuntu "*|*" linuxmint "*|*" zorin "*|*" pop "*|*" elementary "*|*" kali "*|*" neon "*|*" raspbian "*)
      $SUDO apt-get update
      $SUDO apt-get install -y build-essential curl pkg-config file libwebkit2gtk-4.1-dev libgtk-3-dev ;;
    *)
      die "I don't know how to install packages on '${ID:-this system}'.
Install WebKitGTK 4.1 and GTK 3 development files, a C compiler, pkg-config and curl,
then run: ./build-linux.sh --no-deps" ;;
  esac
}

if [ "$DEPS" = 1 ]; then
  bold "Installing build dependencies"
  install_deps
fi

command -v pkg-config >/dev/null || die "pkg-config is missing."
pkg-config --exists webkit2gtk-4.1 || die "WebKitGTK 4.1 development files were not found.
mdcraft needs WebKitGTK 4.1 (Ubuntu 22.04+, Debian 12+, Fedora 37+, RHEL 9+, openSUSE 15.5+).
On older systems, use the build from GitHub Actions instead."
pkg-config --exists gtk+-3.0 || die "GTK 3 development files were not found."
echo "WebKitGTK $(pkg-config --modversion webkit2gtk-4.1), GTK $(pkg-config --modversion gtk+-3.0)"

# ---------------------------------------------------------------- 2. Rust
NEED_RUST=1.85
[ -f "$HOME/.cargo/env" ] && . "$HOME/.cargo/env"
version_ok() { [ "$(printf '%s\n%s\n' "$NEED_RUST" "$1" | sort -V | head -1)" = "$NEED_RUST" ]; }
if ! command -v cargo >/dev/null; then
  bold "Installing Rust (rustup, for this user only)"
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --profile minimal
  . "$HOME/.cargo/env"
fi
RUSTV=$(rustc --version | awk '{print $2}')
if ! version_ok "$RUSTV"; then
  if command -v rustup >/dev/null; then
    bold "Updating Rust $RUSTV → stable"; rustup update stable; rustup default stable
  else
    die "Rust $RUSTV is too old (need $NEED_RUST+). Your distribution's Rust is out of date:
remove it, or install rustup from https://rustup.rs and run this script again."
  fi
fi
echo "Rust $(rustc --version | awk '{print $2}')"

# ---------------------------------------------------------------- 3. build
bold "Building mdcraft (release)"
cargo build --release -p mdcraft -p mdcraft-cli

# ---------------------------------------------------------------- 4. package
bold "Packaging"
VERSION=$(grep -m1 '^version' Cargo.toml | cut -d'"' -f2)
ARCH=$(uname -m)
STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
install -Dm755 target/release/mdcraft     "$STAGE/usr/bin/mdcraft"
install -Dm755 target/release/mdcraft-cli "$STAGE/usr/bin/mdcraft-cli"
install -Dm644 packaging/linux/$APP_ID.desktop      "$STAGE/usr/share/applications/$APP_ID.desktop"
install -Dm644 packaging/linux/$APP_ID.metainfo.xml "$STAGE/usr/share/metainfo/$APP_ID.metainfo.xml"
mkdir -p "$STAGE/usr/share/icons" && cp -r assets/app-icon/hicolor "$STAGE/usr/share/icons/hicolor"
for f in README.md LICENSE-MIT LICENSE-APACHE NOTICE THIRD_PARTY_NOTICES.md; do install -Dm644 "$f" "$STAGE/usr/share/doc/mdcraft/$f"; done
mkdir -p dist
TARBALL="dist/mdcraft-$VERSION-linux-$ARCH.tar.gz"
tar -C "$STAGE" -czf "$TARBALL" usr
echo "$TARBALL"
if command -v nfpm >/dev/null; then
  export VERSION STAGE NFPM_ARCH; NFPM_ARCH=$([ "$ARCH" = x86_64 ] && echo amd64 || echo arm64)
  sed "s|\${STAGE}|$STAGE|g" packaging/linux/nfpm.yaml > "$STAGE/nfpm.yaml"
  nfpm package -f "$STAGE/nfpm.yaml" -p deb -t dist/ && nfpm package -f "$STAGE/nfpm.yaml" -p rpm -t dist/
else
  echo "(Install nfpm — https://nfpm.goreleaser.com — to also get .deb and .rpm installers.)"
fi

# ---------------------------------------------------------------- 5. install
if [ -n "$INSTALL" ]; then
  S=""; [ "$INSTALL" = system ] && S="$SUDO"
  bold "Installing into $PREFIX"
  $S mkdir -p "$PREFIX"
  # the menu entry uses the full path: not every desktop has ~/.local/bin on its PATH
  sed -i "s|^Exec=mdcraft|Exec=$PREFIX/bin/mdcraft|; s|^TryExec=mdcraft|TryExec=$PREFIX/bin/mdcraft|" "$STAGE/usr/share/applications/$APP_ID.desktop"
  $S cp -r "$STAGE/usr/bin" "$STAGE/usr/share" "$PREFIX/"
  $S rm -rf "$PREFIX/share/doc/mdcraft" 2>/dev/null; $S cp -r "$STAGE/usr/share/doc/mdcraft" "$PREFIX/share/doc/" 2>/dev/null || true
  command -v update-desktop-database >/dev/null && $S update-desktop-database "$PREFIX/share/applications" 2>/dev/null || true
  command -v gtk-update-icon-cache >/dev/null && $S gtk-update-icon-cache -q -t "$PREFIX/share/icons/hicolor" 2>/dev/null || true
  echo "mdcraft is in your applications menu."
  if [ "$INSTALL" = user ] && [[ ":$PATH:" != *":$HOME/.local/bin:"* ]]; then
    echo "Add ~/.local/bin to your PATH to run 'mdcraft' from a terminal:"
    echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
  fi
fi

bold "Done"
echo "Run it:      ./target/release/mdcraft"
echo "Package:     $TARBALL"
if [ "$RUN" = 1 ]; then exec ./target/release/mdcraft; fi
