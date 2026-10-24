# PERF-06 executable fixture

This package contains **zero nodes, zero UI, no real provider and no automatic
task submission**. It is excluded from the product installation. Installation
only registers `/studio-test/performance-scheduler/*`; an explicit driver POST
starts the fixed workload.

The fixture constructs the installed product's actual `GenerationService` using
the actual `CoreServices.jobs`, `.assets` and `.resources`. Resource capacity
delegates to the product `ResourceAdmission`; physical GPU locking delegates to
the raw product `LocalAdmission`. Thin wrappers record public ledger/asset calls,
dispatch, lease acquisition/release and provider observations. They do not add
queues, semaphores, scheduling policy or a second task database.

`fake-local`, `fake-cloud` and `fake-transcode` implement the product's provider
protocol. Fake transcode consumes a real catalog-registered, frozen synthetic
PNG input and performs bounded PNG write/read/hash work with real asset-result
validation. No video codec, model, GPU inference, Comfy
native queue or cloud transport is invoked. In particular this is not an
end-to-end test of `ExportService.execute` or the real native prompt worker.

## Preserved first failure and subsequent regression

The first random-loopback regression ran all 100 actual Studio service tasks:
91 succeeded, 6 failed as planned, and 3 queued GPU tasks were cancelled without
provider creation. There were 97 provider creates. The observed GPU lease and
provider peaks were 1; cloud and fake transcode each reached 33. The configured
budgets in TC-SYS-019 are GPU=1, cloud=3 and transcode=2. The latter two are
applicable failures, not N/A and not hidden by fixture-only semaphores.

Only GPU waiting/cancellation was observed in that initial implementation.
Cloud and transcode then had no product resource queue. A transient ledger `pending` state does not count as
queue evidence. The driver only requests queued cancellation for IDs observed
both pending and waiting inside the actual resource lease. It reports which
resource classes had no such observation.

The first short regression's health p95 was approximately 39.54 ms, but its
maximum was 1446.76 ms. Raw outliers and server slow-callback logs were preserved.
Later runs also record real ledger/asset public-method durations and whether
they ran on the event-loop or worker thread, plus provider and file-operation
durations. These nested timings must not be added together. They can locate
synchronous work without attributing every HTTP spike to a particular SQL call.

After the product added the shared `CoreServices.resources` coordinator, a new
100-job loopback run observed provider peaks of GPU 1, cloud 3 and transcode 2.
Each class had three genuinely waiting cancellations with zero provider creates:
86 succeeded, 5 planned failures completed, and 9 were cancelled (one cancellation
superseded a planned failure). There were 91 creates, no duplicate attempts, and
both uncertain submissions retained capacity until recovery observed a terminal
fact. The final actual resource snapshot had zero active, queued or retained
permits. The first run with that fix measured health p95 39.50 ms and max 173.25 ms.
The original failing evidence remains separate; it has not been rewritten.

These are random-loopback regression observations, **not ComfyUI performance
acceptance**. A new isolated ComfyUI installation and the complete measurement
protocol remain prepared, not executed. `productAcceptance` always remains false.

## Explicit installation and execution

The main host owner must first finish the unified product build. Preparation
rejects an existing destination and never starts or stops a host:

```powershell
python tools/performance/run_scheduler_plan.py --prepare-package .local/performance-scheduler-fixture-v3
```

Then use a new environment and an unused port, for example 8236. The existing
isolation tool checks the port again and copies the explicitly provided test
package under its test-only name. The actual runtime paths below come from the
already verified private runtime manifest:

```powershell
$perfRuntime = Get-Content -LiteralPath .local/baseline/runtime.json -Raw | ConvertFrom-Json
python tools/host/prepare_isolated.py `
  --source-host $perfRuntime.host.root --python $perfRuntime.host.python `
  --environment-root .local/host-performance-scheduler `
  --package-root . --port 8236 `
  --fixture-package .local/performance-scheduler-fixture-v3 --start

& $perfRuntime.host.python tools/performance/run_scheduler_plan.py `
  --base-url http://127.0.0.1:8236 `
  --output .local/performance-scheduler-evidence/first-comfyui-run.json
```

Do not use ports 8000, 8224, 8225, 8226, 8227 or 11434. The fixture verifies the
CPU/offline flags, isolation ownership, its prepared file hashes, and that the
actual product ledger lives under the isolated user directory. The driver checks
the exact fixture/plan handshake before submitting. No existing host or browser
is operated by either command.

Default collection warms health requests for 10 seconds, then performs five
rounds of at least 30 seconds. Each round has **100 new identities**, so the full
protocol has 500 total jobs, not 100 reused identities. Health requests continue
during preparation, execution, cancellation, query-only recovery and the rest of
each measurement interval. Busy-period p95 is reported separately to avoid
hiding busy spikes with idle samples.

The driver asks for cancellation of up to three genuinely waiting jobs from each
resource class. Two successful remote/media tasks deliberately lose their create
acknowledgement; recovery must query their original transport IDs. After every
observed job is terminal, a fresh real GenerationService is constructed over the
same product ledger and fake transport receipts; recovering all 100 identities
must not create work. This is **service reconstruction**, not a process-restart
or durable external-provider-storage test.

The output is created exclusively before submission. Failures, timeout state,
all job identities, attempt/event histories, phase timings, resource observations
and raw health samples are retained. The driver does not automatically cancel
unfinished jobs after a collection failure. Inspect the original fixture state;
do not submit a new run over a nonterminal previous run. Use a new evidence path
for every run. Existing SQLite facts and files are never reset by the driver.

## HTTP and injection contract

- `GET /manifest`: fixed plan hash, actual product-module hashes, test-only host
  kind and configured budget declaration. This performs no task work.
- `POST /run`: `{runId, planSha256}`; creates the 100 immutable actual ledger
  records through `GenerationService.submit`. A reused run ID is rejected.
- `GET /status`: observed job states, worker count, create counts and IDs currently
  waiting inside the delegated resource lease.
- `POST /control`: `{action:"cancel"|"recover",requestIds:[...]}`. All IDs must
  belong to the current fixture run. No arbitrary provider/native ID is accepted.
- `POST /reconstruct`: `{}`; allowed only after all 100 actual records are terminal.
- `GET /evidence`: full current-run observations plus actual ledger attempts/events.

Write routes require the exact loopback Origin. Preparation and the loopback
regression refuse production/existing-host ports. The package is inert until
explicitly installed and then explicitly run. It adds no product menu entries.

The observer forwards `core.resources.lease(resource, request_id=...)` and yields
the original product permit. It records scope exit separately from release:
`retained=true` is still capacity ownership. Only actual `permit.released` or
the delegated terminal `release(request_id)` records a release. `TASK` is an
observer ContextVar around real dispatch, never a task identity authority.
The fixture passes this wrapper as `GenerationService(resources=...)` and the
raw physical GPU gate as `admission=...`; it never counts GPU ownership twice.
No quota or execution engine is implemented inside FakeProvider.

Resource peaks come from the product's own mutex-protected `snapshot()` at
acquisition and observed-release boundaries, together with actual provider
active/finished events. They are not reconstructed from async scope lifetimes:
a worker can release its permit and wake its successor before the former
scope's release log reaches the event loop. The first report exposing that
observer ordering error is preserved separately. The v3 fixture adds raw atomic
snapshots and a deterministic regression with four open cloud scopes but only
three actual permits. Limits remain GPU 1, cloud 3 and transcode 2.

## Regression command

```powershell
& $perfRuntime.host.python -m unittest discover -s tests/performance -p test_scheduler_plan.py -v
```

This starts a temporary aiohttp server on a random loopback port and uses real
Studio services with temporary SQLite/files. It does not start ComfyUI. The
tests assert actual resource limits, all-class queued cancellation, retained
unknown ownership, frozen inputs, terminal capacity release and reconstruction
without new creates. Timing checks remain measured report facts; green tests
are not a green performance gate or ComfyUI acceptance.
