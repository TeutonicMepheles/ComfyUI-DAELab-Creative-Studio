"""Run with python -m tools.migration. Output contains metadata, never source bodies."""
import argparse
import json
import sys
import zipfile

from .prepare import initialize_workspace, preflight, migrate, rollback
from .safety import MigrationError, load_json
from .profiles import prepare_profiles, active_profile, observe_runtime, seal_profile, select_profile, fence_profile


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
    profiles = commands.add_parser("prepare-profiles")
    profiles.add_argument("plan")
    active = commands.add_parser("active-profile")
    active.add_argument("workspace")
    observe = commands.add_parser("observe-profile")
    observe.add_argument("workspace")
    observe.add_argument("profile_id")
    observe.add_argument("--pid", type=int, required=True)
    observe.add_argument("--port", type=int, required=True)
    fence = commands.add_parser("fence-profile")
    fence.add_argument("workspace")
    fence.add_argument("profile_id")
    fence.add_argument("--pid", type=int, required=True)
    fence.add_argument("--port", type=int, required=True)
    seal = commands.add_parser("seal-profile")
    seal.add_argument("workspace")
    seal.add_argument("profile_id")
    seal.add_argument("observation_id")
    for name in ("activate-profile", "rollback-profile"):
        select = commands.add_parser(name)
        select.add_argument("workspace")
        select.add_argument("operation_id")
        select.add_argument("profile_id")
        select.add_argument("--expected-sequence", type=int, required=True)
        select.add_argument("--current-seal")
        select.add_argument("--target-seal")
    args = parser.parse_args(argv)
    try:
        if args.command == "init":
            result = initialize_workspace(args.workspace)
        elif args.command == "rollback":
            result = rollback(args.workspace, args.migration_id)
        elif args.command == "prepare-profiles":
            result = prepare_profiles(load_json(args.plan))
        elif args.command == "active-profile":
            result = active_profile(args.workspace)
        elif args.command == "observe-profile":
            result = observe_runtime(args.workspace, args.profile_id, args.pid, args.port)
        elif args.command == "fence-profile":
            result = fence_profile(args.workspace, args.profile_id, args.pid, args.port)
        elif args.command == "seal-profile":
            result = seal_profile(args.workspace, args.profile_id, args.observation_id)
        elif args.command in {"activate-profile", "rollback-profile"}:
            result = select_profile(args.workspace, args.operation_id, args.profile_id,
                                    expected_sequence=args.expected_sequence, current_seal=args.current_seal,
                                    target_seal=args.target_seal, rollback=args.command == "rollback-profile")
        else:
            plan = load_json(args.plan)
            result = preflight(plan) if args.command == "preflight" else migrate(plan)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 2 if args.command == "preflight" and (result["blockers"] or result["safetyErrors"]) else 0
    except (MigrationError, OSError, ValueError, TypeError, KeyError, zipfile.BadZipFile):
        # Do not expose input fragments, SQL bodies or filesystem exception details.
        print(json.dumps({"error": "Migration refused: invalid, changed, unowned or unsafe input. Run preflight and inspect the owned manifests."}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
