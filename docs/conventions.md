# Conventions — Quiz Board Engine

Pinned local copy. `CLAUDE.md` `@import`s this file so the project stays viable in a
standalone clone.

## Work chunks (structural — the only axis with IDs)

- **Feature** `F<N>` — a deliverable unit of user value; decomposes into Tasks.
- **Task** `F<N>-T<M>` — an implementation step inside a feature.
- **Chore** `C<N>` — an operational task the human performs (parallel track to Features).
- **Retrofit** `F<N>b`, `F<N>c` — a second pass on a shipped feature.
- **Delta** `D<N>` — a proposed change to spec-stated behavior. Register-only: lives in the
  plan, awaits maintainer ratification. Never appears in a commit, branch, or PR title.

## Lifecycle (metadata, not a container)

- **Phase** — design / build / test / deploy. A tag, not a structural ID. A feature in build
  phase is still `F3`, never "Phase 3."
- The build plan groups features into ordered phases for scheduling. Those groupings are
  **schedule labels only** — they never become work-chunk IDs. A commit touching the grid
  renderer is scoped `F3`, not `phase2`.

## Authorization

- **Gate** — a boundary crossed only with explicit go-ahead. Phases and features are
  separated by gates.

## Merge

- **PR** — unit of change merged to `main`; addresses one or more Tasks on one feature branch.
- Branch naming: `<feature-id>/<slug>` or `<task-id>/<slug>` — e.g. `F1/loader-validator`.
- Commit messages: `<type>(<id>): <description>` — conventional commits, ID in the scope.
- PR titles lead with the primary ID. PR body has an `Addresses:` line enumerating tasks.
- Merge strategy: **rebase-and-merge** — no squash, no merge commits. Preserves each commit
  for audit.

## Licensing

- AGPL-3.0-or-later. Every source file carries `SPDX-License-Identifier: AGPL-3.0-or-later`.
- Vendored third-party code keeps its own license file, unmodified, and is recorded with
  version + source URL + SHA-256 in `vendor/README.md`.

-----
2026-08-16

#AI/Claude
