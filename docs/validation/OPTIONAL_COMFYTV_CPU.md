# Optional ComfyTV CPU host preparation

On 2026-10-25, an isolated real ComfyUI host started successfully with only Creative
Studio and the separately archived, read-only ComfyTV package. This establishes
startup and HTTP integration evidence. It does **not** establish visual acceptance,
generation quality, GPU behavior, or release readiness.

| Component | Observed identity |
| --- | --- |
| ComfyUI | `3c1b7a17fdf239d35ce98cc777756f572d089795`, Python 3.12.11, CPU |
| ComfyTV | `a5e0c16b5ca7f74b31293c2f940a704107e4a009` |
| Studio frontend | `18a16c33bc0d5032543c47d9260bcf24b53fe86719cfc27720244918f40762ce` |
| ComfyTV archive SHA-256 | `6baa861d402e3d18a56fd3848d38d67f8b8a03930e0d801a62adc644c6a000c7` |
| Isolated origin | `http://127.0.0.1:8227` |

## Preparation and boundaries

`tools/host/prepare_optional_comfytv.py` requires the exact clean ComfyTV repository
and host revisions. It uses `git archive` for ComfyTV and the existing Studio
snapshot preparation API, rejects existing destinations, and writes only below a
new repository `.local/` environment. It never installs or bundles ComfyTV in the
Studio distribution. The original repositories are read-only inputs.

The tool is invoked from the repository root with the locally reviewed source and
runtime manifest. It deliberately does not adopt an existing environment:

```powershell
python -m tools.host.prepare_optional_comfytv --comfytv-source <reviewed-source> --start
```

The real launch uses `--cpu --offline --disable-all-custom-nodes`, the exact
`ComfyUI-DAELab-Creative-Studio ComfyTV` whitelist, telemetry disabled, and separate
base/user/input/output/temp directories. `-B` prevents Python bytecode writes in
the source host. No extra model paths or generation provider configuration is
supplied. ComfyTV initializes its database under the isolated user directory,
copies 39 local workflow definitions and their presets there, and seeds local
settings. Its default backup destination is inside the isolated package copy;
the first startup skips backup because no database exists yet.

A Python audit hook records socket resolution/connection and child-process events.
It rejects external and protected-host connections and unreviewed child commands.
The only reviewed child commands are the read-only ROCm SDK path query needed by
the installed PyTorch import and ComfyTV's exact workflow `git ls-files` query.
This is a bounded diagnostic guard, not an operating-system network sandbox.
The observed startup issued the ROCm query and one loopback socket connection;
no external connection or model execution was observed. No inference was submitted.

The initial launcher incorrectly treated Windows' string form of
`rocm-sdk path --root` as the entire executable name and blocked host import.
That failed launch and its logs were retained; parsing was corrected before the
successful real launch. The final tool further narrows the Git argument match.
The already running host retains its recorded earlier guard bytes; both guard
hashes are in the private handoff manifest. No host restart was performed during
the UI handoff.

## Observed checks

- Real `/object_info` identifies 9 formal Studio nodes, 2 native compatibility
  nodes, and 182 ComfyTV nodes. Four old LLM types are frontend compatibility
  registrations and require UI verification; they are not backend executable nodes.
- `/extensions` contains the Studio and ComfyTV entries without either old Canvas
  or old business package. Studio health reports a compatible frontend build.
- Real `/queue` is empty, and the Studio SQLite job count is zero at capture time.
  Local generation reports `configured: false` and `readinessVerified: false`.
- Asset registration uses only two public synthetic PNG fixtures. The same-origin
  traversal request returned 400, missing Origin returned 400, and cross-origin
  writes were rejected by the host with 403. Favorites remained unchanged.
- All 2,915 archived ComfyTV files still match their recorded hashes after startup.
  The ComfyTV source and fixed host repositories remain at their clean revisions.
- The seven optional-host contract tests passed. The complete `tests/host` suite
  passed 29 tests with the host's Python 3.12.11. These tests do not launch another
  host or model.

## Actual upstream limitation

At this pinned ComfyTV revision, `nodes/stages/__init__.py` imports
`StoryboardStage` but omits it from the returned node list. Consequently the real
host has no `ComfyTV.StoryboardStage` type. It does register
`ComfyTV.StoryboardEditorStage`. Old Storyboard table acceptance cannot be claimed
from the editor checks, nor should the missing upstream registration be silently
reintroduced by Studio.

## UI handoff, not yet acceptance

Two prepared workflows are visible through the isolated host's normal workflow
listing. Their files live under
`.local/host-optional-comfytv/user/default/workflows/`:

1. `Optional-ComfyTV-Two-Instances.json` contains two real StoryboardEditor nodes
   (IDs 1/2), two Studio Tables (3/4), and two registered synthetic uploads (5/6).
   Table defaults are the public three-column, three-row baseline. Editor board
   documents have separate synthetic dialogue. Initial links are empty.
2. `Optional-Legacy-Readonly-Six.json` is an unchanged copy of the public migration
   fixture for the six retained legacy types. It is for read-only rendering and
   save/reopen checks, never execution.

Open a **new** in-app browser tab for port 8227. Do not reuse tabs for other hosts.
Open the first workflow through the native workflow UI and inspect both Studio
tables and both ComfyTV editors. Enter Creative Canvas, expand each editor through
its public adapter, change each dialogue independently, and switch back to native
mode to check that the borrowed panel is returned. Repeat the mode switch and
check focus, scrolling, overflow, and different zoom/viewports.

Connect upload 5 `image_refs` output slot 1 to editor 1 `images` input slot 1, then
repeat for upload 6/editor 2. The editor's other input is `storyboard` at slot 0;
its outputs are `image`, `images`, `video` at slots 0, 1, 2. Save under a new test
name, reload, reopen, and inspect independent board/table state and native links.
Do not run workflows or generation. Open the second workflow separately to inspect
the compatibility report, preserved raw data, and save/reopen behavior.

The preparation subagent performed no UI interactions. The main task subsequently
ran the workflow in the actual isolated 18a16c host. Both editor dialogues remained
independent through native/creative mode changes. Shared Slot drags produced the
native links `[1,5,1,1,1,"COMFYTV_IMAGES"]` and
`[2,6,1,2,1,"COMFYTV_IMAGES"]`; the two Studio tables retained four and three rows
respectively after save/reload. The saved workflow is
`Optional-ComfyTV-UI-complete-18a16c.json` in the private host directory.

Expanded panels were inspected at 1920×1080, 1280×720 and 680×720. On the narrow
viewport the upstream editor retains its minimum width inside Studio's bounded
horizontal scroll area; focusing the text field scrolls it into view. Ctrl+S from
the focused editor preserved the dialogue. Screenshots and DOM measurements are
under private `evidence/ui-*`. Initial card overlap prevented one first Slot drag;
that failed observation is retained, and a non-overlapping fixture kept all data
while allowing both actual connections. Zoom combinations and native IME still
remain open. These observations do not mark a phase or full integration gate passed.

## Private evidence

Exact machine paths, launch arguments, PIDs, runtime/source hashes, database paths,
HTTP captures, copied workflows, audit events, and first-failure logs remain under
ignored `.local/host-optional-comfytv/`. Principal records are
`optional-comfytv.json`, `evidence/http-boundary-verification.json`,
`evidence/fixture-manifest.json`, and `evidence/handoff.json`. None is a release
approval or a substitute for actual UI/model evidence.
