# Workflow compatibility

- reader.py owns inspection; node_schemas.py owns the finite native read-only schema registrations.
- Preserve serialized widget/slot order and raw unknown properties. No automatic node conversion or native execution from inspection.
- Verify both Python migration tests and tests/migration/readonly_nodes.test.mjs when schemas or import behavior change.
