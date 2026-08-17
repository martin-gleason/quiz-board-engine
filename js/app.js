// SPDX-License-Identifier: AGPL-3.0-or-later
//
// app.js — Quiz Board Engine · the composition root (ratified delta D8)
//
// ROLE: this module SEQUENCES. It contains no schema knowledge, no fetch logic, no DOM
// construction, and no game rules — only the order in which the other modules are called and what
// happens when one of them says no. Every line here is "call this, check `ok`, call that."
//
// WHY IT EXISTS AT ALL (delta D8, ratified 2026-08-17 — "modularity is key"). Spec §3 names five
// modules. Without a sixth, the orchestration — read `?game=`, fetch, validate, branch to the error
// screen or to the board — has nowhere to live but inside `loader.js`, which would then have to
// import `validator` and `renderer` and collapse the module boundary CLAUDE.md names as an
// invariant. `app.js` is a SINK: nothing imports it (module-contracts §2), so keeping it honest
// costs nothing and buys the boundary.
//
// ---------------------------------------------------------------------------------------------
// NO PARTIAL RENDER, EVER (spec §5, CLAUDE.md named invariant)
// ---------------------------------------------------------------------------------------------
// The three stages below are strictly sequential and each one stops the boot on failure. Nothing
// is drawn on a failed load — not a board with holes in it, not a board with placeholder values.
// The host must never have to wonder whether what is projected in front of a room is complete, so
// the failure path hides the (empty) reveal container and gives the whole screen to the error
// report. Reveal is not even initialised.

import * as loader from './loader.js';
import * as validator from './validator.js';
import * as errors from './errors.js';
import * as renderer from './renderer.js';

// Vendored reveal.css is linked by index.html so it applies before first paint. These constants
// exist so `ensureVendorStyles()` can prove the links are there when app.js is booted into some
// other page (the test runner, a fixture harness) that did not think to add them.
const VENDOR_STYLES = Object.freeze([
  { id: 'qbe-vendor-reset', href: 'vendor/reveal.js/reset.css' },
  { id: 'qbe-vendor-reveal', href: 'vendor/reveal.js/reveal.css' },
]);

/**
 * Read `?game=`, fetch the three documents, validate them.
 *
 * @returns {Promise<{ok:true,value:CleanedBundle,raw:RawBundle} | {ok:false,failures:[]}>}
 *
 * Exported separately from `boot` so /tests/index.html can assert the whole pipeline without a
 * board, a theme, or a reveal instance in play — the reason delta D8 preferred a module over an
 * inline `<script>` in index.html.
 *
 * `raw` rides along on success because F6 needs `rawBundle.content.text` to hash the content file
 * (module-contracts §10 step 4) and re-fetching it to get the same bytes would be a second network
 * round trip for data we already hold.
 */
export async function loadAndValidate(search) {
  const param = new URLSearchParams(search || '').get('game');

  // STAGE 1 — the URL parameter. Spec §6.3: same-origin, under games/, ending .json. A hostile
  // link wearing our domain dies here, before anything is fetched.
  const resolved = loader.resolveGameParam(param);
  if (!resolved.ok) return resolved;

  // STAGE 2 — fetch. A 404 on the game-type file is a validation failure, not a crash (spec §5).
  const fetched = await loader.fetchContentBundle({ gamePath: resolved.value });
  if (!fetched.ok) return fetched;

  // STAGE 3 — judge. Structural walk of all three documents, then the contract cross-checks.
  const validated = validator.validateBundle(fetched.value);
  if (!validated.ok) return validated;

  return { ok: true, value: validated.value, raw: fetched.value };
}

/**
 * Boot the app.
 *
 * @param {{search?:string, mounts?:{error?:HTMLElement, reveal?:HTMLElement, stage?:HTMLElement}}} [args]
 * @returns {Promise<void>}
 */
export async function boot({ search = window.location.search, mounts = {} } = {}) {
  const doc = document;
  const errorMount = mounts.error || doc.getElementById('qbe-error') || doc.body;
  const revealMount = mounts.reveal || doc.querySelector('.reveal');
  const stage = mounts.stage || doc.querySelector('.qbe-stage');

  // Motion preference is set up FIRST, before anything can animate, and kept live afterwards —
  // spec §8 and theme-contract §8. `prefers-reduced-motion` is a setting a user can change while a
  // page is open (macOS "Reduce motion" is one checkbox away), and a board that keeps flipping
  // cards after they asked it to stop is a board that ignored them.
  watchReducedMotion();
  ensureVendorStyles(doc);

  const result = await loadAndValidate(search);

  if (!result.ok) {
    // THE FAILURE PATH. Hide the empty reveal skeleton (an attribute, not a style — the shell's CSS
    // honours [hidden]) so the error report owns the screen, and stop. Reveal is never initialised
    // and `renderBoard` is never called.
    if (revealMount) revealMount.setAttribute('hidden', '');
    errors.renderErrorScreen(result.failures, errorMount);
    // Also to the console, one line per failure: the host may be looking at a projector while a
    // helper reads the developer tools on the laptop.
    for (const f of result.failures) console.error(errors.formatFailure(f));
    return;
  }

  const bundle = result.value;

  // Naming the board in the tab and in the window title bar. Assigning `document.title` sets text,
  // never markup — there is no parse of the content file's title anywhere.
  doc.title = bundle.content.title + ' — Quiz Board Engine';

  // The theme <link>: its href comes from `bundle.resolved.themeFile`, which is a VALUE from
  // themes/themes.json, schema-pinned to a bare `.css` filename (spec §6.4, theme-contract §7).
  // No string from a content file ever becomes a URL — the content file only ever supplied a NAME,
  // and the validator resolved that name against the manifest.
  renderer.mountTheme(bundle.resolved.themeFile, doc);

  if (!stage) throw new Error('boot(): no .qbe-stage element to draw into');

  // --------------------------------------------------------------------------------------------
  // THE STATE SEAM — F6 / F7 / F10 attach here, and nothing about them is stubbed.
  // --------------------------------------------------------------------------------------------
  // Phase 3 replaces the object below with `js/state.js`: `state.newSession(...)` or
  // `state.loadSession(...)` produces it, `state.update(mutator)` mutates it, and
  // `state.subscribe(...)` drives the two `renderer.update*` calls (module-contracts §10 steps
  // 4-8). Until then this is a plain in-memory session of exactly the shape state.js will hand
  // over — `cellStates` keyed `"<col>:<row>"` (plan Q7), `bonusCells` a list of the same keys —
  // so the handlers below already speak the final vocabulary and F6 is a swap of the OWNER of this
  // object, not a rewrite of the renderer's interface.
  //
  // What is deliberately NOT here: no teams, no scores, no scorebar, no bonus picking, no
  // localStorage, no resume screen, no export. Those are F6/F7/F10 and inventing placeholder
  // versions of them now would mean writing behaviour the maintainer never specified and a later
  // phase would have to unpick. An absent feature is honest; a fake one is a lie with a schedule.
  const session = { cellStates: {}, bonusCells: [] };

  const view = renderer.renderBoard({
    bundle,
    session,
    mount: stage,
    handlers: {
      // `onCellAdvance` is the only handler that changes anything in this phase. It records the new
      // state and asks the renderer to repaint — exactly the two lines F6 replaces with
      // `state.update(draft => { draft.cellStates[key] = next; })`, whose subscriber calls
      // `updateBoard` for us.
      onCellAdvance(cellKey, nextState) {
        session.cellStates[cellKey] = nextState;
        renderer.updateBoard(view, { bundle, session });
      },
    },
  });

  // Reveal last: the board is already in the DOM, so reveal has a complete slide to measure and
  // there is no flash of an empty deck. `initReveal` forces `keyboard:false` (plan Q12) so reveal's
  // own navigation can never fight a focused cell button.
  //
  // A reveal failure is NOT routed to the error screen. That screen explains problems in the user's
  // JSON, in the user's language; a broken vendored dependency is our bug, not theirs, and dressing
  // it up as a content error would send a teacher hunting through a file that is perfectly fine.
  // The board is already drawn and keyboard-operable, so we log loudly and carry on.
  try {
    await renderer.initReveal(revealMount);
  } catch (err) {
    console.error('reveal.js failed to initialise; the board is drawn but the deck is inert.', err);
  }
}

// =============================================================================================
// AUTO-BOOT
// =============================================================================================
//
// index.html holds no logic of its own: it carries `data-qbe-autoboot` on <html> and imports this
// module, which then boots itself. Two reasons for the attribute rather than an unconditional call:
//
//   1. /tests/index.html imports the same module to exercise `loadAndValidate` with no board, no
//      theme and no reveal instance in play. An unconditional boot would fight the test page for
//      the document.
//   2. The shell stays free of inline JavaScript, so `index.html` is a document rather than a
//      program — which is also what keeps the test runner's transitive source audit able to follow
//      one import from the shell into every module the app can reach.
//
// A module script is deferred by definition, so the DOM is fully parsed by the time this runs.
if (typeof document !== 'undefined' && document.documentElement.hasAttribute('data-qbe-autoboot')) {
  boot().catch((err) => {
    // Reaching here means a bug in our own wiring rather than bad data — every expected failure is
    // a value on the Result, not a throw (module-contracts §0.1). Say so plainly in the console.
    console.error('Quiz Board Engine failed to start:', err);
  });
}

/**
 * Reflect `prefers-reduced-motion` onto `<html data-reduced-motion="true">`, and keep reflecting it.
 *
 * theme-contract §3 makes this attribute the CSS-side switch, so themes and the shipped animations
 * gate on one selector instead of each re-querying the media query. Spec §8: reduced motion REMOVES
 * animation rather than shortening it, which is a decision the CSS makes — this function's only job
 * is to make the preference visible to it.
 */
function watchReducedMotion(doc = document) {
  const root = doc.documentElement;
  const apply = (matches) => {
    if (matches) root.setAttribute('data-reduced-motion', 'true');
    else root.removeAttribute('data-reduced-motion');
  };
  apply(renderer.prefersReducedMotion());
  if (typeof matchMedia !== 'function') return;
  const query = matchMedia('(prefers-reduced-motion: reduce)');
  // `addEventListener` on a MediaQueryList is the current API and is in every browser in the
  // support matrix; the `addListener` fallback is for older Safari, which is in the matrix as a
  // MANUAL test target (plan Q2) and so cannot be caught by the automated runs. Feature detection,
  // never a user-agent test (CLAUDE.md constraint 5).
  if (typeof query.addEventListener === 'function') {
    query.addEventListener('change', (event) => apply(event.matches));
  } else if (typeof query.addListener === 'function') {
    query.addListener((event) => apply(event.matches));
  }
}

/**
 * Make sure the vendored reveal stylesheets are linked. Idempotent: index.html already links them
 * (they must apply before first paint), so on the real app shell this function creates nothing.
 * Relative hrefs, because the app ships on a GitHub Pages project subpath (plan Q3) where a
 * root-absolute `/vendor/…` would 404.
 */
function ensureVendorStyles(doc) {
  for (const style of VENDOR_STYLES) {
    if (doc.getElementById(style.id)) continue;
    const link = doc.createElement('link');
    link.id = style.id;
    link.rel = 'stylesheet';
    link.setAttribute('href', style.href);
    (doc.head || doc.documentElement).appendChild(link);
  }
}
