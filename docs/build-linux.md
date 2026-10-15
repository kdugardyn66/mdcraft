# Building mdcraft on Linux

This manual explains how to build mdcraft from source on Linux, install it, and package it for
other computers. The short version:

```sh
git clone https://github.com/kdugardyn/mdcraft.git
cd mdcraft
./build-linux.sh --install
```

That installs everything mdcraft needs to build, compiles it, makes a package in `dist/` and adds
**mdcraft** to your applications menu. The rest of this manual explains each step, the options,
and what to do when something goes wrong.

---

## Contents

1. [Requirements](#1-requirements)
2. [Get the source](#2-get-the-source)
3. [Build with the script](#3-build-with-the-script)
4. [What the script does](#4-what-the-script-does)
5. [Build by hand](#5-build-by-hand)
6. [Install, run and uninstall](#6-install-run-and-uninstall)
7. [Packages for other computers](#7-packages-for-other-computers)
8. [Updating](#8-updating)
9. [Troubleshooting](#9-troubleshooting)

---

## 1. Requirements

### Supported distributions

mdcraft's window uses **WebKitGTK 4.1**, so the distribution must ship it.

| Family | Distributions | Minimum version |
|---|---|---|
| Debian / Ubuntu (`apt`) | Ubuntu, Kubuntu, Xubuntu, Debian, Linux Mint, Zorin OS, Pop!_OS, elementary OS, KDE neon, Kali, Raspberry Pi OS | Ubuntu 22.04, Debian 12, Mint 21, Zorin 17, Pop!_OS 22.04, elementary 7 |
| Fedora / Red Hat (`dnf`) | Fedora, Red Hat Enterprise Linux, Rocky Linux, AlmaLinux, CentOS Stream, Oracle Linux | Fedora 37, RHEL / Rocky / Alma 9 |
| SUSE (`zypper`) | openSUSE Tumbleweed, openSUSE Leap, SUSE Linux Enterprise | Leap 15.5, SLE 15 SP5 |
| Arch (`pacman`) | Arch Linux, Manjaro, EndeavourOS, Garuda | current |
| Others | Alpine (`apk`), Void (`xbps`), Solus (`eopkg`) | current |

Older releases (Ubuntu 20.04, Debian 11, RHEL 8, …) only have WebKitGTK 4.0 and can't build
mdcraft.

### Hardware and disk space

- x86_64 (Intel/AMD) or aarch64 (ARM64, e.g. Raspberry Pi 4/5 with a 64-bit OS)
- About **4 GB of free disk space** for the build (the `target/` folder) and Rust
- 2 GB of RAM or more; the first build takes 3–10 minutes, later builds are faster

### Software

| What | Why | Installed by the script |
|---|---|---|
| A C compiler, `make`, `pkg-config`, `curl` | building the Rust libraries that wrap system libraries | yes |
| WebKitGTK 4.1 and GTK 3 development files | the window and the web view | yes |
| Rust 1.85 or newer | compiling mdcraft | yes (with rustup, for your user only) |
| `git` | getting the source | no — `sudo apt install git`, `sudo dnf install git`, … |
| [nfpm](https://nfpm.goreleaser.com) | making `.deb` and `.rpm` installers | no, optional |

You need **sudo rights** to install system packages. Rust and mdcraft itself can be installed
without them.

---

## 2. Get the source

With Git:

```sh
git clone https://github.com/kdugardyn/mdcraft.git
cd mdcraft
```

Or download the ZIP from GitHub (**Code › Download ZIP**), unpack it and open a terminal in the
`mdcraft` folder.

If the script has lost its "executable" permission (this happens with some ZIP tools), restore it:

```sh
chmod +x build-linux.sh packaging/linux/package.sh
```

---

## 3. Build with the script

`build-linux.sh` is in the root of the source folder.

```sh
./build-linux.sh [options]
```

| Command | What it does |
|---|---|
| `./build-linux.sh` | install build dependencies, build, make `dist/mdcraft-<version>-linux-<arch>.tar.gz` |
| `./build-linux.sh --install` | … and install for **your user** in `~/.local` (no sudo needed for this part) |
| `./build-linux.sh --install-system` | … and install for **all users** in `/usr/local` (uses sudo) |
| `./build-linux.sh --run` | … and start mdcraft when the build is done |
| `./build-linux.sh --no-deps` | skip installing system packages (use this when they're already there, or on unsupported distributions) |
| `./build-linux.sh --uninstall` | remove an install from `~/.local` |
| `./build-linux.sh --uninstall --system` | remove an install from `/usr/local` |
| `./build-linux.sh --help` | show the options |

Options can be combined, for example `./build-linux.sh --no-deps --install --run`.

The script stops at the first error and says what went wrong.

---

## 4. What the script does

1. **Recognises the distribution** from `/etc/os-release` (also derivatives: Linux Mint and Zorin OS
   are recognised as Ubuntu, Rocky as RHEL, and so on).
2. **Installs the build packages** with the distribution's package manager. On Fedora, RHEL and
   SUSE it asks for the libraries by their pkg-config name (`pkgconfig(webkit2gtk-4.1)`), so it
   works whatever the distribution calls the package. On RHEL and its rebuilds it first enables
   the **CodeReady Builder (CRB)** repository, where the development packages live.
3. **Checks** that WebKitGTK 4.1 and GTK 3 are really there and prints their versions.
4. **Installs or updates Rust** with [rustup](https://rustup.rs) when `cargo` is missing or older
   than 1.85. Rust goes into `~/.rustup` and `~/.cargo` and doesn't touch the system.
5. **Builds** `mdcraft` and `mdcraft-cli` in release mode (`target/release/`).
6. **Packages** them with the menu entry, icons, AppStream metadata and licences into
   `dist/mdcraft-<version>-linux-<arch>.tar.gz`, and into `.deb` and `.rpm` installers when nfpm
   is installed.
7. With `--install`: **copies** everything into `~/.local` or `/usr/local` and refreshes the
   application menu and icon caches.

### What gets installed where

| File | `--install` | `--install-system` |
|---|---|---|
| The app | `~/.local/bin/mdcraft` | `/usr/local/bin/mdcraft` |
| Command-line tool | `~/.local/bin/mdcraft-cli` | `/usr/local/bin/mdcraft-cli` |
| Menu entry | `~/.local/share/applications/io.github.kdugardyn.mdcraft.desktop` | `/usr/local/share/applications/…` |
| Icons | `~/.local/share/icons/hicolor/*/apps/io.github.kdugardyn.mdcraft.*` | `/usr/local/share/icons/hicolor/…` |
| Software-centre metadata | `~/.local/share/metainfo/…` | `/usr/local/share/metainfo/…` |
| Licences and README | `~/.local/share/doc/mdcraft/` | `/usr/local/share/doc/mdcraft/` |

mdcraft keeps your preferences, recent documents and recovery copies in `~/.config/mdcraft`
(or `$XDG_CONFIG_HOME/mdcraft`). Uninstalling leaves that folder alone.

---

## 5. Build by hand

If you prefer to run the steps yourself, or your distribution isn't recognised:

### 5.1 Build packages

```sh
# Ubuntu, Debian, Linux Mint, Zorin OS, Pop!_OS, elementary OS
sudo apt update
sudo apt install build-essential curl pkg-config file libwebkit2gtk-4.1-dev libgtk-3-dev

# Fedora
sudo dnf install gcc gcc-c++ make curl pkgconf-pkg-config 'pkgconfig(webkit2gtk-4.1)' 'pkgconfig(gtk+-3.0)'

# RHEL 9, Rocky Linux 9, AlmaLinux 9 (enable CodeReady Builder first)
sudo dnf install dnf-plugins-core
sudo dnf config-manager --set-enabled crb
#   on RHEL itself: sudo subscription-manager repos --enable codeready-builder-for-rhel-9-$(uname -m)-rpms
sudo dnf install gcc gcc-c++ make curl pkgconf-pkg-config 'pkgconfig(webkit2gtk-4.1)' 'pkgconfig(gtk+-3.0)'

# openSUSE Tumbleweed / Leap, SUSE Linux Enterprise
sudo zypper install -t pattern devel_basis
sudo zypper install curl pkg-config 'pkgconfig(webkit2gtk-4.1)' 'pkgconfig(gtk+-3.0)'

# Arch Linux, Manjaro, EndeavourOS
sudo pacman -S --needed base-devel curl pkgconf webkit2gtk-4.1 gtk3

# Alpine
sudo apk add build-base curl pkgconf webkit2gtk-4.1-dev gtk+3.0-dev

# Void
sudo xbps-install -S base-devel curl pkg-config webkit2gtk-devel gtk+3-devel
```

Check the result:

```sh
pkg-config --modversion webkit2gtk-4.1 gtk+-3.0
```

Two version numbers mean you're ready. "Package … was not found" means the development files are
missing.

### 5.2 Rust

```sh
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh
source "$HOME/.cargo/env"
rustc --version        # 1.85 or newer
```

Don't use the `rustc`/`cargo` packages of older distributions: they're usually too old. If you
have them, remove them or make sure `~/.cargo/bin` comes first in your `PATH`.

### 5.3 Build and run

```sh
cargo build --release -p mdcraft -p mdcraft-cli
./target/release/mdcraft                     # the app
./target/release/mdcraft notes.md            # open a document
./target/release/mdcraft --template report   # a new document from a template
./target/release/mdcraft-cli templates       # list the templates
```

### 5.4 Package

```sh
./packaging/linux/package.sh                 # dist/mdcraft-<version>-linux-<arch>.tar.gz (+ .deb/.rpm with nfpm)
```

---

## 6. Install, run and uninstall

### Start mdcraft

- From the applications menu: **mdcraft** (category Office). Right-click the entry for
  **New document** and **New presentation**.
- From a terminal: `mdcraft`, `mdcraft file.md`, or `mdcraft --template pitch`.

After a `--install` for your user, `mdcraft` works in a terminal only when `~/.local/bin` is in
your `PATH`. Most distributions add it automatically; otherwise:

```sh
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc     # or ~/.zshrc
```

then open a new terminal. The menu entry works either way: it uses the full path.

### Open Markdown files with mdcraft

Right-click a `.md` file in your file manager › **Open With** › **mdcraft**, and tick *always use*
if your file manager offers it. Or from a terminal:

```sh
xdg-mime default io.github.kdugardyn.mdcraft.desktop text/markdown
```

### Install a tarball made elsewhere

```sh
# for your user
tar -xzf mdcraft-0.1.0-linux-x86_64.tar.gz -C /tmp
cp -r /tmp/usr/bin /tmp/usr/share ~/.local/
sed -i "s|^Exec=mdcraft|Exec=$HOME/.local/bin/mdcraft|; s|^TryExec=mdcraft|TryExec=$HOME/.local/bin/mdcraft|" \
  ~/.local/share/applications/io.github.kdugardyn.mdcraft.desktop

# or for everyone
sudo tar -xzf mdcraft-0.1.0-linux-x86_64.tar.gz -C /usr/local --strip-components=1
```

The target computer needs the WebKitGTK 4.1 **runtime** (not the development files):

| Distribution | Runtime packages |
|---|---|
| Ubuntu, Debian, Mint, Zorin | `libwebkit2gtk-4.1-0 libgtk-3-0` |
| Fedora, RHEL | `webkit2gtk4.1 gtk3` |
| openSUSE | `libwebkit2gtk-4_1-0 gtk3` (or `zypper in 'libwebkit2gtk-4.1.so.0()(64bit)'`) |
| Arch | `webkit2gtk-4.1 gtk3` |

Most desktop installations already have them.

### Optional helpers

These aren't needed to run mdcraft, but some features use them when present:

| Program | Used for |
|---|---|
| `ffmpeg` | playing MKV, AVI and other videos that the web view can't play directly |
| Java + `plantuml.jar` | PlantUML diagrams (Mermaid, Graphviz and charts work without it) |
| `python3` | code chunks (```` ```python {cmd=true} ````), off until you allow them in **File › Options** |
| `xdg-utils` | opening links in your browser and showing files in the file manager |

### Uninstall

```sh
./build-linux.sh --uninstall            # from ~/.local
./build-linux.sh --uninstall --system   # from /usr/local
rm -rf ~/.config/mdcraft                # also remove preferences and recovery copies (optional)
```

If you installed a `.deb` or `.rpm`: `sudo apt remove mdcraft` or `sudo dnf remove mdcraft`.

---

## 7. Packages for other computers

### Tarball, .deb and .rpm

`build-linux.sh` (and `packaging/linux/package.sh`) always makes the tarball. Install nfpm to also
get installers:

```sh
# any distribution, with Go installed:
go install github.com/goreleaser/nfpm/v2/cmd/nfpm@latest
# or download a release from https://github.com/goreleaser/nfpm/releases
./build-linux.sh --no-deps
ls dist/      # mdcraft-<version>-linux-x86_64.tar.gz, mdcraft_<version>_amd64.deb, mdcraft-<version>.x86_64.rpm
```

The `.deb` and `.rpm` declare their runtime dependencies, so `sudo apt install ./mdcraft_….deb`
or `sudo dnf install ./mdcraft-….rpm` pulls in WebKitGTK automatically.

### Which systems a build runs on

A Linux program runs on the distribution it was built on and on **newer** ones, but not on older
ones (it needs at least the same version of the C library, glibc). So build on the **oldest**
system you want to support:

| Built on | Runs on (among others) |
|---|---|
| Ubuntu 22.04 | Ubuntu 22.04+, Mint 21+, Zorin 17+, Pop!_OS 22.04+, Debian 12+, Fedora 36+, RHEL 9+ (with WebKitGTK 4.1 installed) |
| Ubuntu 24.04 | Ubuntu 24.04+, Mint 22+, Debian 13+, Fedora 40+ |

### Build in a container

You don't need to install an old distribution to build for it. With Docker or Podman:

```sh
podman run --rm -it -v "$PWD":/src:Z -w /src -e DEBIAN_FRONTEND=noninteractive \
  docker.io/library/ubuntu:22.04 ./build-linux.sh
```

(Replace `podman` with `docker` and drop `:Z` if you use Docker.) The package appears in `dist/`
on your own computer. Files made by the container may belong to root; fix that with
`sudo chown -R "$USER": dist target`.

The same works for other targets, for example `registry.fedoraproject.org/fedora:40` or
`docker.io/opensuse/leap:15.6`.

### GitHub Actions

Every push to GitHub runs `.github/workflows/ci.yml`, which builds and tests mdcraft on Linux,
macOS and Windows. The programs can be downloaded from **Actions › (latest run) › Artifacts**.
The Linux job runs on `ubuntu-24.04`; change it to `ubuntu-22.04` if the downloads must run on
Ubuntu 22.04 and Mint 21.

---

## 8. Updating

```sh
cd mdcraft
git pull
./build-linux.sh --no-deps --install
```

Cargo only rebuilds what changed, so updates take about a minute. Add the dependency step back
(drop `--no-deps`) after a distribution upgrade.

To free disk space after building: `cargo clean` removes `target/` (several GB); the next build
starts from scratch.

---

## 9. Troubleshooting

### "WebKitGTK 4.1 development files were not found"

- Your distribution is too old: see [Supported distributions](#supported-distributions). Use a
  package built on a supported system, or build in a container (section 7).
- On RHEL, Rocky or AlmaLinux: the CodeReady Builder repository isn't enabled. Run
  `sudo dnf config-manager --set-enabled crb` (on RHEL: the `subscription-manager` command in
  section 5.1) and try again.
- On Debian: make sure the `main` repository is enabled and run `sudo apt update`.

### "Rust … is too old"

The distribution's Rust is older than 1.85. Install rustup (section 5.2); if `which cargo` still
shows `/usr/bin/cargo`, remove the distribution package (`sudo apt remove rustc cargo`,
`sudo dnf remove rust cargo`) or put `~/.cargo/bin` first in your `PATH`.

### The window opens but stays white or grey

Some graphics drivers (NVIDIA, virtual machines) have trouble with WebKitGTK's hardware
rendering. mdcraft already turns off the most common culprit (`WEBKIT_DISABLE_DMABUF_RENDERER=1`).
If the window is still empty, try:

```sh
WEBKIT_DISABLE_COMPOSITING_MODE=1 mdcraft
LIBGL_ALWAYS_SOFTWARE=1 mdcraft
```

and update your graphics driver. Set `MDCRAFT_KEEP_DMABUF=1` to switch mdcraft's own workaround off.

### "cannot create the web view (is WebKitGTK 4.1 installed?)"

The runtime library is missing on this computer: install the runtime packages from section 6.

### mdcraft isn't in the applications menu

Log out and in again, or run:

```sh
update-desktop-database ~/.local/share/applications
```

### `mdcraft: command not found` in a terminal

`~/.local/bin` isn't in your `PATH`: see [Start mdcraft](#start-mdcraft).

### Build stops with "linker `cc` not found" or "could not find system library"

The compiler or a development package is missing: run `./build-linux.sh` without `--no-deps`,
or install the packages from section 5.1.

### The build is killed or the computer freezes

The compiler ran out of memory (common on small virtual machines or a Raspberry Pi). Build with
fewer parallel jobs:

```sh
CARGO_BUILD_JOBS=1 ./build-linux.sh
```

or add swap space.

### No network during the build

The first build downloads Rust libraries from crates.io. On a machine without internet, run
`cargo vendor` on a connected machine, copy the folder over and follow the instructions it prints.

### Wayland

mdcraft runs on Wayland and X11 desktops (GNOME, KDE Plasma, Cinnamon, Xfce, …). If something
looks wrong on Wayland, try the X11 path: `GDK_BACKEND=x11 mdcraft`.

### Still stuck?

Run mdcraft from a terminal so you can see its messages, and include them, your distribution
(`cat /etc/os-release`) and the output of `pkg-config --modversion webkit2gtk-4.1` when you
report the problem.
