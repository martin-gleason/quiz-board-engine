# Vendored dependencies

Per spec §2.3 (Zero CDN), every third-party asset the app loads at runtime lives here.
The app makes **no external network requests**. Nothing in this directory is ever
fetched, updated, or patched automatically.

## reveal.js

| | |
|---|---|
| Version | 5.2.1 |
| Source | https://github.com/hakimel/reveal.js/archive/refs/tags/5.2.1.tar.gz |
| Vendored on | 2026-08-16 |
| License | MIT (see `reveal.js/LICENSE`) |

Files copied from the release tarball's `dist/` directory, unmodified:

| File | SHA-256 |
|---|---|
| `reveal.esm.js` | `50e198be47bef94b553614bdc34979ac60f0a3c24a0280ff378fc3e877a64f01` |
| `reveal.esm.js.map` | (source map, dev only) |
| `reveal.css` | (core stylesheet) |
| `reset.css` | (CSS reset) |

**Deliberately not vendored:** the markdown plugin, highlight plugin, notes plugin,
and the bundled `theme/` directory. Spec §6.2 names "the markdown plugin is never
loaded" as an invariant — the safest way to honor that is for the file to not exist
in the repo at all. Board styling comes from `/themes/`, not reveal's themes.

## Upgrading

Vendoring is a deliberate, reviewed act, not a chore to automate:

1. Download the new release tarball from the URL pattern above.
2. Copy the same four `dist/` files plus `LICENSE`. Copy nothing else.
3. Record the new version, date, and `shasum -a 256` output in this file.
4. Re-run the full test matrix (`/tests/index.html`) in Chrome **and** Firefox, plus
   the Safari runbook in `docs/runbooks/`.
5. Commit the vendor bump on its own, with no other changes in the diff.
