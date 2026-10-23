# Security policy

## Supported versions

Only the [latest release](https://github.com/saxenaxoxo/asset-library/releases/latest) gets security
fixes. Please update before reporting.

## Reporting a vulnerability

Please don't open a public issue for a security problem.

- **Preferred:** report it privately on GitHub, under
  [Security → Report a vulnerability](https://github.com/saxenaxoxo/asset-library/security/advisories/new).
- **Or email** saxenascloud@gmail.com with "Asset Library security" in the subject.

Include what you found, the steps to reproduce it, the version of Goated Panels Hub and the panel, your
macOS version and your Premiere Pro version. Proof-of-concept files are welcome.

You'll get a reply as soon as possible. Once a fix is released, you'll be credited in the release notes
unless you'd rather not be.

## What's in scope

- Goated Panels Hub (the desktop app and background engine) and its installers.
- The Asset Library panel for Premiere Pro (CEP and UXP builds).
- This repository's build and release workflows.

Things that are worth reporting include reading or writing files outside what the app needs, the panel or
app being made to run code, the installer replacing files it shouldn't, and secrets in this repository.

## Out of scope

- The macOS warning on first launch: the installers aren't code-signed or notarized yet, and the README
  says so.
- Problems in Premiere Pro, Electron, Chromium or FFmpeg themselves. Please report those upstream. If
  Asset Library ships an affected version, an issue asking for an update is welcome.
