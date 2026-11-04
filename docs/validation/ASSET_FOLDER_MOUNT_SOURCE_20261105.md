# Asset library folder mounting — 2026-11-05

Base: `21d0d7fad4697514c61bbee1aac5a60fffb815c5`. Branch `codex/asset-folders-mount`.

The existing bottom asset-library entry now opens the reviewed left-tree/right-content layout with breadcrumbs, back navigation and inline folder creation. The expanded panel remains in screen coordinates. Controls and directory/material names use the shared body typography; the implementation reuses the approved reference layout and existing theme tokens.

Folder navigation only changes browsing state. New directories remain selected in their parent; entering an empty directory shows its actual empty state. Existing favorites remain at the root and retain their IDs, files, references and add/preview behavior. This change adds no assignment, move, rename or delete operation. Physical folders are owned by the existing database's `asset-library` directory, with the existing `folderId`/`parentId`/relative-path mapping.

Closing hides the existing panel, preserves browsing position, cancels view requests and invalidates folder reload callbacks. A pending creation may finish its authorized server write but cannot restore a closed or superseded editor. Destruction removes owned listeners and controls. Folder events bubble to the existing drawer's canvas-event isolation; Escape inside the naming field cancels that draft without closing the library.

## First failure and correction

Controller's two failing test files did not run their DOM or lease assertions. Both failed during import resolution because the fixture did not transpile the new folder panel's application-service dependency. The fixture now loads that actual dependency and models native DOM reparenting; existing view and panel-lease checks pass. No lifecycle requirement was inferred from the filenames.

## Four persistence/upgrade proofs

`tests/backend/test_asset_folder_persistence.py` creates only synthetic temporary storage.

| Proof | Executed assertions | Local evidence |
| --- | --- | --- |
| Upgrade before/after | Schema 4 upgrades to 5; all previous table rows and original workflow bytes unchanged | `.local-folder-evidence/01-upgrade.json` |
| Only newly owned directories | Real parent/child directories; same-parent case-insensitive duplicate refused; different-parent same name allowed; fresh Python process reads identical stable IDs and paths | `.local-folder-evidence/02-only-new.json` |
| Snapshot roundtrip | Existing SQLite snapshot tooling roundtrips the logical digest, IDs and paths; copying the owned directory tree preserves physical empty directories | `.local-folder-evidence/03-snapshot-roundtrip.json` |
| Failure | Invalid names and permission denial rejected; injected database publication failure rolls back its physical directory; no orphan or previous-row mutation | `.local-folder-evidence/04-failure.json` |

To regenerate JSON, set `STUDIO_FOLDER_EVIDENCE_DIR` to a local evidence directory and run the focused test file. Raw logs and screenshots remain local.

## Validation and limits

- Full `npm run check`: 449 frontend passed, 3 existing skips; 677 business passed; typecheck, build, architecture/assets and provenance checks passed.
- Python: backend 74, unit 16, migration 104 passed.
- Real Chromium using generated modules and an injected synthetic service: desktop 1440×1000 and narrow 600×800, inline creation, navigation and empty directory passed with no page errors. Search/filter/new-folder/folder-name computed styles all matched: shared font family, 14px, weight 400, line height 21px. Screenshots: `.local-library-desktop.png`, `.local-library-empty.png`, `.local-library-mobile.png`.

The browser fixture does not claim live-host acceptance. Reviewer must verify the integrated build's actual API, physical directories, restart persistence and unchanged user assets/favorites. No live host, GPU task or user storage was changed. Generated `web` output is not included in this source handoff; integration rebuilds it. The reviewed product document remains on `9d38b4c` and should accompany integration.
