# Unified generation parameters

Task #33 follows user message 00dc49da and product rule b8da923. Image and video
parameter sections share the same selected outline. Ratio buttons and summaries
show aspect ratios without pixel dimensions. Persistent automatic-size and saved
dimension explanations were removed. Integer duration choices follow model bounds;
saved fractional settings remain in the document and are not changed on opening.

The shared duration fallback also uses an integer step. No submitted request,
resolved output size or model capability was changed. Local/API availability and
existing image/video routes are retained.

Source checks passed: strict TypeScript, 677 business tests and the focused
24-test parameter/image suite. Existing tests that expected visible pixels or
fractional choices were updated to the new product rule while retaining their
configuration-preservation and peer-isolation assertions.

A temporary CPU Chromium fixture loaded the actual shared parameter component.
Image/video selected controls had identical computed font, weight, radius,
outline and height. Neither panel had small pixel captions or instruction text;
duration options were integer seconds, and a saved 4.5-second video retained its
original settings. The browser had no script errors or generation calls.
Raw fixture and screenshot evidence remains under `.local-parameters-*`.

Final build and actual ComfyUI acceptance remain with Controller and Reviewer.
