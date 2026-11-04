# Independent native 27B text profile

Task 41; depends on PE source `a301e18` and display-name follow-up `f19d27a`.
This change adds a separate profile; it does not modify the shared host TextGenerate
class, old Qwen/Ollama bindings, defaults or saved choices.

## Configuration and flow

- ID `qwen3.8-27b-w4a8`, label `Qwen3.8-27B（本地）`, provider `local-qwen-27b-text`.
- Binding family `text_27b` contains only the explicit text_encoders name/path/SHA256.
  Configuration -> composition -> authoritative catalog -> capability -> frozen
  native graph is covered with a synthetic pinned file. Missing/changed components
  fail without selecting another profile.
- Existing standalone text polishing mode, including its sequential row handling
  and explicit apply confirmation. Image reverse mode and the separate protected
  table-optimization contract are not claimed for this text-only profile.
- CLIPLoader type qwen_image; official single-turn non-thinking ChatML rendering,
  greedy sampling, 1024 maximum generated tokens, **MTP off**. No user-facing switch
  or new style. User text remains JSON data inside the user role; embedded role
  delimiters are escaped without changing the decoded input.
- The existing owned native text output records actual output-token count, maximum,
  limit reached, template, MTP and raw/final body. Incomplete output cannot become an
  applicable proposal. PE retains MTP auto and its own reference-image template.

## Basis and limits

Architect's `model-deployment/27b-audit/COMPARISON.md` compares official vocabulary,
templates and installed code. The official source is
[Qwen's tokenizer configuration](https://huggingface.co/Qwen/Qwen3.8-27B/blob/main/tokenizer_config.json).
Reviewer retained three original requests:

| Configuration | Observation |
| --- | --- |
| Initial native request `f7aca6ae` | Loaded, but produced repeated invalid text |
| Official template only `6ffc8365` | Still invalid, 46.24 seconds |
| Same template, only MTP auto -> off `353de575` | Complete English prompt, 14.80 seconds |

The last result supports fixing MTP off in this independent profile. It does not
identify a quantization-kernel root cause or prove all inputs are stable. First
failures remain in Reviewer's gap-review alongside task39-27b-mtp-off-real.json.

Local tests cover native completion/profile separation and the full configuration
and request-construction boundary. Final integrated text-node execution, source
badge, confirmation/save/reopen and visible missing-component state remain for
Reviewer. No model inference, runtime replacement or shared-environment change
was performed by Implementer.

Local validation: complete `npm run check` passed (448 frontend tests, 3 existing
skips; 676 business tests); Python generation 150 and unit 16 passed. The installed
TextGenerate CPU-only contract printed `REAL_27B_TEXTGENERATE_CONTRACT_OK` with MTP
observed as false in the injected CLIP call. Updated discovery/catalog checks passed.
