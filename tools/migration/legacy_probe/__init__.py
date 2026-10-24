"""Explicit isolated-host observer package, never a Studio node implementation.

Install ONLY by copying this complete directory as
<owned isolated installation>/custom_nodes/StudioMigration.LegacyProbe.
It refuses port 8000. Importing tools.migration.legacy_probe is inert.
GET /daelab/migration/legacy-runtime?nonce=<32 lowercase hex> is read-only.
POST /daelab/migration/legacy-runtime/fence is an EXPLICIT one-way shutdown
preparation action for a verified selected profile. It stops admitting new work
until process restart; it never cancels work or changes a queue/receipt/lock/model.
"""
from pathlib import Path
from .probe import register

NODE_CLASS_MAPPINGS = {}
NODE_DISPLAY_NAME_MAPPINGS = {}

if Path(__file__).parent.name == "StudioMigration.LegacyProbe":
    import folder_paths
    from comfy.cli_args import args
    from server import PromptServer
    register(PromptServer.instance, folder_paths, args)
