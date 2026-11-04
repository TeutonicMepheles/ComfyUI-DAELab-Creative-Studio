# Meeting follow-up implementation

Task #37 follows user a4c80eb9 and the current product decisions. This record
describes source checks; final ComfyUI acceptance belongs to Reviewer.

Implemented changes:

- DeepSeek is removed from assembled providers, catalogs, credential controls and
  request headers. Compatibility names reject use without reading credentials.
  Saved model IDs/results remain intact; Comfy GPT text and image/video credit
  routes remain available, and Qwen remains the text default.
- New columns offer text/image choices. Column-name clicks open the three basic
  actions; the header context menu retains output/optimization capabilities.
  Existing row actions and generation-only table output restrictions are retained.
- Imported chapter tables have a local fold control. Folding only changes the
  view; the accepted four-column structure, row IDs and generated results remain.
- Media thumbnails have a visible remove button alongside keyboard removal.
  Group replacement clears obsolete trailing cells in the target column while
  retaining rows and other columns. Generation reference injection replaces its
  previous references; manual file uploads still append.
- Linked generation nodes show the task total and omit duplicate task thumbnails.
  Aggregate progress is derived from completed tasks and reported task progress.
  Results use a popup viewer/selection entry instead of a long inline list.
- Text result application asks for confirmation before applying/outputting.
- New table-to-image/video connections attach the generation card below its table;
  position follows table movement/size without changing the generation card size.
  Existing unpinned saved layouts are retained. Empty table panel regions can be
  dragged while editing controls/cells remain protected. Wire compatibility dims
  unavailable targets, and edge magnets cover the full target height.

Checks: strict TypeScript, architecture (198 modules), 675 business tests,
448 frontend/unit tests with 3 existing skips, and 140 generation backend tests
passed. Retired DeepSeek submission/key tests were replaced with rejection,
no-key-read, preserved-identity and Qwen concurrency/history coverage.

A temporary Chromium source fixture verified that the visible remove button
deletes exactly its own item and leaves the peer item available. No inference or
user workflow was used. Raw logs/fixture/screenshot stay in `.local-meeting-*`.

Independent host checks must cover the acceptance table's menu, chapter, drag,
replacement, result confirmation and attached-position interactions. Asset-library
physical directories/persistence are a separate implementation, as are new model
profiles and actual inference. They are not claimed complete by this commit.
