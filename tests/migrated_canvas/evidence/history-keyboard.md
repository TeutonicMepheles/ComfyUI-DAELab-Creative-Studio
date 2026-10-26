# Canvas connection history regression

Root's actual 8226 observation: create an editor, connect a two-image material
group, see two 3-second clips; one Ctrl+Z deletes the entire editor. Root's
saved reconnection workflow contains the real native link `[1,3,0,4,0,
"DAELAB_ASSETS"]`. This was not evidence of a missing native connection.

The installed frontend's source map identifies `src/scripts/changeTracker.ts`:
local artifact `settingStore-CbkuaYBI.js.map`, SHA-256
`56c6ff4df75b833e01720bccc1b90343586d92f44f0dbfaeca30d33d7a754761`.
`init()` installs a window capture listener that queues `undoRedo(event)` in
`requestAnimationFrame`. The Canvas root bubble listener also called `undo()`
immediately. Bubble cancellation cannot cancel the previously queued callback.
Creation and connection are correctly separate native `beforeChange` /
`afterChange` transactions; the derived timeline update is amended into the
connection state. One physical key was executing two history steps.

`history_keyboard.test.mjs` executes the actual Canvas root key handler with a
controlled native tracker contract and the observed capture-before-bubble / rAF
ordering. Before the fix, one Ctrl+Z produced `['undo', 'undo']`, including after
creation's debounce had already settled. The first failure is preserved in
`history-keyboard-first-failure.txt`. The fix delegates keyboard dispatch solely
to the native listener and only flushes pending state through the typed port.
It does not alter native queues, native graph ownership, layout-only restoration,
or derived clip rules. Programmatic undo/redo remains available.

Regression coverage: one undo retains the editor and removes its link/clips;
one redo restores the native link plus both clips (6 seconds); Ctrl+Shift+Z;
subsequent undo of creation; preserved current viewport; text-focus, Alt and
repeat handling. Existing layout identity and missing-capability checks also run.

These are controlled rule tests, not browser/product acceptance. Root must
rebuild and replay the actual 8226 gesture with two instances, save/reload and
mode switching before assigning that acceptance result.

Verification: `npm run typecheck` passed; the complete
`node --test tests/migrated_canvas/*.test.mjs` suite passed 75/75 after updating
the three changed production-file hashes in `canvas-files.json`. Raw results
are in `history-keyboard-regression.txt`.

## Follow-up: editor save and table history

Root subsequently observed Ctrl+S being swallowed while focus remained on the
clip copy button. The editor root's generic propagation listener, and its clip
menu listener, stopped every key. Both now reuse `ui/creative_events.mjs`, which
extracts the existing table propagation contract unchanged. The old table
export remains the identical function; the read-only compatibility panel uses
the shared import directly. No panel dispatches a second save command.

The table bubble listener also called `restore()` while native capture had
already scheduled undo. Its keyboard route now prepares the native shortcut
and retains `onRestore()` plus document invalidation without calling native
undo/redo again. Toolbar restore remains direct. Text focus, IME, Alt and repeat
guards, and standalone local history, are covered independently.

The first follow-up run reproduced 3 failures (swallowed save, double undo,
Alt/repeat dispatch) in `panel-table-keyboard-first-failure.txt`. Final Canvas
suite: 81/81, raw results `panel-table-keyboard-regression.txt`; business suite:
323/323; TypeScript and architecture checks passed. Host/UI verification remains
with root; these test counts do not assert product acceptance.
