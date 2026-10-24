# Fixed host compatibility regression

The current reference is ComfyUI frontend 1.53.10. Its local bundle and the extracted `ComfyNode.configure` method are SHA-256 pinned in `fixtures/host-1.53.10-contract.json`. No host bundle, private workflow, parameter values, credentials or host filesystem path is included in that fixture.

The failure comes from the host's `registerNodeDef` constructor/configuration contract: physical inputs are constructed before widget inputs; socketless widgets have no constructor socket. `ComfyNode.configure` places constructor inputs first, then appends historical inputs absent from the constructor. For the old GPT node this puts `imported_storyboard` first, changing saved indices. The compatible readonly path validates the exact historical schema, then calls the base `LGraphNode.configure`. It preserves the old 14-slot layout and the later layout with `imported_storyboard` appended at index 14. It does not accept reordered or mistyped slots. Widget restoration and native `onConfigure` hooks still belong to the base host implementation. Original widget data, node extensions and unknown fields remain archived and serialized unchanged.

The host also lifts unknown top-level workflow fields into `extensions`; its `LGraph.serialize` projection drops their old top-level positions. A single root graph bridge preserves those positions, keeps a distinct original `extensions` value with the same key, and leaves host schema fields under native ownership. Configure/clear/dispose replace or clear that archive. Both legacy `serialize` and current `asSerialisable` outputs are covered. Malformed extension containers fail before configuration instead of being silently normalized. This contract is pinned to this host schema; a later host schema requires a fresh review of its owned root fields.

`Subgraph.asSerialisable` omits all graph extension payloads. Nested bridges bind at the host's `createNormalizedSubgraph` boundary before its topologically ordered configure calls, using normalized stable graph/node/link identities. Recursive definitions may be flattened by the host without losing their metadata. Unknown graph, node, socket, link and definitions-container fields retain their original locations, including conflicting namespaced fields. Projection visits only current native entities; renamed/moved/edited entities remain native, deleted entities are not recreated, and replacements reusing old IDs do not inherit the old objects' payloads. Native removal can delete definitions from `rootGraph.subgraphs`; the corresponding bridge and ownership-map entry are released immediately, with serialization also checking for registry removal. Twenty create/remove cycles exercise this release boundary. This is a functional lifecycle regression, not a performance acceptance result.

The public `fixtures/nested-readonly-workflow.json` contains root → outer → inner graphs, globally unique native node/link IDs, one readonly prototype and one readonly GPT node, two deliberately unknown placeholders, typed native wires, and different `unknownWorkflow`/`extensions.unknownWorkflow` values at each graph level. Its deterministic generator is `build_nested_fixture.py`. Open the outer and inner graph nodes in the actual host, edit a title or position, save a new copy and reload; compare each graph by UUID and each node/link by ID. Both legacy nodes and unknown placeholders are disabled. No provider or execution is needed. Non-UUID historical graph identities require explicit migration; they are refused before host reminting can detach their unknown payloads. An object-form link carrying unknown metadata cannot be silently converted to the legacy array format; the bridge refuses that save and requires native version 1 export.

Run the portable regression:

```powershell
node --test tests/migration/readonly_nodes.test.mjs
```

To also execute the three unmodified methods extracted from an installed pinned bundle, set its local path explicitly:

```powershell
$env:STUDIO_PINNED_HOST_BUNDLE = '<installed frontend assets directory>\settingStore-CbkuaYBI.js'
node --test tests/migration/readonly_nodes.test.mjs
Remove-Item Env:STUDIO_PINNED_HOST_BUNDLE
```

The tests reject a bundle hash mismatch. Without that variable, the three installed-bundle checks are reported as skipped; the portable transformation regressions still run. The actual methods execute against bounded graph/store and widget doubles, with no browser, server, queue, provider or model invocation. They demonstrate the host transformation and the serialization boundary, not complete product acceptance.

Local validation completed: 21 focused checks including all three installed-bundle method checks, plus TypeScript checking and 37 Python migration checks. The first UI failure and raw logs remain private under `.local/baseline/compat-load-first-failure*`; the first regression logs remain under `.local/validation/compat-*`. Product acceptance still requires the root agent's fresh isolated-host load of the six readonly nodes and nested fixture, two-instance/focus/mode inspection, native save/reload and exported JSON comparison (including `unknownWorkflow`, slot indices/types, links and named/positional widget values). Build `0cffc7` predates this fix and is not passing compatibility evidence. No full product build or host restart was performed by this subtask.
