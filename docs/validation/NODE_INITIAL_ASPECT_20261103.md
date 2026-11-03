# New generation and parser card frames

Task #34, F-CAN-004 / F-CAN-023. New generation cards initialize at 900×506.25;
new empty ScriptParser cards initialize at 1060×596.25. These are canvas frame
dimensions. Generation output resolution and model settings are unchanged.

Optional adapter initialAspectRatio initializes height only when a cards layout
is created. Existing layouts are not migrated. Saved height survives serialization
and clipboard copy/paste; manually resizing width does not force the ratio again.
Populated parser tables return to natural content height. Generic tables retain
their existing layout behavior. Bounded generation panels scroll long prompts
inside their prompt area so settings and run controls stay accessible.

Regression checks: 254 canvas tests, 639 business tests, TypeScript and 190-module
architecture checks passed. Model tests cover initialization, manual width, legacy
layouts, serialization, clipboard height and opt-out for populated content.

Actual isolated browser baseline measured ratios about 2.16 and 4.69 rather than
16:9. With source response overrides, both new frames measured 1.77778. The same
probe scrolled a long prompt while keeping the run control visible, resized width
with the keyboard, reloaded retained dimensions, populated the parser and observed
natural height, then loaded legacy layouts and retained their widths/no stored
height. Agent-local evidence: node-aspect-before/after.json/png. No host update or
inference was performed. Independent final-build verification remains required.
