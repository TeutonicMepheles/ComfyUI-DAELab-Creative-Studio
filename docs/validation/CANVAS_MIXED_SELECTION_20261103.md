# Mixed canvas selection

Task #37 implements F-CAN-011 / TC-CAN-012. The source base is
`7e8a95aebd4d3036be199a5ece70830b0c6d3021`; integrate the separate initial
16:9 change before final deployment.

All selected cards receive the upload material's inverse-zoom selection ring.
Adapters with a selection surface retain that surface; other cards use their
outer frame. The enclosing selection box covers every chosen node. Grouping
controls still count only eligible materials.

Dragging an already selected title or noninteractive panel area moves the whole
selection in canvas coordinates. Controls, table cells, prompt text, playback,
timeline and ports retain their interaction. A four-screen-pixel threshold
preserves clicks and title double-clicks. One native history transaction covers
the movement; Escape, pointer cancellation and lost capture restore positions.
Selected groups carry their members once. Individually selected members dragged
with other nodes leave their unselected group; cancellation restores ownership.
Locked groups prevent that move. Single-material sorting and material drops keep
their existing controller.

## Evidence

Agent workspace `mixed-selection-check.mjs` uses browser-local source overrides
against 8365, without restarting or replacing its package. `mixed-selection-before.json/png`
records the old ring failure; `mixed-selection-after.json/png` records five-node
marquee selection, title/body movement, native undo/redo, Escape restoration,
material-title movement, save/reload, zoom changes and a second page's independent
selection. These synthetic browser canvases do not run models.

Five focused production-closure tests cover equal deltas, history, cancel/group
ownership, locks/control exclusion, group expansion and full-selection bounds.
The CSS scope guards explicitly retain table scroll surfaces outside isolated
data cells; neither TextInput nor LLM panel reset boundaries were changed.

Final generated build, integration with the 16:9 patch, real connected workflows
and deployed pointer interaction remain for Controller and independent Reviewer.
