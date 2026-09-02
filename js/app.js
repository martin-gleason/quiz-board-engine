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
 * @param {{search?:string, mounts?:{error?:HTMLElement, reveal?:HTMLElement, stage?:HTMLElement,
 *          startup?:HTMLElement}}} [args]
 * @returns {Promise<void>}
 */
export async function boot({ search = window.location.search, mounts = {} } = {}) {
  const doc = document;
  const errorMount = mounts.error || doc.getElementById('qbe-error') || doc.body;
  const revealMount = mounts.reveal || doc.querySelector('.reveal');
  const stage = mounts.stage || doc.querySelector('.qbe-stage');
  // The startup screen's own mount, OUTSIDE `.reveal` (delta D12). See `showStartup` for why it
  // cannot live on the stage like the resume and team screens do.
  const startupMount = mounts.startup || doc.getElementById('qbe-startup');

  // Motion preference is set up FIRST, before anything can animate, and kept live afterwards —
  // spec §8 and theme-contract §8. `prefers-reduced-motion` is a setting a user can change while a
  // page is open (macOS "Reduce motion" is one checkbox away), and a board that keeps flipping
  // cards after they asked it to stop is a board that ignored them.
  watchReducedMotion();
  ensureVendorStyles(doc);

  // THE FAILURE PATH, used at boot and at every later step that can fail (a corrupt saved session, a
  // refused import, a storage write that will not go through). Hiding the reveal skeleton is an
  // attribute, not a style — the shell's CSS honours [hidden] — so the error report owns the screen.
  const failScreen = (failures) => {
    if (revealMount) revealMount.setAttribute('hidden', '');
    // The startup screen goes too. A manifest that will not parse is reported by the screen that
    // replaces it, not underneath one still asking the host to choose from a list it never got.
    if (startupMount) startupMount.replaceChildren();
    errors.renderErrorScreen(failures, errorMount);
    // Also to the console, one line per failure: the host may be looking at a projector while a
    // helper reads the developer tools on the laptop.
    for (const f of failures) console.error(errors.formatFailure(f));
  };

  // -------------------------------------------------------------------------------------------
  // THE FORK (delta D12). A `?game=` parameter is a DEEP LINK and it wins outright: a host who
  // bookmarked a board, or a teacher who mailed a link to a substitute, gets that board with no
  // screen in the way. The picker is what happens when nobody said which game — the case that used
  // to silently mean `games/demo.json` and left the other two boards unreachable.
  //
  // `has('game')` rather than `get('game')`: `?game=` with an empty value must still reach
  // `resolveGameParam`, which reports it as the typo it is. Routing it to the picker instead would
  // hide a broken link behind a working screen.
  // -------------------------------------------------------------------------------------------
  const ctxBase = { doc, errorMount, revealMount, stage, startupMount, failScreen };
  if (!new URLSearchParams(search || '').has('game') && startupMount) {
    return showStartup(ctxBase);
  }
  // A DEEP LINK STILL WEARS THE DEVICE'S THEME (delta D13). The preference is a property of the
  // ROOM — this projector, this lighting — not of the visit, so a host who chose `chalkboard` for
  // the hall keeps it when they open a board they bookmarked. Skipping it here was the bug the
  // Phase 5 walkthrough caught: the picker honoured the choice and the bookmark silently did not,
  // which is the same feature behaving two ways depending on how you arrived.
  //
  // This is also what makes the stale-preference fallback in `openGame` a live guard rather than
  // decoration. The picker can only ever offer names the manifest currently holds, so a name that
  // has since been removed cannot come from there — it can only come from storage, on this path.
  return openGame(ctxBase, { search, themeOverride: state.readThemePreference() });
}

/**
 * The startup screen: fetch the two manifests, judge them, and let the host choose (F11 / F12).
 *
 * WHY IT MOUNTS OUTSIDE `.reveal`. Spec §5 and the header of this file promise that nothing is
 * drawn and reveal is never initialised until a bundle validates. At this moment there is no
 * bundle — no game has been chosen — so putting the picker on the stage would mean starting reveal
 * ahead of validation and trading that guarantee for a cosmetic convenience. It goes beside the
 * error screen instead, on the `themes/default.css` base layer the shell already links.
 *
 * A manifest failure IS an error-screen failure, unlike a reveal failure. The distinction the
 * header draws is "the user's data" versus "our broken dependency", and a manifest is data — a host
 * who added a board and mistyped the filename gets a located caret and a hint, exactly as they
 * would for a broken content file.
 */
async function showStartup(ctx) {
  const { doc, revealMount, startupMount, failScreen } = ctx;

  // The empty deck is hidden while the picker is up: reveal has not been initialised, so `.reveal`
  // is an unstyled empty box that would otherwise sit under the screen taking up the viewport.
  if (revealMount) revealMount.setAttribute('hidden', '');

  const fetched = await loader.fetchManifests();
  if (!fetched.ok) return failScreen(fetched.failures);

  const gamesDoc = validator.validateDocument({ kind: KINDS.GAMES, raw: fetched.value.games });
  const themesDoc = validator.validateDocument({ kind: KINDS.THEMES, raw: fetched.value.themes });
  // Both reported at once, same reasoning as `fetchContentBundle`'s batching: fixing one and
  // discovering the other on the next reload is two trips where one would do.
  const manifestFailures = [];
  if (!gamesDoc.ok) manifestFailures.push(...gamesDoc.failures);
  if (!themesDoc.ok) manifestFailures.push(...themesDoc.failures);
  if (manifestFailures.length > 0) return failScreen(manifestFailures);

  const gameMap = gamesDoc.value.games;
  const games = Object.keys(gameMap).map((name) => ({ name, file: gameMap[name] }));
  if (games.length === 0) {
    // An empty manifest is not a schema violation — `{}` is a legal map — but it IS a dead end, and
    // a picker with nothing in it would leave the host pressing Start on nothing at all.
    return failScreen([
      errors.failure({
        file: loader.GAMES_MANIFEST,
        kind: KINDS.GAMES,
        stage: 'contract',
        path: 'games',
        location: null,
        expected: 'at least one game, as a name and a filename under /games/',
        found: 'an empty list',
        hint: 'unresolved-reference',
      }),
    ]);
  }

  const screen = renderer.renderStartupScreen({
    games,
    themes: Object.keys(themesDoc.value.themes),
    themePref: state.readThemePreference(),
    mount: startupMount,
    handlers: {
      onStart: ({ file, theme }) => {
        // REMEMBERED, but never as part of a session (delta D13). `writeThemePreference` returns
        // false in a private window; that is not worth telling anyone about, because the pick still
        // applies to the page they are looking at.
        state.writeThemePreference(theme);
        screen.destroy();
        startupMount.replaceChildren();
        if (revealMount) revealMount.removeAttribute('hidden');
        // THE PICKER'S CHOICE GOES THROUGH THE `?game=` GUARD, deliberately. Handing the filename
        // straight to `fetchContentBundle` would give the picker a second, weaker route to a file;
        // building the parameter and letting `resolveGameParam` judge it means spec §6.3 is
        // enforced on exactly one code path, whether the string came from a URL or from this list.
        // Caught, not dropped. The deep-link branch returns this promise into `boot().catch()`;
        // the picker branch cannot (it resolves when the SCREEN is up, long before a board is), so
        // without this a wiring throw here would surface as a bare unhandled rejection instead of
        // the same diagnostic the other path prints.
        openGame(ctx, {
          search: '?' + new URLSearchParams({ game: loader.GAMES_DIR + file }).toString(),
          themeOverride: theme,
        }).catch((err) => console.error('Quiz Board Engine failed to start:', err));
      },
    },
  });
  return undefined;
}

/**
 * Everything from "we know which game" onward — the original body of `boot`, unchanged in sequence.
 *
 * @param {object} shell  the mounts and the shared `failScreen`
 * @param {{search:string, themeOverride:string|null}} args
 */
async function openGame(shell, { search, themeOverride }) {
  const { doc, revealMount, stage, failScreen } = shell;
  const result = await loadAndValidate(search);

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
  // THE HOST'S OVERRIDE, resolved here and nowhere else (delta D13). `themeOverride` is a NAME, and
  // the only thing that ever becomes an href is `bundle.themes.themes[...]` — a manifest VALUE the
  // schema has already pinned to a bare `.css` filename. Spec §6.4 is untouched: the picker widened
  // *who* may choose a theme, not *what* may become a stylesheet URL.
  //
  // An override naming a theme that is not in the manifest falls back to the game's own theme
  // instead of failing. The stored preference outlives the manifest that justified it — a theme
  // removed between two sessions is the ordinary case, not an attack — and putting a host on an
  // error screen over a stale colour choice would be punishing them for our bookkeeping.
  const overrideFile = themeOverride ? bundle.themes.themes[themeOverride] : undefined;
  renderer.mountTheme(overrideFile || bundle.resolved.themeFile, doc);

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
    wins: null,       // the F8 win rail, or null unless winCondition is pattern-complete
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

  // F8. The rail exists only for a game type that can be won by completing a pattern (spec §4.2),
  // the same shape as the score bar's `scoring.model !== 'none'` gate above: a game type declares
  // what it has, and the chrome for what it does not have is absent rather than empty. Drawn after
  // the board so the wins sit under it, and before the toolbar so the host equipment stays last.
  if (bundle.gametype.winCondition === 'pattern-complete') {
    ctx.wins = renderer.renderWinRail({ mount: stage });
  }

  // Export/Import are offered for every game type — a bingo card a host cannot export is data loss
  // wearing a layout decision. Teams… is offered only when there is a score bar to show a team IN:
  // passing no handler is what tells the renderer to leave the button out entirely rather than draw
  // one that does nothing (see `renderToolbar`).
  const toolbarHandlers = {
    onExport: () => exportSession(ctx),
    onImport: (file) => importSession(ctx, file),
  };
  if (ctx.panel) toolbarHandlers.onTeamsEdit = () => showTeamSetup(ctx, { editing: true });
  // `D15`/`D17`. Both gates read the game type, so jeopardy and bingo get neither control — the
  // renderer leaves a button out entirely when its handler is absent.
  if (bundle.gametype.strikes) {
    toolbarHandlers.onStrike = () => strikeRound(ctx);
    toolbarHandlers.onStrikeUndo = () => undoStrikeForRound(ctx);
    toolbarHandlers.onStrikesClear = () => state.clearStrikes(currentRound(ctx));
  }
  // A ONE-COLUMN RANKED BOARD HAS NOWHERE TO GO, and `games/demo-feud.json` is exactly that — so
  // the button shipped permanently dead on the only board that had it, contradicting the rule
  // stated in `renderToolbar` three lines above where it is built. Found in adversarial review.
  if (bundle.gametype.layout === 'ranked-list' && bundle.resolved.columnCount > 1) {
    toolbarHandlers.onRoundNext = () => state.setRound(ctx.bundle, currentRound(ctx) + 1);
  }
  ctx.toolbar = renderer.renderToolbar({ mount: stage, handlers: toolbarHandlers });
  bindStrikeKey(ctx);

  // Not unsubscribed anywhere, and that is correct rather than a leak: the document holds exactly
  // one game for its whole life, and the subscriber dies with the page.
  state.subscribe((next) => repaint(ctx, next));
  repaint(ctx, session);
}

/** The round the live session is on. Zero when there is no session yet, which is the safe default. */
function currentRound(ctx) {
  const session = state.current();
  return session && Number.isInteger(session.currentRound) ? session.currentRound : 0;
}

/**
 * Record a strike against the ACTIVE TEAM in the round on screen (`D15`, `D18`).
 *
 * `ctx.activeTeam` is null until the host clicks a team name, and `state.addStrike` treats that as
 * a no-op — the host's rule is click the team, then press X. Nothing is announced and nothing is
 * drawn, which is the honest outcome: there is no one to charge the strike to.
 */
function strikeRound(ctx) {
  const round = currentRound(ctx);
  const before = state.strikesFor(state.current(), round, ctx.activeTeam);
  state.addStrike(ctx.bundle, round, ctx.activeTeam);
  announceStrikes(ctx, round, before);
}

/** Take one strike back from the active team (`D18`). */
function undoStrikeForRound(ctx) {
  const round = currentRound(ctx);
  const before = state.strikesFor(state.current(), round, ctx.activeTeam);
  state.undoStrike(ctx.bundle, round, ctx.activeTeam);
  announceStrikes(ctx, round, before);
}

/**
 * Speak a strike change, and ONLY a real one.
 *
 * The announcement used to live in `renderer.updateStrikes`, which fires on every repaint — so
 * after `D18` merely switching the active team announced "2 strikes of 3" when no strike had
 * happened, and the undo that `D18` was ratified to add announced nothing at all, because the count
 * went DOWN. Both were found in review.
 *
 * Announcing from here fixes both by construction: this runs on the two host actions that are
 * strike events, and nowhere else. A no-op — `X` with nobody marked, or an undo at zero — leaves
 * the count unchanged and says nothing, which is correct: there is nothing to report.
 */
function announceStrikes(ctx, round, before) {
  if (!ctx.bundle.gametype.strikes) return;
  const after = state.strikesFor(state.current(), round, ctx.activeTeam);
  if (after === before) return;
  const total = ctx.bundle.gametype.strikes.count;
  const team = (state.current().teams || [])[ctx.activeTeam];
  renderer.announce((team ? team.name + ', ' : '')
    + after + (after === 1 ? ' strike of ' : ' strikes of ') + total, ctx.doc);
}

/**
 * The `X` key (`D15`, ratified with the delta).
 *
 * Plan Q12 fixed a deliberately small key budget — `Escape`, `Space`, `Enter` — and this widens it
 * by exactly one key, which is a decision the maintainer made rather than an implementation detail.
 *
 * THREE GUARDS, and each one is a real case rather than defensive habit:
 *   · a game type with no `strikes` block has no strike to record;
 *   · the overlay being up means the host is reading a prompt to the room, and `X` there would
 *     strike a round while the answer is on screen — the detail overlay owns the keyboard while it
 *     is open, exactly as it owns `Escape`;
 *   · a modifier held means the host is using a browser shortcut (⌘X, Ctrl+X), not calling a
 *     strike, and stealing Cut from a host editing a team name would be its own defect.
 */
function bindStrikeKey(ctx) {
  if (!ctx.bundle.gametype.strikes) return;
  ctx.doc.addEventListener('keydown', (event) => {
    if (event.key !== 'x' && event.key !== 'X') return;
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    // A HELD KEY IS ONE STRIKE, NOT THIRTY. The count is capped, so auto-repeat was harmless on
    // screen — and underneath it ran a clone, a cheap-check, a localStorage write and a full board
    // repaint per repeat, each one bumping `updatedAt`, which is what the resume shelf sorts and
    // prunes on. Efficiency, found in adversarial review.
    if (event.repeat) return;
    if (ctx.board && ctx.board.open) return;
    if (ctx.screen) return; // a setup or resume overlay is up
    event.preventDefault();
    strikeRound(ctx);
  });
}

/** The single repaint. `null` arrives when the live session is discarded; there is nothing to draw. */
function repaint(ctx, session) {
  if (!session) return;
  if (ctx.board) renderer.updateBoard(ctx.board, { bundle: ctx.bundle, session });
  // F8. The rule is `state`'s (a pure function of board + cell states), the pixels and the
  // announcement are the renderer's, and this line is the whole of app.js's involvement — which is
  // what keeps "no game rules in the composition root" true. Recomputed on every repaint rather than
  // tracked incrementally: the detector is pure, so the FIRST paint of a resumed session already
  // knows every win it inherited, and the renderer seeds its rail from it silently instead of
  // announcing a pile of wins the room watched happen an hour ago.
  if (ctx.wins) renderer.updateWins(ctx.wins, state.completedPatterns({ bundle: ctx.bundle, session }));

  // `D15`/`D17`. The round on screen and the strikes over it are both derived from the session on
  // every repaint, never tracked alongside it. That is what makes an IMPORTED session correct for
  // free: a file carrying `currentRound: 2` and two strikes repaints into exactly that board with
  // no separate import path to keep in step.
  // A ROSTER EDIT CAN STRAND `ctx.activeTeam` PAST THE END. `setTeams` now trims the strikes of a
  // removed team, but the view state pointing at them is separate and was left behind: the centre
  // band went on showing a departed team's count to the room while every score row showed nothing,
  // and `X` went on recording against them. Clamped on every repaint rather than only in the edit
  // handler, so an imported session with fewer teams is covered by the same line.
  const roster = Array.isArray(session.teams) ? session.teams.length : 0;
  if (ctx.activeTeam !== null && ctx.activeTeam >= roster) ctx.activeTeam = null;

  const round = Number.isInteger(session.currentRound) ? session.currentRound : 0;
  if (ctx.board) {
    renderer.setRound(ctx.board, round);
    // `D18`. The centre band shows THE TEAM ON THE BOARD. With nobody marked it falls back to the
    // round's highest count, which is the only honest single number for a round several teams have
    // played and never under-reports — but the per-team rows below are then the real answer.
    renderer.updateStrikes(ctx.board, state.strikesFor(session, round, ctx.activeTeam));
  }
  if (ctx.panel) {
    const teamCount = Array.isArray(session.teams) ? session.teams.length : 0;
    const perTeamStrikes = [];
    for (let i = 0; i < teamCount; i += 1) perTeamStrikes.push(state.strikesFor(session, round, i));
    renderer.updateScorePanel(ctx.panel, {
      session,
      award: ctx.awardKey ? state.cellAward({ bundle: ctx.bundle, session, cellKey: ctx.awardKey }) : 0,
      activeTeam: ctx.activeTeam,
      strikes: perTeamStrikes,
    });
  }

  // A DISABLED BUTTON IS HONEST; a button that silently does nothing is not — the rule `renderer`
  // already applies to the score buttons, which disable until there is an award to give. `X` and
  // both strike controls are no-ops until a team is marked, and that is the state after EVERY
  // reload, since `activeTeam` is view state and is never persisted.
  if (ctx.toolbar && ctx.toolbar.setStrikeEnabled) {
    ctx.toolbar.setStrikeEnabled(ctx.activeTeam !== null,
      state.strikesFor(session, round, ctx.activeTeam) > 0);
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
