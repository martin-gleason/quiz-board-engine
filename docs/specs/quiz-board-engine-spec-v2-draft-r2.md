# Quiz Board Engine — Specification v2.0 — DRAFT (r2)

**Status:** DRAFT — not frozen. Does not merge to `docs/specs/` until the red-team gate in §8 is resolved and the signaling flows survive a prototype gate.
**r2 change:** offline/no-internet operation promoted to the primary topology; signaling split into two modes; F11 dependency declared; red-team gate expanded. (r1 → r2 changes permitted because this spec has never been frozen.)

---

## 1. What v2 is

One architecture serving three user stories: players see the live board on their own devices, bingo players get personal cards, and the host can remove bad actors. Plus cloud storage (Google Drive, Dropbox) for game state and custom sound files.

**Design premise:** the whole session must run with zero internet. WebRTC data channels are genuinely peer-to-peer — on a shared network, packets flow device-to-device using local addresses, no STUN/TURN, no WAN. A phone hotspot or a cheap travel router is a complete venue setup.

## 2. Architecture — host-as-hub

- The **host's browser is the authoritative game state**. No server holds anything; zero-cost survives intact.
- Players connect over **WebRTC data channels** directly to the host. State changes broadcast as diffs; player views are read-only renders of the same board the host drives.
- **Hard cap: 20 connected players/teams.** Enforced at the host; connection 21 is refused with a clear message.
- **Supported topology: same network (LAN), internet optional.** Cross-internet play is best-effort and documented as such — no TURN server will ever be run (cost).

## 3. Two operating modes

### Mode 1 — LAN session (primary; works fully offline)

The host runs `serve.py` and players load the app from the host's machine.

1. Host starts `serve.py --lan` → app served on `http://<host-ip>:<port>`; the launcher prints the URL **and renders it as a QR code in the terminal** for players to scan and open.
2. Player opens the URL, taps **Join**, enters a name.
3. **Signaling rides the same local server:** `serve.py` gains a tiny stdlib relay endpoint that passes the WebRTC offer/answer blobs between host and joiner automatically. No cameras, no manual steps — the handshake is invisible.
4. Data channels open peer-to-peer; the relay's job is done (it carries no game traffic).

Join UX: scan one QR, type a name, you're in. Offline mode is the *smoothest* join path, not the degraded one.

### Mode 2 — Hosted session (Pages-served, serverless)

For sessions run straight off the live GitHub Pages site with no laptop server: the QR handshake.

1. Host clicks **Host session**; per-player: host displays a QR carrying the WebRTC offer.
2. Player scans it; player's device displays the answer QR; host scans it back.
3. Channel opens; next player.

Camera access works here because Pages is HTTPS (a secure context). Known engineering realities held for §8: SDP size vs. QR density (compression/chunking), 20 sequential handshakes must be relentlessly optimized, and the host device needs a camera.

## 4. F11 dependency (v1.5 delta to ratify)

Mode 1 requires the launcher to grow beyond localhost:

- `--lan` flag: bind to the machine's LAN address, print + QR the URL.
- The signaling relay endpoint (stdlib only, in-memory, session-scoped).

**Process note:** if spec v1.5 is not yet merged, fold this into F11 before merge; if merged, this lands as a ratified delta in `docs/plans/`. Maintainer's call — the agent does not edit a frozen spec.

## 5. Per-player bingo cards

- Each player's card is **deterministically generated** from `(gameHash, playerSeed)` — a shuffle of the shared cell pool seeded per player.
- When the host calls an item, players mark their own cards locally.
- A bingo claim sends only the player's seed and claimed pattern; the **host regenerates that exact card locally and verifies the win** — zero trust in the client, no card data ever transmitted.

## 6. Moderation

- Roster panel on the host view: player name, connection state.
- **Kick** = close the peer's data channel + add their session token to a session blocklist; rejoin attempts with a blocked token are refused at handshake. In Mode 1 the relay also refuses blocked tokens at the door.
- The 20-cap and the blocklist live in host state and die with the session.

## 7. Cloud storage — Drive and Dropbox (online-only, degrades gracefully)

Two uses: **game-state save/load** (the v1 export/import object over a new transport) and **custom sound file storage**.

- OAuth via **PKCE flow** (no client secret — safe in a public static repo). Tokens held in memory / session storage, never committed, never in URLs.
- **Constraint carve-out, stated explicitly:** v1's "no external requests" invariant gains a fixed allowlist — Google Drive API endpoints and `dl.dropboxusercontent.com` — reachable only from user-initiated actions. Content JSON can never trigger a cloud fetch by itself; cloud sound sources are referenced via the local sounds manifest, which the repo owner controls.
- **Offline behavior:** cloud controls detect no connectivity and disable with a plain message; local export/import remains the offline path. A session never fails because the cloud is unreachable.
- Failure posture unchanged: a cloud file is untrusted input and passes the same validate-or-refuse pipeline as everything else.

## 8. Red-team gate — must resolve before freeze

**Network reality:**

1. **AP isolation:** school/government/guest Wi-Fi frequently blocks client-to-client traffic — connections fail silently. Must be detected where possible, documented prominently, with the escape hatch named: bring a hotspot or travel router. *Likely the #1 real-world failure; test on an actual Cook County network.*
2. **mDNS candidates (Mode 2):** browsers mask local IPs behind `.local` candidates; managed networks sometimes break mDNS resolution. Verify on a managed network.
3. **RTCPeerConnection on insecure origins:** data channels currently work on `http://` LAN origins in Chrome and Firefox, but this is browser policy, not standard — verify on all three target browsers and pin the finding in the README.

**Mode 2 mechanics:**

4. **QR handshake density:** SDP-in-QR sizing, compression, multi-QR chunking; measured join time per player; the 20-player worst case timed end to end. *Prototype gate.*

**Host burden:**

5. **Host device load:** 20 data channels + rendering on a modest school laptop — memory/CPU measured, not assumed.
6. **Mid-game host refresh/crash:** does the session die (documented) or resume from local state with reconnection? Pick one honestly.

**Trust and custody:**

7. **Impersonation:** player names are self-asserted; kick-by-token must survive a bad actor rejoining with a new name. Decide whether that's acceptable for the threat model (a classroom) or needs a host-approval step per join.
8. **Cloud token custody:** exact storage location and lifetime of OAuth tokens; what a malicious theme/config could and could not reach (must remain: nothing).
9. **CORS reality check:** verified fetch paths for Drive API and Dropbox raw links for both state and audio; plain share links are known-broken and stay unsupported.

## 9. Out of scope for v2

- TURN infrastructure or any hosted relay beyond the session-scoped `serve.py` signaling endpoint.
- GitHub-integrated builder (still a future candidate).
- Full Feud rule modeling (strikes/steals) — the score panel remains a candidate, unscheduled.

-----
2026-08-18
#AI/Claude
