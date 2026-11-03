# Empty parser frame and display name

Task #38 follows the user's square empty-state request, superseding the parser
portion of the previous 16:9 requirement. Generation cards remain 16:9.

The previous check measured the outer 1060×596 canvas article. Its visible
workbench retained an inline 520-pixel height, explaining the screenshot's
roughly 2:1 surface. The empty parser now starts at 560×560. A narrowly scoped
canvas rule overrides the empty workbench's native inline height so its visible
border fills the saved frame. Populated tables retain natural height. A default
560×560 frame expands to 1060 width when records appear; changed widths and
legacy layouts are retained.

The native schema, creation menu, accessible panel name and workbench title use
“剧本文档解析器”. The stable `DAELAB.ScriptParser` identifier, slot order and saved
widget data remain unchanged. Custom saved node titles are retained.

Workspace evidence `parser-square-check.mjs` and `parser-square-{before,after}.json/png`
uses the actual double-click creation menu and browser-local source overrides.
The original visible surface fails the square assertion. The modified surface,
workbench and article measure 448×448 at 80% zoom; title and menu match. Width
adjustment survives reload, populated content expands, an untouched default
frame widens, a saved custom title/1200×640 layout survives, and a refreshed page
creates another square. A generation card remains 16:9. No models ran.

Type checking, architecture checks, 259 canvas tests, 639 business tests and
22 storyboard backend tests passed. Final generated build, server schema and
independent deployed interaction verification belong to Controller/Reviewer.
