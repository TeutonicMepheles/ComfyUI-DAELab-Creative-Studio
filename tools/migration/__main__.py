"""Run with python -m tools.migration. Output contains metadata, never source bodies."""
import argparse
import json
import sys

from .prepare import initialize_workspace, preflight, migrate, rollback
from .safety import MigrationError, load_json


def main(argv=None):
    parser = argparse.ArgumentParser(description="Prepare offline migration/rollback copies. Never switches services.")
    commands = parser.add_subparsers(dest="command", required=True)
    init = commands.add_parser("init")
    init.add_argument("workspace")
    for name in ("preflight", "migrate"):
        command = commands.add_parser(name)
        command.add_argument("plan")
    restore = commands.add_parser("rollback")
    restore.add_argument("workspace")
    restore.add_argument("migration_id")
    args = parser.parse_args(argv)
    try:
        if args.command == "init":
            result = initialize_workspace(args.workspace)
        elif args.command == "rollback":
            result = rollback(args.workspace, args.migration_id)
        else:
            plan = load_json(args.plan)
            result = preflight(plan) if args.command == "preflight" else migrate(plan)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2 if args.command == "preflight" and (result["blockers"] or result["safetyErrors"]) else 0
    except (MigrationError, OSError, ValueError, TypeError, KeyError):
        # Do not expose input fragments, SQL bodies or filesystem exception details.
        print(json.dumps({"error": "Migration refused: invalid, changed, unowned or unsafe input. Run preflight and inspect the owned manifests."}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
