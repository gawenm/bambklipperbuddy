# AI SLOP — YES, ON PURPOSE

> **Experimental, AI-assisted fork additions. Not an official upstream Bambuddy release.**

This fork is deliberately labeled **AI SLOP**. Its custom printer-provider work — including **OctoPrint**, **Klipper/Moonraker**, unified **Bambu / OctoPrint / Klipper** printer cards, per-printer camera settings, Cam Wall tiles, and related UI controls — was developed with significant AI assistance. This is an authorship and quality warning, not a warranty.

## What you should expect

- **AI SLOP:** generated and AI-edited code can be wrong, insecure, incomplete, or fragile.
- **Work in progress:** building successfully does not prove safe hardware operation.
- **Review before use:** check code changes, especially print start/stop, printer credentials, camera proxies, and access controls.
- **Keep credentials private:** never commit OctoPrint API keys, Moonraker authentication secrets, `.env` files, printer registries, or database/volume backups. Configure individual printers using the local web UI.
- **No implied upstream endorsement:** this is a fork of [Bambuddy](https://github.com/maziggy/bambuddy). The **AI SLOP** label describes the *additional work in this fork*, not upstream maintainers or their code.

## Intended fork functionality

- Add multiple OctoPrint printers through the UI.
- Add multiple Klipper/Moonraker printers through the UI.
- Give each printer its own camera URL and Cam Wall tile.
- Show printer-specific cards next to Bambu cards in a unified grid.
- Use labeled Add Bambu / Add Octo / Add Klipper controls, with card size options.

Some of these additions may exist only on development branches until published and merged; consult the repository's branch and commit history for the actual implementation.

## Attribution

Original Bambuddy project: https://github.com/maziggy/bambuddy

**AI SLOP. Human supervision still required.**
