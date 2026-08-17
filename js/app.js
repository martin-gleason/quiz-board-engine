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
import * as state from './state.js';
import { KINDS } from './schemas.js';

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

  // THE FAILURE PATH, used at boot and at every later step that can fail (a corrupt saved session, a
  // refused import, a storage write that will not go through). Hiding the reveal skeleton is an
  // attribute, not a style — the shell's CSS honours [hidden] — so the error report owns the screen.
  const failScreen = (failures) => {
    if (revealMount) revealMount.setAttribute('hidden', '');
    errors.renderErrorScreen(failures, errorMount);
    // Also to the console, one line per failure: the host may be looking at a projector while a
    // helper reads the developer tools on the laptop.
    for (const f of failures) console.error(errors.formatFailure(f));
  };

  if (!result.ok) {
    // Nothing is drawn on a failed load. Reveal is never initialised and `renderBoard` is never
    // called (spec §5).
    failScreen(result.failures);
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
  // REVEAL IS INITIALISED **BEFORE** THE FIRST SCREEN NOW, and the reason is not cosmetic.
  // --------------------------------------------------------------------------------------------
  // Until F6 the first thing drawn was the board, so reveal could start afterwards and measure a
  // complete slide. F6 puts a screen in front of the board — team setup, or the resume list — and
  // `reveal.css` hides every `.slides > section` until reveal marks one present. Starting reveal
  // after that screen therefore means drawing it into a slide the browser is not displaying: a
  // blank projector and a host with nothing to click.
  //
  // A reveal failure is still NOT routed to the error screen. That screen explains problems in the
  // user's JSON, in the user's language; a broken vendored dependency is our bug, not theirs, and
  // dressing it up as a content error would send a teacher hunting through a file that is fine. But
  // it can no longer be shrugged off either, because the slide would stay hidden — so the catch
  // applies the display value REVEAL_CONFIG itself declares, which keeps ownership of the stage's
  // `display` with the renderer (theme-contract §2) rather than inventing a value here.
  try {
    await renderer.initReveal(revealMount);
  } catch (err) {
    console.error('reveal.js failed to initialise; showing the stage without it.', err);
    stage.style.setProperty('display', renderer.REVEAL_CONFIG.display);
  }

  // --------------------------------------------------------------------------------------------
  // STAGE 4 — identity. The session shelf is keyed by a hash of the content file's BYTES, so the
  // same file resumes and an edited file does not silently resume onto a board that changed shape.
  // --------------------------------------------------------------------------------------------
  // `hashContent` returns a Result rather than throwing, because the one way it fails is a page
  // served from an origin the browser calls insecure (`http://192.168.1.20:8000` to a projector),
  // where `crypto.subtle` does not exist. That is a user-facing condition with an actionable fix, so
  // it goes to the error screen with the fix in the message.
  const hashed = await state.hashContent(result.raw.content.text);
  if (!hashed.ok) {
    failScreen(hashed.failures);
    return;
  }
  const gameHash = hashed.value;

  // Spec §4.4: keep the last 10 sessions, prune the oldest SILENTLY. Done before listing so the
  // resume screen never offers a row that is about to be pruned out from under it.
  state.pruneToCap();

  const ctx = {
    doc, stage, revealMount, bundle, gameHash, failScreen,
    screen: null,     // the team-setup / resume overlay currently up, or null
    board: null,      // BoardView, once the game has started
    panel: null,      // PanelView, or null for a game type with no scoring
    toolbar: null,
    // VIEW-ONLY session facts, deliberately not persisted — see `renderer.updateScorePanel`.
    awardKey: null,   // the cell whose points the +/- buttons are currently offering
    activeTeam: null, // whose turn the host has marked, for the room
  };

  const sessions = state.listSessions();
  if (sessions.some((s) => s.gameHash === gameHash)) {
    showResume(ctx, sessions);
  } else {
    startFresh(ctx);
  }
}

/**
 * Open a brand-new game.
 *
 * TEAM SETUP IS SKIPPED FOR A GAME TYPE WITH NO SCORING. Spec §4.4 puts team creation "at session
 * start", but a bingo card draws no score bar (theme-contract §2), so teams collected there would be
 * invisible for the whole game — a screen between the host and the board that asks a question whose
 * answer is never used. `state.newSession` is perfectly happy with an empty team list.
 */
function startFresh(ctx) {
  if (ctx.bundle.gametype.scoring.model !== 'none') {
    showTeamSetup(ctx, {});
    return;
  }
  const session = state.newSession({ bundle: ctx.bundle, gameHash: ctx.gameHash, teams: [] });
  const adopted = state.adopt(session);
  if (!adopted.ok) return ctx.failScreen(adopted.failures);
  if (ctx.screen) {
    ctx.screen.destroy();
    ctx.screen = null;
  }
  startGame(ctx);
  return undefined;
}

// =============================================================================================
// THE SESSION SEQUENCE (module-contracts §10 steps 4-8)
// =============================================================================================
//
// Three entry points into one game: a NEW session (team setup -> newSession -> adopt), a RESUMED
// session (loadSession -> validateState -> adopt), and an IMPORTED session (file -> validateState ->
// adopt). All three converge on `startGame`, and all three reach `state.adopt()` by way of the
// validator — `state` never validates and `validator` never persists (module-contracts §2), and
// this module is the only place allowed to join them.

/** The resume / discard / new screen. Redrawn rather than patched when a row is discarded. */
function showResume(ctx, sessions) {
  if (ctx.screen) ctx.screen.destroy();
  ctx.screen = renderer.renderResumeScreen({
    sessions,
    gameHash: ctx.gameHash,
    mount: ctx.stage,
    handlers: {
      onResume: (hash) => resumeSession(ctx, hash),
      onDiscard: (hash) => {
        state.discardSession(hash);
        const left = state.listSessions();
        // NOTHING RESUMABLE LEFT MEANS MOVE ON. The test is "does any remaining session belong to
        // THIS game", not "are there any sessions at all": a shelf holding three other games' boards
        // would otherwise keep the host on a screen asking "resume?" with no Resume button on it.
        if (!left.some((s) => s.gameHash === ctx.gameHash)) startFresh(ctx);
        else showResume(ctx, left);
      },
      onNewGame: () => startFresh(ctx),
    },
  });
}

/** Team setup, both at session start and from the toolbar mid-game. */
function showTeamSetup(ctx, { editing } = {}) {
  if (ctx.screen) ctx.screen.destroy();
  const live = state.current();
  ctx.screen = renderer.renderTeamSetup({
    mount: ctx.stage,
    editing: !!editing,
    names: editing && live ? live.teams.map((t) => t.name) : undefined,
    handlers: {
      onTeamsSubmit: (names) => {
        if (editing) {
          const saved = state.setTeams(names);
          if (!saved.ok) return ctx.failScreen(saved.failures);
          ctx.screen.destroy();
          ctx.screen = null;
          // The subscriber has already repainted the bar; the team COUNT may have changed, which
          // `updateScorePanel` handles by rebuilding its rows.
          return undefined;
        }
        // A NEW SESSION. `newSession` draws the F7 bonus cells here, once — spec §8's "a new session
        // reshuffles" — and `adopt` is what persists it and makes it current.
        const session = state.newSession({ bundle: ctx.bundle, gameHash: ctx.gameHash, teams: names });
        const adopted = state.adopt(session);
        if (!adopted.ok) return ctx.failScreen(adopted.failures);
        ctx.screen.destroy();
        ctx.screen = null;
        startGame(ctx);
        return undefined;
      },
      onCancel: () => {
        ctx.screen.destroy();
        ctx.screen = null;
      },
    },
  });
}

/**
 * Resume a stored session.
 *
 * A stored session is UNTRUSTED INPUT (CLAUDE.md), exactly like an imported file: an older build
 * wrote it, or somebody edited it in devtools, or the game file changed under it. So it takes the
 * same route as an import — raw document, `validator.validateState`, then `state.adopt` — and it is
 * `state.loadSession`'s deliberate design that it hands back a RawDocument rather than a session.
 */
function resumeSession(ctx, gameHash) {
  const loaded = state.loadSession(gameHash);
  if (!loaded.ok) {
    // A stored entry that will not parse comes back with the raw text attached, so the error screen
    // can show a located caret instead of "it's broken somewhere".
    if (loaded.raw) return ctx.failScreen(errors.syntaxFailure(loaded.raw).failures);
    return ctx.failScreen(loaded.failures);
  }
  return adoptValidated(ctx, loaded.value, { expectGameHash: gameHash, file: loaded.value.path });
}

/** The one path from a raw untrusted state document to a live session. */
function adoptValidated(ctx, raw, opts) {
  const checked = validator.validateState({ raw, bundle: ctx.bundle });
  if (!checked.ok) return ctx.failScreen(checked.failures);

  const adopted = state.adopt(checked.value, opts);
  if (!adopted.ok) return ctx.failScreen(adopted.failures);

  if (ctx.screen) {
    ctx.screen.destroy();
    ctx.screen = null;
  }
  // An import lands on a board that is already drawn; a resume lands before there is one. The first
  // case is repainted by the subscriber, the second has to build the board.
  if (!ctx.board) startGame(ctx);
  return undefined;
}

/**
 * Draw the game and wire every change back through `state`.
 *
 * ONE SUBSCRIBER, ONE REPAINT PATH. Nothing here paints optimistically: a handler asks `state` to
 * change something, `state` persists it, and only then does the subscriber repaint. That ordering is
 * what keeps the projected board and the saved session from ever disagreeing — a click whose write
 * failed leaves the board showing what is actually stored, and the error screen explains why.
 */
function startGame(ctx) {
  const { bundle, stage } = ctx;
  const session = state.current();

  // theme-contract §2: the score bar exists ONLY when the game type has scoring. Bingo gets no bar
  // rather than an empty one.
  if (bundle.gametype.scoring.model !== 'none') {
    ctx.panel = renderer.renderScorePanel({
      bundle,
      session,
      mount: stage,
      handlers: {
        onScoreAdjust: (teamIndex, delta) => {
          const scored = state.adjustScore({ bundle, teamIndex, delta });
          if (!scored.ok) ctx.failScreen(scored.failures);
        },
        onTeamActivate: (teamIndex) => {
          // A toggle, so a host can clear the marker between questions. It is a marker for the room,
          // not a turn lock — plan Q4 has no notion of whose click is allowed.
          ctx.activeTeam = ctx.activeTeam === teamIndex ? null : teamIndex;
          repaint(ctx, state.current());
        },
      },
    });
  }

  ctx.board = renderer.renderBoard({
    bundle,
    session,
    mount: stage,
    handlers: {
      // The award the +/- buttons offer follows the cell in play, including F7's bonus multiplier
      // (`state.cellAward`). It is NOT cleared on close: the host closes the overlay and then scores
      // the team that answered, and a mis-click needs the same amount available to undo it.
      onCellActivate: (cellKey) => {
        ctx.awardKey = cellKey;
        repaint(ctx, state.current());
      },
      onCellAdvance: (cellKey, nextState) => {
        const saved = state.setCellState(cellKey, nextState);
        if (!saved.ok) ctx.failScreen(saved.failures);
      },
    },
  });

  // Export/Import are offered for every game type — a bingo card a host cannot export is data loss
  // wearing a layout decision. Teams… is offered only when there is a score bar to show a team IN:
  // passing no handler is what tells the renderer to leave the button out entirely rather than draw
  // one that does nothing (see `renderToolbar`).
  const toolbarHandlers = {
    onExport: () => exportSession(ctx),
    onImport: (file) => importSession(ctx, file),
  };
  if (ctx.panel) toolbarHandlers.onTeamsEdit = () => showTeamSetup(ctx, { editing: true });
  ctx.toolbar = renderer.renderToolbar({ mount: stage, handlers: toolbarHandlers });

  // Not unsubscribed anywhere, and that is correct rather than a leak: the document holds exactly
  // one game for its whole life, and the subscriber dies with the page.
  state.subscribe((next) => repaint(ctx, next));
  repaint(ctx, session);
}

/** The single repaint. `null` arrives when the live session is discarded; there is nothing to draw. */
function repaint(ctx, session) {
  if (!session) return;
  if (ctx.board) renderer.updateBoard(ctx.board, { bundle: ctx.bundle, session });
  if (ctx.panel) {
    renderer.updateScorePanel(ctx.panel, {
      session,
      award: ctx.awardKey ? state.cellAward({ bundle: ctx.bundle, session, cellKey: ctx.awardKey }) : 0,
      activeTeam: ctx.activeTeam,
    });
  }
}

// =============================================================================================
// F10 — EXPORT AND IMPORT
// =============================================================================================

/**
 * Export the live session as a downloadable file.
 *
 * `state` produces strings and this module produces the download, because a download is DOM work and
 * `state` never touches the DOM (module-contracts §9). The object URL is revoked immediately after
 * the click: every engine in the matrix has already read the blob synchronously by then, and an
 * un-revoked URL pins the whole session in memory for the life of the document.
 */
function exportSession(ctx) {
  const payload = state.exportPayload();
  if (!payload) return;
  const doc = ctx.doc;
  const url = URL.createObjectURL(new Blob([payload.json], { type: 'application/json' }));
  const link = doc.createElement('a');
  link.href = url;
  link.download = payload.filename;
  // Not appended to the document: a click on a detached anchor still downloads in Chrome, Firefox
  // and Safari, and nothing flashes on a projected screen.
  link.click();
  URL.revokeObjectURL(url);
}

/**
 * Import a session file (spec §4.4: "imported state is untrusted input, validated like everything
 * else"; spec §5: no partial render, ever).
 *
 * Three gates, in the order a bad file meets them: it must be readable, it must PARSE — and a parse
 * failure goes through `errors.syntaxFailure`, so a hand-edited file gets the same line/column/caret
 * report a broken game file gets — and it must then satisfy `validator.validateState` against THIS
 * bundle, which is what stops another game's scores landing on this board. Nothing is applied
 * half-way: a failure at any gate routes to the error screen and the live session is untouched.
 */
async function importSession(ctx, file) {
  const identity = 'import:' + String(file.name || 'quiz-state.json');

  // THE BYTE CAP COMES BEFORE THE READ, exactly as it does in `loader.fetchJsonFile` and for the
  // same reason (module-contracts §4.2): parsing first would hand a hostile 40 MB file to
  // `JSON.parse` and freeze the tab, and the cap would then be a report on a denial of service that
  // had already happened. A state file is a few KB; the loader's non-content cap is generous here.
  // `File.size` is known without reading a byte, so this file is never even loaded into memory.
  if (Number.isFinite(file.size) && file.size > loader.DEFAULT_MAX_BYTES) {
    ctx.failScreen([
      errors.failure({
        file: identity,
        kind: KINDS.STATE,
        stage: 'fetch',
        path: '(file)',
        location: null,
        expected: 'a saved session file of at most ' + Math.round(loader.DEFAULT_MAX_BYTES / 1024) + ' KB',
        found: 'a file of ' + Math.round(file.size / 1024) + ' KB',
        hint: 'file-too-large',
      }),
    ]);
    return;
  }

  let text;
  try {
    text = await file.text();
  } catch (err) {
    console.error('the imported file could not be read', err);
    return;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (_err) {
    ctx.failScreen(errors.syntaxFailure({ file: identity, kind: KINDS.STATE, text }).failures);
    return;
  }

  adoptValidated(
    ctx,
    { path: identity, kind: KINDS.STATE, text, bytes: new TextEncoder().encode(text).length, data },
    { expectGameHash: ctx.gameHash, file: identity },
  );
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
