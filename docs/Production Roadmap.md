# TAV Asset Guard — Production Features Roadmap

> **Status note**: this document describes the **target state** of the post-demo restructure. As of the commit that introduced this file, Phase 0 has only just started — most paths described below (`firmware/`, `deployment/`, `mobile/`, `devices/`) do not yet exist in the repo. See the **Files Modified Summary** for what each phase changes. Update this note as phases land.

> **Repo rename**: this project is being renamed from `ag-firmware` to `asset-guard` to reflect the broader scope (it is a full solution — firmware, backend integration, customer deployment artifacts, and field-deployment mobile app — not just firmware). The rename happens on GitHub and in `.git/config`; local working copies stay functional as long as `origin` is updated. All paths below assume the new layout.

## Context

The MD1 proof-of-concept was demo'd successfully on **2026-04-28**: motion → LoRa → gateway → HiveMQ → ThingsBoard → Telegram alert with a tappable map pin, end-to-end. The HiveMQ pipeline is now a **verified known-good baseline** — important because Phase 2 and Phase 3 below explicitly preserve and then migrate away from it, and we need to be able to spot a regression against that baseline.

For production we need the MD1 to hit its 5+ year battery-life target (deep sleep), eliminate the intermediate MQTT broker (HiveMQ — we do not want to run an MQTT server in production), give field installers a structured home for ThingsBoard / customer-deployment artifacts, and ship a minimal mobile app so installers can commission devices without a laptop.

The improvements, in priority order:

0. **Project restructure** — move upstream Meshtastic into `firmware/`, introduce `devices/` for per-device product files, introduce `deployment/` for customer-deployment artifacts (ThingsBoard dashboards, rule chains, customer-branded assets), reserve `mobile/` for the field-deployment app, keep solution-level prose docs at the top-level `docs/`. Prerequisite for everything else. Also reconciles a few doc-vs-code drifts that have accumulated since the original plan.
1. **Deep sleep + fast wake-on-motion** — SYSTEM_OFF (~0.3 µA) with `nrf_gpio_cfg_sense_set()` wake on the IMU INT1 pin, plus a "motion boot" path that skips BLE/screen/non-essential modules to send the position within ~10 s of wake. 5+ year battery life on CR123A. Top firmware priority — without this the product is not fieldable beyond demos.
2. **Gateway firmware update** — upgrade the gateway from stock Meshtastic 2.5.15 to our TAV fork head (2.7.22.xxx) **while still publishing to HiveMQ**. Establishes a known-good 2.7.22 baseline before we change the publish path. Isolates the version upgrade from the broker change so we can independently verify each step.
3. **Direct ThingsBoard publish from the gateway** — eliminate HiveMQ entirely. The gateway publishes directly to ThingsBoard's MQTT Gateway API using a single gateway-device access token. All MD1s auto-register as child devices in ThingsBoard. Requires the 2.7.22 baseline from Phase 2.
4. **Field-deployment mobile app** — minimal tool (barcode scan → set fixed position from phone GPS → activate device → optional install photo → commissioning test). Factory-stage configuration is pre-loaded via the existing meshtastic Python CLI; the app only handles per-site setup. Requires Phase 3 so commissioning test exercises the production publish path, and Phase 1 so it exercises the production wake-from-sleep path.
5. **Proper `imu_sensitivity` proto field** — replace the repurposed `detection_sensor.state_broadcast_secs` with a dedicated field on `DetectionSensorConfig`, restoring the upstream heartbeat semantics. **Deferred to last** — the current `state_broadcast_secs` repurposing is functional, just not ideal.

Phase 0 is a prerequisite. Phase 1 (deep sleep) lands first because the demo'd PoC runs at full current draw — without deep sleep, the product is not fieldable beyond demos and we cannot do realistic battery-life testing. Phase 2 then upgrades the gateway as a pure version bump with no behavior change. Phase 3 changes the publish path on the upgraded gateway. Phase 4 builds the mobile app against the now-production firmware + production publish path. Phase 5 lands last on the protobufs fork that Phase 3 establishes.

---

## Phase 0 — Project restructure

### Goal
Restructure the repo into a conventional project layout that cleanly separates **top-level prose docs**, **per-device product files**, **customer deployment artifacts**, **the field-deployment mobile app**, and the **firmware tree** (upstream Meshtastic plus our modifications). The current layout scatters upstream Meshtastic files at the repo root, making it unclear what is TAV-specific vs upstream.

### Proposed top-level layout

```
asset-guard/
├── README.md                           # Project landing page, product table, quick start
├── CLAUDE.md                           # Harness + project context
├── LICENSE
├── docs/                               # SOLUTION-LEVEL prose docs only
│   ├── Field Configuration Guide.md    # combined: covers MD1 + gateway
│   ├── ThingsBoard Telegram Alerts.md  # per-device rule chain pattern (renamed, no hyphens)
│   ├── Production Roadmap.md           # in-repo home for this plan
│   ├── System Architecture.md          # (future) overall solution diagram, data flow
│   └── Solution Setup.md               # (future) end-to-end install + commissioning
├── devices/                            # PER-DEVICE product roots
│   ├── md1/
│   │   ├── README.md                   # MD1 overview + URS merged
│   │   └── hardware/                   # photos, schematic refs, pinouts (future)
│   └── gateway/
│       ├── README.md                   # Gateway product overview, RAK11200 notes
│       └── hardware/                   # (future)
├── deployment/                         # CUSTOMER DEPLOYMENT ARTIFACTS
│   ├── shared/                         # cross-customer reusable
│   │   └── thingsboard/
│   │       ├── dashboards/             # baseline dashboard JSON exports
│   │       ├── rule-chains/            # MD1 Rule Chain, etc.
│   │       ├── device-profiles/        # MD1, Gateway, generic meshtastic-node
│   │       ├── images/                 # icons, baseline branding assets
│   │       └── mqtt2tb.js              # transform spec (moved from docs/)
│   └── customers/
│       └── <customer-id>/              # e.g. customers/tav/
│           ├── thingsboard/
│           │   ├── dashboards/         # customer-branded dashboard variants
│           │   ├── customers/          # TB customer-entity exports
│           │   └── images/             # customer logos, site photos
│           └── sites/                  # per-site install records (lat/lon, photos)
├── mobile/                             # FIELD-DEPLOYMENT APP (Phase 4)
│   ├── README.md
│   └── (codebase scaffolded in Phase 4)
├── firmware/                           # all firmware code (Meshtastic upstream + mods)
│   ├── platformio.ini
│   ├── src/
│   ├── variants/
│   ├── protobufs/                      # submodule
│   └── ... (all upstream-layout files)
├── tools/                              # scripts, build helpers
└── tests/                              # SOLUTION-LEVEL integration/E2E tests
```

### What goes where — rationale

**`docs/`**: solution-level prose only. Combined / cross-cutting documentation: architecture diagrams, end-to-end setup, the field-config guide, the Telegram-alerts pattern, this roadmap. A document that applies to only one device does NOT live here.

**`devices/<name>/`**: device-specific documentation, product assets, and the README. Each device is a self-contained subfolder. The MD1 URS migrates into `devices/md1/README.md` as a section; the standalone URS file is deleted.

**`deployment/`**: everything related to deploying the solution at a customer. Two main subtrees:
- `deployment/shared/` — reusable, cross-customer artifacts. Baseline ThingsBoard rule chains, device profiles, dashboards designed to drop into any deployment. The `mqtt2tb.js` transform moves here.
- `deployment/customers/<customer-id>/` — per-customer overrides and customer-specific content. Customer-branded dashboards, logos, customer-entity exports, per-site install records (GPS coords, install photos, contact info). Suitable for one or many customers — at small scale we have just `customers/tav/`.

**`mobile/`**: codebase for the field-deployment app (Phase 4). Top-level slot because it is its own project with its own build system, even though the app itself is intentionally tiny.

**`firmware/`**: everything that gets compiled. Effectively a mirror of the upstream Meshtastic project tree. Subdirectory approach only — this is a fork, not an add-on. All TAV-specific files (`DetectionSensorModule` IMU mode, `LSM6DS3Sensor::initForDetection()`, MD1 variant) live alongside upstream code.

**`tools/`**: future home for project-level scripts (e.g. `tools/flash-md1.sh`). Empty in Phase 0 but reserved.

**`tests/`**: solution-level integration / E2E / ops tests. Firmware unit tests stay in `firmware/test/`.

### File move operations

All moves use `git mv` to preserve history.

**Upstream Meshtastic files → `firmware/`:**

```bash
git mv src firmware/src
git mv variants firmware/variants
git mv protobufs firmware/protobufs             # submodule — .gitmodules path updated
git mv boards firmware/boards
git mv data firmware/data
git mv extra_scripts firmware/extra_scripts
git mv partition-table.csv firmware/partition-table.csv
git mv partition-table-8MB.csv firmware/partition-table-8MB.csv
git mv platformio.ini firmware/platformio.ini
git mv userPrefs.jsonc firmware/userPrefs.jsonc
git mv meshtasticd.spec.rpkg firmware/meshtasticd.spec.rpkg
git mv rpkg.conf firmware/rpkg.conf
git mv Dockerfile firmware/Dockerfile
git mv Dockerfile.test firmware/Dockerfile.test
git mv alpine.Dockerfile firmware/alpine.Dockerfile
git mv flake.lock firmware/flake.lock
git mv flake.nix firmware/flake.nix
git mv shell.nix firmware/shell.nix
git mv debian firmware/debian
git mv pyocd.yaml firmware/pyocd.yaml
git mv suppressions.txt firmware/suppressions.txt
git mv monitor firmware/monitor
git mv release firmware/release
git mv bin firmware/bin
git mv version.properties firmware/version.properties
git mv branding firmware/branding
git mv images firmware/images
git mv meshtestic firmware/meshtestic
git mv test firmware/test
git mv renovate.json firmware/renovate.json
```

**Device-specific docs:**

The URS is merged into `devices/md1/README.md` rather than moved as a standalone file:

```bash
# 1. Create the new README skeleton (product summary + build + links)
# 2. Paste URS content as a "## User Requirement Specification" section
# 3. Delete the old URS file — git tracks history via the merge commit
git rm "docs/MD1 - User Requirement Specification.md"
git add devices/md1/README.md
```

**ThingsBoard-related artifacts → `deployment/shared/thingsboard/`:**

```bash
git mv "docs/mqtt2tb.js" "deployment/shared/thingsboard/mqtt2tb.js"
# Future: dashboard exports, rule chain exports, device profile JSON go here as we capture them
```

**Doc rename (no hyphens):**

```bash
git mv "docs/ThingsBoard-Telegram-Alerts.md" "docs/ThingsBoard Telegram Alerts.md"
```

**Stays in `docs/`, in-place rewrite as needed:**

- `docs/Field Configuration Guide.md` — internal links updated to new layout
- `docs/ThingsBoard Telegram Alerts.md` (renamed) — generalized to per-device pattern; auto-profile language removed; reference to `mqtt2tb.js` updated to its new home in `deployment/shared/thingsboard/`
- `docs/Production Roadmap.md` — this file

Top-level stays minimal after the move: `README.md`, `CLAUDE.md`, `LICENSE`, `CODE_OF_CONDUCT.md`, `CONTRIBUTING.md`, `SECURITY.md`, `docker-compose.yml`, and the new directories (`docs/`, `devices/`, `deployment/`, `mobile/`, `firmware/`, `tools/`, `tests/`).

### Doc-vs-code reconciliation

Three drifts have accumulated and must be fixed during Phase 0:

1. **CLAUDE.md "Implementation Progress" section** — currently lists in-progress PoC milestones. After demo it is historical. **Action**: collapse to a one-liner pointing at this roadmap. The known-quirks/gotchas section remains; only the progress narrative goes.
2. **CLAUDE.md "ThingsBoard Cloud integration" section** — claims `mqtt2tb.js` "maps `TAV-MD1-*` nodes to the `MD1` device profile on creation". The converter no longer does this. **Action**: rewrite the bullet to describe the current behavior (single default `'TAV Device'`, manual profile assignment). **Status: shipped as a precursor commit.**
3. **`docs/ThingsBoard Telegram Alerts.md`** (renamed) — same auto-profile claim. **Action**: same correction. **Status: shipped as a precursor commit.**

### Internal link updates inside docs

- `devices/md1/README.md` (new, contains merged URS content) — links to `../../docs/Field Configuration Guide.md` and `../../docs/ThingsBoard Telegram Alerts.md`
- `docs/Field Configuration Guide.md` — `CLAUDE.md` reference becomes `../CLAUDE.md`; `mqtt2tb.js` reference points at `../deployment/shared/thingsboard/mqtt2tb.js`; MD1 references gain link to `../devices/md1/README.md`
- `docs/ThingsBoard Telegram Alerts.md` — `CLAUDE.md` becomes `../CLAUDE.md`; `mqtt2tb.js` reference updated to new path; auto-profile language removed; generalized to reference device-type sections

### Submodule path update

`.gitmodules` currently has:
```
[submodule "protobufs"]
    path = protobufs
    url = https://github.com/meshtastic/protobufs.git
```

Update to:
```
[submodule "protobufs"]
    path = firmware/protobufs
    url = https://github.com/meshtastic/protobufs.git
```

Then `git submodule sync` to apply.

### Build workflow change

PlatformIO looks for `platformio.ini` in the current working directory or at `--project-dir`. After the move:

```bash
pio run --project-dir firmware -e seeed_xiao_nrf52840_tav
pio run --project-dir firmware -e seeed_xiao_nrf52840_tav -t upload
```

`--project-dir` is the canonical command since it does not change the user's working directory.

### New files

- **`README.md`** (rewritten) — project landing page with a Products table linking to `devices/md1/README.md` and `devices/gateway/README.md`, a quick-start section showing the `pio run --project-dir firmware -e ...` command pattern, and links to `docs/`, `deployment/`, and `mobile/`.
- **`devices/md1/README.md`** — MD1 product document. Structure: product summary → target hardware → build command → User Requirement Specification (migrated from old URS file) → links.
- **`devices/gateway/README.md`** — Gateway product summary, RAK11200 hardware notes, build command, link to gateway section of `../../docs/Field Configuration Guide.md`.
- **`deployment/README.md`** — explains the `shared/` vs `customers/<id>/` structure and how to add a new customer.
- **`deployment/shared/thingsboard/README.md`** — what each subfolder is for (dashboards, rule-chains, device-profiles, images), how to export from ThingsBoard, how to import into a fresh tenant.
- **`deployment/customers/tav/README.md`** — the first customer record. Anchor file even if mostly empty initially.
- **`mobile/README.md`** — placeholder until Phase 4 scaffolds the codebase.

### CLAUDE.md updates

The "Project Structure" section is rewritten:

```markdown
## Project Structure

- `firmware/` — upstream Meshtastic tree + TAV modifications (src, variants, protobufs, platformio.ini)
- `devices/md1/` — MD1 Motion Detect Sensor product files (README, URS, device-specific docs)
- `devices/gateway/` — TAV LoRa→MQTT gateway product files (README, device-specific docs)
- `deployment/shared/` — cross-customer reusable artifacts (ThingsBoard dashboards, rule chains, device profiles, transforms)
- `deployment/customers/<id>/` — per-customer overrides and per-site install records
- `mobile/` — field-deployment mobile app (barcode scan, GPS-set-position, activation, commissioning test)
- `docs/` — solution-level prose docs (field config guide, alerts pattern, production roadmap)
- `tools/` — build scripts and ops helpers (future)
- `tests/` — solution-level integration/E2E tests (future; firmware unit tests stay under firmware/test/)

## Build

    pio run --project-dir firmware -e seeed_xiao_nrf52840_tav
    pio run --project-dir firmware -e seeed_xiao_nrf52840_tav -t upload
```

All existing CLAUDE.md references to paths like `src/modules/DetectionSensorModule.cpp` become `firmware/src/modules/DetectionSensorModule.cpp`; `docs/MD1 - User Requirement Specification.md` becomes `devices/md1/README.md`; `docs/mqtt2tb.js` becomes `deployment/shared/thingsboard/mqtt2tb.js`; `docs/ThingsBoard-Telegram-Alerts.md` becomes `docs/ThingsBoard Telegram Alerts.md`. The "Implementation Progress" section collapses to a single-line pointer at this roadmap.

### Verification

- `git log --follow firmware/src/modules/DetectionSensorModule.cpp` shows full history from the original `src/modules/DetectionSensorModule.cpp`
- `pio run --project-dir firmware -e seeed_xiao_nrf52840_tav` builds clean without any path changes inside `firmware/`
- `pio run --project-dir firmware -e rak11200` builds clean
- `git submodule status` shows `firmware/protobufs` at the expected commit
- Top-level README renders with working links to device READMEs, deployment, and docs
- No source file references to broken `../docs/` or similar paths
- Re-run the demo flow (shake MD1 → Telegram alert) on the post-restructure firmware build to confirm zero behavior change

### Risks and mitigations

- **Upstream merge conflicts**: every future upstream pull has to merge into `firmware/` instead of the repo root. Mitigation: document the workflow in CLAUDE.md; use `git merge -X subtree=firmware` or `git subtree pull` as needed.
- **Third-party tools expecting root-level `platformio.ini`**: IDE integrations auto-detect project root. Some may need their "project path" setting updated. Mitigation: document in the README.
- **CI/CD pipelines**: any CI commands need `--project-dir firmware`. Mitigation: update at the same time as the move.

---

## Phase 1 — Deep sleep + fast wake-on-motion

### Goal
The MD1 sleeps at ~0.3 µA when idle and wakes within ~10 s when the IMU detects motion. Combined with the fast-boot path, this hits the 5+ year CR123A target.

This is the **first firmware phase** because the demo'd PoC runs at full current draw — without deep sleep the product is not fieldable beyond demos, and no realistic battery-life testing can happen on subsequent phases. Every later phase (gateway upgrade, TB direct publish, mobile app) should be tested against a power-correct firmware so we are not chasing regressions through a moving baseline.

### Approach: SYSTEM_OFF + GPIO sense wake + motion-boot fast path

**Sleep mechanism** — `sd_power_system_off()` (lowest-power nRF52 sleep, ~0.3 µA) with `nrf_gpio_cfg_sense_set(IMU_INT1_PIN, NRF_GPIO_PIN_SENSE_HIGH)` to wake on IMU INT1. This is a reset-based wake — all RAM is lost, state must live in flash (LittleFS).

**Wake reason detection** — read `NRF_POWER->RESETREAS` early in `nrf52Setup()`. The `OFF` bit indicates SYSTEM_OFF wake (treat as motion); other bits indicate cold boot.

**Heartbeat** — SYSTEM_OFF has no RTC timer wake, so initial production has **no periodic heartbeat**. ThingsBoard "no message in N hours → alert" rule chain logic provides implicit heartbeat. If operations later requires periodic heartbeat, revisit with LPCOMP, external RTC, or hybrid LOWPWR periodic wake.

**Fast motion-boot path** — when `wokeFromMotion` is true, branch in `setup()` to a minimal init sequence: skip BLE, skip screen, skip non-essential modules, init LoRa + filesystem + local NodeDB, send the position, drain TX queue, return to SYSTEM_OFF.

### Firmware changes

#### `firmware/src/platform/nrf52/main-nrf52.cpp`

- Modify `cpuDeepSleep()` for `HAS_IMU_DETECTION` build: configure GPIO sense, call `sd_power_system_off()`. Keep existing LPCOMP path as fallback for non-MD1 builds.
- Clean up GPIO state (LEDs off, non-essential pins tri-stated) before system-off.
- In `nrf52Setup()`, read `NRF_POWER->RESETREAS` early; expose global `bool wokeFromMotion`.

#### `firmware/src/main.cpp` `setup()`

Add an early branch guarded by `HAS_IMU_DETECTION` and `wokeFromMotion`:

```cpp
if (wokeFromMotion) {
    fastMotionBoot();  // minimal init: FS, LoRa, NodeDB local node
    positionModule->sendOurPosition();
    waitForTxDrain();
    cpuDeepSleep(0);  // back to SYSTEM_OFF
}
```

Cold boot (power-on, no motion wake) still runs full setup so BLE comes up for commissioning by the Phase 4 mobile app.

#### New file: `firmware/src/platform/nrf52/fast_motion_boot.cpp`

Minimal init sequence. Reuses helpers from `RadioInterface::init()`, `NodeDB::loadFromDisk()`, etc., but selectively, not via the full module setup chain.

#### `firmware/src/modules/DetectionSensorModule.cpp`

After sending the position, schedule a return to deep sleep (after a short settle window for the radio TX queue to drain).

#### `firmware/src/motion/LSM6DS3Sensor.cpp`

Confirm the IMU's wake-up latch holds INT1 HIGH across SYSTEM_OFF. The IMU is on its own power domain so the latch should persist until the MCU boots and reads `WAKE_UP_SRC`.

### Budget allocation (10 s wake-to-TX target)

- 0.5 s — bootloader + C runtime init
- 0.5 s — filesystem mount
- 0.5 s — IMU init
- 2.0 s — LoRa radio init
- 0.5 s — NodeDB local-node load
- 0.2 s — build position packet
- 2.0 s — LoRa TX
- 1.0 s — TX queue drain
- 2.8 s — margin / safety

### Caveats

- MD1 cannot receive downlink while asleep. OK — production MD1 is one-way.
- If the gateway is out of range during fast-boot send, the position is lost. Acceptable for a theft alert.
- Watchdog must be short during fast boot so a hang during init still resets back to sleep.
- During this phase the gateway is still on stock 2.5.15 (Phase 2 has not run yet). Verify against the existing demo'd HiveMQ pipeline to keep regressions isolated.

### Verification

- PPK2 measurement: SYSTEM_OFF current <1 µA (MCU + IMU + SX1262 sleep)
- Motion → wake → TX complete in <10 s
- Cold boot still gets full init; BLE works (so the Phase 4 mobile app can connect later)
- Wake reason log shows "SYSTEM_OFF → motion wake" on every shake test
- Multi-cycle stress test: 100+ sleep/wake cycles without latch issues
- End-to-end demo flow (shake → Telegram alert) still works on the unchanged HiveMQ pipeline

---

## Phase 2 — Gateway firmware update

### Goal
Upgrade the gateway from stock Meshtastic 2.5.15 to our TAV fork head (2.7.22.xxx) **as a standalone version bump** with no behavior changes. The gateway still publishes to HiveMQ after this phase — the broker change happens in Phase 3. Splitting the upgrade from the broker change lets us isolate and diagnose any issues introduced by the new Meshtastic base.

The 2026-04-28 demo gives us a verified end-to-end behavior baseline. Phase 2 verification is "the demo flow still works exactly the same after the gateway upgrade".

### Process

1. Build the RAK11200 variant from this repo:
   ```bash
   pio run --project-dir firmware -e rak11200 -t upload
   ```
2. The existing `firmware/variants/esp32/rak11200/` is stock upstream — no TAV-specific changes yet.
3. Back up the current gateway config before upgrading:
   ```bash
   meshtastic --export-config > gateway-config-backup.yaml
   ```
4. Upload the new firmware via USB.
5. Restore config:
   ```bash
   meshtastic --configure gateway-config-backup.yaml
   ```
6. Verify the gateway still boots, LoRa works, and MQTT connects to **HiveMQ** (unchanged broker).
7. End-to-end smoke test: shake MD1 → position alert on phone via the existing HiveMQ → ThingsBoard → Telegram path. Must be identical to the 2026-04-28 demo, now with a Phase-1 power-correct MD1.

### Risks
- **Flash size**: the RAK11200 has limited flash. Newer firmware may push closer to the limit. Confirm the build fits before uploading.
- **Breaking changes 2.5.15 → 2.7.22**: scan upstream release notes for config-breaking changes (channel format, MQTT config field names).
- **Rollback plan**: keep the 2.5.15 firmware binary and the exported config so we can revert.
- **Channel rename quirk**: once both gateway and MD1 are on 2.7.22, the "renaming the primary channel breaks routing" workaround may no longer be needed. Confirm by testing a named primary channel — but stay on the default unnamed primary until the test passes.

### Verification
- `meshtastic --info` on the gateway shows 2.7.22.xxx
- MQTT to HiveMQ still works
- End-to-end MD1 → gateway → HiveMQ → ThingsBoard → Telegram identical to the 2026-04-28 demo
- Channel config intact, device role intact

Once verified, proceed to Phase 3.

---

## Phase 3 — Direct ThingsBoard publish (eliminates HiveMQ)

### Goal
The gateway publishes directly to ThingsBoard's MQTT Gateway API, eliminating HiveMQ Cloud entirely. Production deployments require no intermediate broker.

### ThingsBoard Gateway API recap

ThingsBoard's Gateway API: one authenticated MQTT client publishes telemetry on behalf of many "child" devices. The gateway's MQTT credentials are its own ThingsBoard device access token (as MQTT username, empty password).

Topics:
- `v1/gateway/telemetry` — child device telemetry
- `v1/gateway/attributes` — child device attributes
- `v1/gateway/connect` — declare a new child device (optional, auto-registered on first telemetry)

Payload format:
```json
{
  "<deviceName>": [
    { "ts": <unix-ms>, "values": { "latitude": -33.9, "longitude": 18.4, ... } }
  ]
}
```

`deviceName` is `"!<hex-node-id>"`, matching what `mqtt2tb.js` outputs today.

### What the gateway firmware needs to do

A **thin transform layer** that:
1. Takes the existing `MeshPacketSerializer::JsonSerialize()` output
2. Extracts the fields ThingsBoard cares about (flat key/value pairs)
3. Wraps them in the Gateway API envelope
4. Publishes to `v1/gateway/telemetry`

NOT a full C++ port of `mqtt2tb.js`. It is a small field-extraction function that handles the message types the MD1 actually sends:

- **position**: `latitude = latitude_i * 1e-7`, `longitude = longitude_i * 1e-7`, `altitude`, `channel`
- **telemetry/deviceMetrics**: `battery_level`, `voltage`, `uptime_seconds`, `air_util_tx`, `channel_utilization`
- **nodeinfo**: goes to attributes endpoint instead of telemetry — `long_name`, `short_name`, `hw_model`, `role`
- **Other types**: skipped or logged as unknown

The post-simplification `deployment/shared/thingsboard/mqtt2tb.js` (its post-Phase-0 location) is a useful reference for **the set of fields ThingsBoard cares about**.

### Firmware changes (gateway side)

#### `firmware/protobufs/meshtastic/module_config.proto` — `MQTTConfig`

Add a new enum field for publish flavor:

```protobuf
enum PublishFlavor {
  FLAVOR_MESHTASTIC = 0;  // Current behavior: tav/2/json/<channel>/<node>
  FLAVOR_THINGSBOARD_GATEWAY = 1;  // v1/gateway/telemetry with TB envelope
}
PublishFlavor publish_flavor = 20;
```

Requires the protobufs submodule fork (also used by Phase 5).

#### `firmware/src/mqtt/MQTT.cpp`

Extend `onSend()` with a branch for `FLAVOR_THINGSBOARD_GATEWAY`:

```cpp
if (moduleConfig.mqtt.publish_flavor == MQTTConfig_PublishFlavor_FLAVOR_THINGSBOARD_GATEWAY) {
    String tbPayload = buildThingsBoardGatewayPayload(mp);
    if (!tbPayload.isEmpty()) {
        pubSub.publish("v1/gateway/telemetry", tbPayload.c_str());
    }
    return;  // Skip the default msh/tav/2/json/... publish
}
// else: existing Meshtastic-format publish path
```

Helper `buildThingsBoardGatewayPayload()` lives in new files `firmware/src/mqtt/ThingsBoardGatewaySerializer.{cpp,h}`.

### Gateway config changes

```bash
meshtastic --set mqtt.enabled true
meshtastic --set mqtt.address mqtt.thingsboard.cloud    # or your TB cluster
meshtastic --set mqtt.username <TB_GATEWAY_DEVICE_ACCESS_TOKEN>
meshtastic --set mqtt.password ''
meshtastic --set mqtt.tls_enabled true
meshtastic --set mqtt.publish_flavor FLAVOR_THINGSBOARD_GATEWAY
meshtastic --set mqtt.json_enabled true                 # required for the serializer
```

### ThingsBoard provisioning

1. Create a **gateway device** in ThingsBoard, marked `is_gateway=true`, with an **access token** (used as `mqtt.username` on the gateway).
2. Existing `MD1` device profile stays. Child devices auto-created under the gateway land in the default profile — production approach is **manual profile assignment** after first packet, OR a root-rule-chain rule that re-profiles new devices based on first-seen `longName` attribute. Initial approach: manual; automate later if fleet size justifies it.

### `MD1 Rule Chain` migration

Continues to work unchanged — child device telemetry lands on the MD1 profile's default rule chain, telemetry keys match what the rule chain already filters on, Telegram branch is unchanged.

### HiveMQ decommissioning

Once Phase 3 is verified working in production:
1. Disable the HiveMQ integration in ThingsBoard
2. Keep it for a week as a rollback safety net
3. Delete the integration
4. Cancel the HiveMQ Cloud subscription
5. Update `deployment/shared/thingsboard/mqtt2tb.js` header comment to note it is historical (kept as transform spec)

### Verification

- Gateway with `publish_flavor = FLAVOR_THINGSBOARD_GATEWAY` connects to ThingsBoard MQTT
- Shake the MD1 → ThingsBoard Integration Events show a new Uplink (direct, no HiveMQ)
- MD1 shows up as a child device of the gateway in ThingsBoard's device tree
- Latest Telemetry on the MD1 device shows `latitude`, `longitude`, `altitude` with recent timestamps
- MD1 Rule Chain fires → Telegram alert arrives on phone
- **Side-by-side comparison against the 2026-04-28 demo baseline** — same lat/lon precision, same Telegram message, same map pin. Any divergence is a regression.
- Parallel running: keep HiveMQ integration enabled during initial testing to confirm both paths produce identical results, then disable HiveMQ.

---

## Phase 4 — Field-deployment mobile app

### Goal
Field installers commission a device on-site without a laptop. Minimum viable: scan device barcode → BLE-connect → set fixed position from phone GPS → activate device → optionally capture install photo → run a commissioning test that confirms the alert lands in ThingsBoard.

Factory-stage configuration (region, PSK, MQTT broker, channel, telemetry intervals, sensitivity preset) is pre-loaded via the existing meshtastic Python CLI before the device ships. The app does NOT need to re-do factory config.

### Two-stage deployment model

**Stage 1 — Factory (existing tooling, no new app):**

Use the meshtastic Python CLI with a per-product config profile:

```bash
meshtastic --configure factory-md1.yaml
```

Where `factory-md1.yaml` is checked in under `deployment/shared/factory-configs/md1.yaml` (or per-customer `deployment/customers/<id>/factory-configs/md1.yaml` when a customer needs different broker/PSK). Output is a "ready to ship" device with everything set except site-specific position and the activation flag.

**Stage 2 — Field (new mobile app):**

Installer flow:
1. Open app, scan barcode on the device label → app extracts device ID (Meshtastic node ID, hex)
2. App BLE-connects to the device using the scanned node ID
3. App reads phone GPS, prompts installer to confirm or adjust → writes fixed position via Meshtastic admin protobuf message
4. App writes activation flag (e.g. enables `detection_sensor.enabled`, sets a `site_active` user pref)
5. Optionally: installer takes a photo of the install location → uploaded as ThingsBoard server attribute on the device (or to an object store; see Open Questions)
6. Commissioning test: installer is prompted to shake the device. App polls ThingsBoard via REST API for the next motion event from this device. **Crucially this exercises the production wake-from-deep-sleep path delivered in Phase 1**, so a pass means the entire production flow works end-to-end. Pass = motion event arrives within ~15 s; fail = troubleshoot inline.
7. Save: app records device ID + lat/lon + photo + install timestamp + installer name to `deployment/customers/<id>/sites/<device-id>.json` (committed back via a server-side endpoint, or fetched by ops separately).

### Tech stack (recommended)

**Lightweight cross-platform** — React Native or Flutter. React Native has mature BLE support via `react-native-ble-plx`. The app surface is small enough that either choice is reasonable.

Why not native: doubles effort with no UX benefit at this scope.

Why not PWA: BLE Web API is iOS-unsupported and patchy on Android.

Why not fork Meshtastic mobile: the official apps are full-featured client/chat apps. Adding barcode + photo + commissioning-test would be invasive; building greenfield against just the BLE admin protocol is smaller.

### Codebase layout (`mobile/`)

```
mobile/
├── README.md
├── package.json (or pubspec.yaml)
├── src/
│   ├── ble/                     # BLE connection + Meshtastic admin protobuf
│   ├── screens/
│   │   ├── ScanScreen.tsx       # barcode scan
│   │   ├── ProvisionScreen.tsx  # GPS, photo, activate
│   │   └── TestScreen.tsx       # commissioning test, ThingsBoard poll
│   ├── thingsboard/             # REST client for commissioning verification
│   └── App.tsx
├── ios/
└── android/
```

### Backend touchpoints

- **Meshtastic admin protobuf over BLE** — small, well-defined surface. Just the messages needed to set fixed position, set detection_sensor.enabled, and write a couple of user attributes. Schema lives in the firmware `protobufs/` submodule.
- **ThingsBoard REST API** — for commissioning verification (poll latest telemetry on the device by node-ID lookup) and for photo upload (server attribute write). Auth via a short-lived installer user token, scoped to the customer.
- **Per-site install record sync** — TBD: either committed via a small backend, or written to ThingsBoard as a server attribute alongside the photo. Simplest V1: write to ThingsBoard server attributes; export to `deployment/customers/<id>/sites/` from ThingsBoard later.

### URS coverage

- FR-PR-01..04 (provisioning) — addressed
- AC-08-style commissioning test — addressed inline by the app
- Reduces field-tech requirements (no laptop, no CLI knowledge)

### Verification

- App builds and runs on iOS + Android (one developer device each)
- Barcode scan extracts node ID correctly from a printed Code128 / QR sticker
- App BLE-connects to a stock MD1 (post-Phase-1 firmware build, **including** the cold-boot path that keeps BLE alive for commissioning)
- Position write: `meshtastic --info` over USB shows the lat/lon set by the app
- Activation: detection sensor is enabled after the app's "Activate" button
- Commissioning test: installer shakes device → wake-from-deep-sleep → position lands in ThingsBoard → app polls and shows ✅ within 15 s
- Install photo: round-trips into ThingsBoard server attribute, viewable on the dashboard

### Risks and open issues

See "Open questions" at the bottom — tech stack pick, photo upload destination, app distribution mechanism, and barcode format are open.

---

## Phase 5 — Proper `imu_sensitivity` proto field (deferred to last)

### Goal
Remove the `state_broadcast_secs` repurposing. Introduce a dedicated `uint32 imu_sensitivity` field on `meshtastic.ModuleConfig.DetectionSensorConfig` so:

- The meshtastic CLI shows a meaningful field name
- Heartbeat feature via `state_broadcast_secs` is restored for any future GPIO use
- Upgrading existing devices does not silently change behavior

This is **deferred to last** — the current `state_broadcast_secs` repurposing works in production. The proto change is hygiene, not a functional gap.

### Fork the protobufs submodule

The Phase 3 protobufs fork (TAV-owned, branch `tav-md1`) is reused. This phase adds one more commit on the same branch.

### Proto change

In `firmware/protobufs/meshtastic/module_config.proto` inside `DetectionSensorConfig` (after `use_pullup`):

```protobuf
/*
 * IMU wake-up threshold for MD1-style motion detection (0-100, lower = more
 * sensitive). 0 = use firmware default. Only applies when monitor_pin points
 * at an IMU interrupt pin and the firmware supports HAS_IMU_DETECTION.
 * Mapped linearly onto the LSM6DS3TR-C 6-bit wake-up register (1-63).
 */
uint32 imu_sensitivity = 9;
```

### Regenerate nanopb headers

The `.pb.h` and `.pb.cpp` files under `firmware/src/mesh/generated/meshtastic/` are nanopb-generated. Re-run the generator on the updated submodule, commit the changes.

### Firmware change

In `firmware/src/modules/DetectionSensorModule.cpp` firstTime block:

- Read `moduleConfig.detection_sensor.imu_sensitivity` instead of `state_broadcast_secs`
- Restore the `state_broadcast_secs` heartbeat block (unconditional, matches upstream semantics)
- Keep the `MD1_IMU_DEFAULT_THRESHOLD` define and the 0-100 → 1-63 mapping logic

### Documentation updates

- `CLAUDE.md` known-quirks — remove the "state_broadcast_secs is repurposed" entry
- `docs/Field Configuration Guide.md` — change the config command to `detection_sensor.imu_sensitivity`
- `devices/md1/README.md` — update if it references the proto field name

### Verification

- `pio run --project-dir firmware -e seeed_xiao_nrf52840_tav` builds clean
- `meshtastic --set detection_sensor.imu_sensitivity 50` is accepted
- Device boots, log shows `IMU sensitivity=50/100 -> threshold=32`
- Motion detection works at the new threshold

---

## Files Modified Summary

| File | Phase | Change |
|---|---|---|
| (move upstream files into `firmware/`) | 0 | See Phase 0 git mv list |
| `.gitmodules` | 0, 3, 5 | Update `protobufs` path to `firmware/protobufs`; point at TAV fork |
| `README.md` | 0 | Rewrite for new layout, add Products table |
| `CLAUDE.md` | 0 | Update Project Structure + Build sections; collapse Implementation Progress; fix mqtt2tb.js auto-profile claim |
| `devices/md1/README.md` (NEW) | 0 | MD1 product overview + URS content merged in |
| `docs/MD1 - User Requirement Specification.md` (deleted) | 0 | Content merged into `devices/md1/README.md` |
| `devices/gateway/README.md` (NEW) | 0 | Gateway product overview |
| `docs/Field Configuration Guide.md` | 0, 3, 5 | Stays at top level; internal link updates in Phase 0; content updates per downstream phases |
| `docs/ThingsBoard Telegram Alerts.md` (renamed from `ThingsBoard-Telegram-Alerts.md`) | 0, 3 | Rename; remove auto-profile language; generalize per-device pattern; update for direct-TB path in Phase 3 |
| `deployment/README.md` (NEW) | 0 | shared/ vs customers/<id>/ structure |
| `deployment/shared/thingsboard/README.md` (NEW) | 0 | Subfolder purposes, export/import procedure |
| `deployment/shared/thingsboard/mqtt2tb.js` (moved from `docs/mqtt2tb.js`) | 0, 3 | Move; add historical header in Phase 3 once HiveMQ retires |
| `deployment/customers/tav/README.md` (NEW) | 0 | First customer record |
| `mobile/README.md` (NEW) | 0 | Placeholder until Phase 4 scaffolds the codebase |
| `mobile/` codebase (NEW) | 4 | Scan + BLE + GPS + activate + photo + commissioning test |
| `deployment/shared/factory-configs/md1.yaml` (NEW) | 4 | Factory-stage Meshtastic CLI config profile |
| `firmware/protobufs/meshtastic/module_config.proto` | 3, 5 | Add `publish_flavor` to MQTTConfig (Phase 3); add `imu_sensitivity` to DetectionSensorConfig (Phase 5) |
| `firmware/src/mesh/generated/meshtastic/module_config.pb.h` | 3, 5 | Regenerate nanopb headers |
| `firmware/src/mesh/generated/meshtastic/module_config.pb.cpp` | 3, 5 | Regenerate nanopb sources |
| `firmware/src/mqtt/MQTT.cpp` | 3 | Dispatch to ThingsBoard publish path when flavor = FLAVOR_THINGSBOARD_GATEWAY |
| `firmware/src/mqtt/MQTT.h` | 3 | Forward decls |
| `firmware/src/mqtt/ThingsBoardGatewaySerializer.cpp` (NEW) | 3 | Field extraction + TB envelope builder |
| `firmware/src/mqtt/ThingsBoardGatewaySerializer.h` (NEW) | 3 | Header |
| `firmware/src/modules/DetectionSensorModule.cpp` | 1, 5 | Trigger deep sleep after send, fast-boot send path (Phase 1); use `imu_sensitivity` (Phase 5) |
| `firmware/src/platform/nrf52/main-nrf52.cpp` | 1 | SYSTEM_OFF + GPIO sense wake, wake reason detection, fast-motion-boot dispatch |
| `firmware/src/main.cpp` | 1 | Early `wokeFromMotion` branch |
| `firmware/src/platform/nrf52/fast_motion_boot.cpp` (NEW) | 1 | Minimal init sequence |
| `devices/md1/README.md` | 1, 5 | URS section updates: battery life with SYSTEM_OFF current, sensitivity field name |
| `firmware/variants/esp32/rak11200/` | 2 | No content change — covered by the version upgrade itself |

---

## Dependencies and sequencing

```
Phase 0 (restructure)             — prerequisite for everything; path changes land once
Phase 1 (deep sleep + fast wake)  — depends on Phase 0; first firmware phase to make the device fieldable
Phase 2 (gateway update)          — depends on Phase 0; independent of Phase 1; pure version bump
Phase 3 (TB direct publish)       — depends on Phase 2 (2.7.22 baseline) + protobufs fork
Phase 4 (mobile deployment app)   — depends on Phase 3 (production publish path) + Phase 1 (production wake path)
Phase 5 (imu_sensitivity proto)   — depends on protobufs fork from Phase 3; deferred to last
```

Recommended order: **0 → 1 → 2 → 3 → 4 → 5**.

- Phase 0 first so every subsequent phase lands files in the new layout
- Phase 1 next so the MD1 firmware is power-correct before any later validation work — without it, no realistic battery-life testing and no commissioning test for Phase 4 against the production wake path
- Phase 2 is a standalone gateway version bump — verify HiveMQ still works on the new firmware against the demo baseline before touching the publish path
- Phase 3 changes the publish path on the already-upgraded gateway. Smaller blast radius: if something breaks, we know it is the TB change and not the version upgrade
- Phase 4 builds against now-production firmware (Phase 1) and now-production publish path (Phase 3), so the commissioning test actually exercises the full production flow
- Phase 5 last — protobuf-only change, hygiene over function

If parallel work is wanted, Phase 1 (deep sleep, MD1-firmware track) and Phase 2 (gateway upgrade, gateway-firmware track) are independent and can run on separate developer benches. Phase 4 (mobile app) is its own track and only converges with the firmware tracks at integration testing.

---

## Verification Matrix

| Phase | Hardware test | Backend test |
|---|---|---|
| 0 | `pio run --project-dir firmware -e seeed_xiao_nrf52840_tav` builds; `rak11200` builds; demo flow still produces a Telegram alert | `git log --follow` on moved files shows full history; CLAUDE.md and `ThingsBoard Telegram Alerts.md` no longer mention auto-profile |
| 1 | PPK2: sleep <1 µA; shake-to-TX-complete <10 s; cold boot still works for commissioning | End-to-end demo flow (HiveMQ pipeline) still produces a Telegram alert with the deep-sleep firmware |
| 2 | `meshtastic --info` on gateway shows 2.7.22.xxx; LoRa mesh still works | End-to-end MD1 → HiveMQ → ThingsBoard → Telegram identical to 2026-04-28 demo, now with Phase-1 power-correct MD1 |
| 3 | Gateway connects to ThingsBoard MQTT with access token; no HiveMQ traffic | MD1 shows up as child device; Telegram alerts fire identically to demo baseline; HiveMQ integration can be disabled |
| 4 | App scans barcode, BLE-connects, sets fixed position from GPS, activates device, captures install photo | Commissioning test: motion → wake-from-deep-sleep → ThingsBoard latest-telemetry update visible to the app within 15 s |
| 5 | `meshtastic --set detection_sensor.imu_sensitivity N`; log shows new field | N/A |

---

## Out of scope

- **OTA updates** for the MD1 — requires separate infrastructure
- **Per-device remote re-configuration** of thresholds after deployment
- **Multi-sensor fusion** (gyro-based orientation detection)
- **Full ops console** (alarm acknowledge, arm/disarm) — Phase 4 app stops at commissioning
- **Migration to `firmware/` as a submodule** — subdirectory only for the foreseeable future
- **IP67 enclosure / mechanical hardening** (URS NF-EN-01) — tracked outside this firmware roadmap
- **72-hour static false-alarm acceptance test** (URS AC-08) — runs on the post-Phase-1 production firmware as a deployment-readiness gate, not as part of the firmware roadmap itself

---

## Open questions

These don't block plan approval but should be settled before the relevant phase starts.

1. **Phase 0 sequencing**: ship the doc-drift fix (auto-profile correction in CLAUDE.md and `ThingsBoard Telegram Alerts.md`) as a precursor commit ahead of the bigger restructure, or bundle it into Phase 0? **Resolved**: shipped as precursor.
2. **Phase 1 heartbeat policy**: confirm the SYSTEM_OFF-only approach (no periodic heartbeat) is acceptable for V1 production, or do operations want a minimum-cadence heartbeat now (which means LPCOMP/external-RTC complexity)?
3. **Phase 4 tech stack**: confirm React Native (recommended), or pick Flutter / native iOS+Android instead?
4. **Phase 4 photo upload destination**: ThingsBoard device server attribute (simplest), or an object store (S3/MinIO) with the URL written to ThingsBoard (scales better for many photos)?
5. **Phase 4 app distribution**: TestFlight / Play Internal Testing, MDM enterprise distribution, or sideloaded?
6. **Phase 4 barcode format**: QR (recommended — encodes the full hex node ID), or Code128, or both?
7. **Customer ID convention**: `tav` (lowercase) for our own internal testing customer, or a different scheme (e.g. `internal`, `tavnetworks`)? Affects the first `deployment/customers/<id>/` folder name.
