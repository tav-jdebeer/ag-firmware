# TAV Networks - AG Firmware

Meshtastic firmware fork for TAV Networks IoT devices, starting with the MD1 Motion Detect Sensor.

## Project Structure

- `variants/nrf52840/seeed_xiao_nrf52840_tav/` - TAV MD1 variant (Seeed XIAO nRF52840 Sense + Wio-SX1262)
- `src/motion/LSM6DS3Sensor.cpp` - Extended with `initForDetection()` for autonomous motion detection
- `src/modules/DetectionSensorModule.cpp` - Extended with IMU mode (`HAS_IMU_DETECTION`)
- `src/main.cpp` - Added `SKIP_WIRE1_SCAN` guard to prevent I2C scan hang
- `docs/MD1 - User Requirement Specification.md` - Product URS
- `docs/mqtt2tb.js` - ThingsBoard TBEL uplink converter for the HiveMQ MQTT integration
- `docs/ThingsBoard-Telegram-Alerts.md` - Per-profile rule chain setup for Telegram notifications on motion events

## Build

```bash
pio run -e seeed_xiao_nrf52840_tav
pio run -e seeed_xiao_nrf52840_tav -t upload
```

## MD1 Hardware

- MCU: Seeed XIAO nRF52840 Sense (nRF52840 + BLE + LSM6DS3TR-C 6-axis IMU)
- LoRa: Wio-SX1262 for XIAO (Semtech SX1262)
- Battery: Primary lithium (CR123A/AA), target 5+ year life (production goal)
- No GPS - fixed position at commissioning
- No screen

## MD1 Variant Key Decisions

- **Wire0** (NFC pins D30/D31): unused on MD1 but left as-is to keep Meshtastic I2C scan safe
- **Wire1** (D16/D17): LSM6DS3TR-C IMU, accessed via `IMU_WIRE` define
- **SKIP_WIRE1_SCAN**: prevents Meshtastic from scanning Wire1 at boot (IMU unpowered at that point)
- **IMU power**: uses high-drive GPIO on P1.08 (Seeed BSP `beginCore()` pattern), powered on inside `initForDetection()`
- **GPS**: undefined (`#undef HAS_GPS`), not removed from codebase - future variants can re-enable
- **Screen**: excluded via `MESHTASTIC_EXCLUDE_SCREEN=1`

## Proof of Concept Behavior

The current PoC firmware does **one thing**: when the IMU detects motion, it transmits a single Position packet containing the device's fixed position. No heartbeat, no deep sleep, no text messages.

- Boot → IMU init waits for the high-pass slope filter to settle (~1 sec) before arming
- Motion detected → ONE Position packet sent (the position IS the alert)
- Cooldown (`minimum_broadcast_secs`) blocks repeat sends within the window
- Motion **during** cooldown is silently dropped (latch is cleared) — only motion **after** cooldown fires the next alert
- RED LED flash on each detection for visual confirmation

## Meshtastic Configuration (PoC)

After flashing, configure via Meshtastic CLI. Order matters: leave the primary channel unnamed (see "Channel Configuration Quirk" below), set GPS off and fixed position BEFORE doing anything else.

```bash
# Device role - CLIENT for PoC (TRACKER + power_saving wipes fixed position on reboot)
meshtastic --set device.role CLIENT

# Disable power saving (no deep sleep in PoC)
meshtastic --set power.is_power_saving false

# Primary channel: leave unnamed (default), set a shared PSK matching the gateway.
# DO NOT rename the primary channel — this breaks mesh routing when MD1 and
# gateway are on mixed firmware versions. See "Channel Configuration Quirk".
# If you need a named channel for human text messaging, add it as a secondary:
#   meshtastic --ch-add "TAV-OPS"
#   meshtastic --ch-set psk <base64-key> --ch-index 1

# Allow MQTT forwarding — sets the ok_to_mqtt bit on outgoing packets so
# any gateway that sees them is permitted to publish them to MQTT. Without
# this, the gateway drops MD1 packets at the MQTT-publish step even though
# mesh routing works. This is a NODE-wide client-side setting (separate from
# the gateway's own uplink_enabled channel flag).
meshtastic --set lora.config_ok_to_mqtt true

# Enable precise (full 32-bit) location on channel 0. Default on some
# channels is a reduced precision that rounds lat/lon for privacy on
# public channels — for MD1 motion alerts we want the exact coordinates.
# Must match the gateway's positionPrecision on the same channel.
meshtastic --ch-set module_settings.position_precision 32 --ch-index 0

# GPS disabled (no GNSS hardware on MD1)
meshtastic --set position.gps_mode DISABLED

# Fixed position
meshtastic --setlat XX.XXX --setlon YY.YYY --setalt ZZZ
meshtastic --set position.fixed_position true

# Disable scheduled position broadcasts (we only send on motion)
meshtastic --set position.position_broadcast_secs 0

# Disable scheduled telemetry broadcasts (noise without value for PoC)
meshtastic --set telemetry.device_update_interval 0

# Detection sensor — IMU mode is enabled by setting monitor_pin to IMU_INT1_PIN (18)
meshtastic --set detection_sensor.enabled true
meshtastic --set detection_sensor.monitor_pin 18
meshtastic --set detection_sensor.detection_trigger_type LOGIC_HIGH
meshtastic --set detection_sensor.minimum_broadcast_secs 30
meshtastic --set detection_sensor.send_bell false
meshtastic --set detection_sensor.name "MD1"

# IMU motion-detection sensitivity (1-100, lower = more sensitive, 0 = default).
# In IMU mode, state_broadcast_secs is repurposed as the sensitivity value.
# Mapped linearly onto the LSM6DS3TR-C 6-bit register (1-63).
# Examples: 5 = very sensitive (~95mg), 16 = default (~310mg), 50 = moderate (~1g), 100 = least sensitive (~2g)
meshtastic --set detection_sensor.state_broadcast_secs 16
```

## Implementation Progress

### Completed (PoC end-to-end verified on hardware)

**Firmware**
- TAV variant created and customized (IMU pins, Wire1, GPS disabled, feature flags)
- `LSM6DS3Sensor::initForDetection()` configures IMU for autonomous wake detection with latched INT1
- `DetectionSensorModule` IMU mode: motion → single Position packet, cooldown handling, high-pass filter settling wait
- Motion during cooldown is silently dropped (latch is cleared, no stale alerts)

**Backend integration**
- Gateway (RAK11200) is bridging MD1 mesh traffic to HiveMQ Cloud via TLS MQTT
- ThingsBoard Cloud PE HiveMQ integration subscribes `tav/2/json/+/#` and auto-creates devices
- [docs/mqtt2tb.js](docs/mqtt2tb.js) TBEL uplink converter parses Meshtastic JSON, extracts position/telemetry/nodeinfo, and maps `TAV-MD1-*` nodes to the `MD1` device profile on creation
- Dedicated `MD1 Rule Chain` assigned to the `MD1` profile handles MD1-specific behavior
- Telegram notification on each motion event: text message with clickable Google Maps link + inline location pin (see [docs/ThingsBoard-Telegram-Alerts.md](docs/ThingsBoard-Telegram-Alerts.md))

**Verification path**: shake MD1 → RED LED flash → LoRa transmit → gateway receives → HiveMQ publish → ThingsBoard ingest → device position updates → MD1 Rule Chain fires → Telegram message arrives on phone with tappable map pin. All links tested and working.

### Future Work (deferred to production)

- **Deep sleep**: re-add as a clean module-level concern (separate from DetectionSensorModule). 5+ year battery life on CR123A is the goal.
- **Heartbeat**: implement as a periodic Telemetry packet (DeviceMetrics with battery + uptime), not as a text message
- ~~**Configurable IMU sensitivity threshold**~~: done — repurposed `state_broadcast_secs` as sensitivity (1-100) in IMU mode. A dedicated `imu_sensitivity` proto field should replace this for production.
- **Reduce wake-to-send latency**: when deep sleep is added, the cold-boot path takes 20-30s. Investigate ways to send the alert earlier in boot.
- **Remove debug LED + INT1 polling log** for production
- **Battery alerts / offline detection** in `MD1 Rule Chain` once telemetry heartbeat is in place
- **Bot token out of rule chain config** — store as a ThingsBoard server attribute and reference via `$[...]` placeholder
- **Multi-MD1 testing** — auto-provisioning via converter `deviceType` has been designed but only tested with one MD1 so far

## Known Quirks / Gotchas

- **GPS must be `DISABLED`** (`position.gps_mode 0`) — otherwise the GPS module overwrites the fixed position with zeros on boot.
- **TRACKER role + `power.is_power_saving=true` wipes the fixed position on every boot** ([PositionModule.cpp:46-51](src/modules/PositionModule.cpp#L46-L51)). For fixed-position sensors, use CLIENT role or keep power_saving off.
- **`detection_trigger_type` must be `LOGIC_HIGH`** (not `RISING_EDGE`) for proper re-triggering with latched interrupts.
- **IMU high-pass filter takes ~1 sec to settle** after init. The init code polls INT1 until it stays LOW for 500ms before considering the sensor armed (5-second overall timeout as a safety net).
- **The detection text message and position broadcast are separate mesh packets** (different ports). The PoC only sends Position; the Position protobuf has no free-form text field.
- **`detection_sensor.state_broadcast_secs` is repurposed as IMU sensitivity in IMU mode.** In GPIO mode it retains its upstream "state heartbeat interval" meaning. In IMU mode, setting it to e.g. 50 means "sensitivity 50/100", not "broadcast every 50 seconds". The heartbeat block in `runOnce()` is gated out for IMU mode. For production heartbeat, use `telemetry.device_update_interval` instead. A dedicated `imu_sensitivity` proto field should replace this repurposing long-term.
- **`SoftDevice` SVCalls fault if called after BLE has been disabled.** During the Phase 5 deep sleep work we found that `sd_power_gpregret_set()` (and even direct `NRF_POWER->GPREGRET2 =` writes) cause a hardfault when called from inside `cpuDeepSleep()` after `setBluetoothEnable(false)` has run. `.noinit` RAM was used as an alternative persistence mechanism. This code has been removed from the PoC but the lesson remains relevant for the production deep-sleep work.

## Channel Configuration Quirk (gateway compatibility)

When testing with a gateway running an older Meshtastic firmware (e.g. 2.5.15) and the MD1 running newer firmware (e.g. 2.7.22), **renaming the primary channel breaks mesh communication** on both the primary and any secondary channels. The exact mechanism is unclear (possibly related to channel hash computation differences across firmware versions, or a new field in the LoRa config protobuf), but the symptom is that as soon as a name is set on channel index 0, no messages flow in either direction.

**Workaround**: leave the primary channel unnamed (default) and put your application traffic on a named secondary channel:
- **Primary (index 0)**: empty name, default PSK (1-byte short-form). Both ends will use the modem-preset display name (e.g. "LongFast") for hashing and decode each other's traffic.
- **Secondary (index 1+)**: named (e.g. "TAV-OPS") with a custom PSK. Use this for human text messaging and any segregated traffic.

The MD1's `DetectionSensorModule` sends Position packets on **channel index 0** (primary), so position alerts go out on the unnamed primary and are picked up by any gateway that shares the same default primary channel + LoRa region + modem preset.

If/when both ends are upgraded to compatible firmware versions, naming the primary should work — until then, leave it default.

## Verification

End-to-end test that the PoC works:
1. Configure the MD1 per the **Meshtastic Configuration (PoC)** section above.
2. Configure a gateway with the same default primary channel (no name change) and same LoRa region/modem preset.
3. Connect a Meshtastic mobile or web app to the gateway.
4. Find `TAV-MD1-xxxx` in the gateway's node list — it should already show the configured fixed position.
5. Shake the MD1.
6. Within ~5-10 seconds the gateway's view of the MD1 should refresh with an updated "last heard" timestamp; the position pin should be at the configured lat/lon.
7. Repeat (after the cooldown window) — the position should update again.
8. Shake during the cooldown — no update should occur (motion is silently dropped).

## End-to-End Pipeline (PoC deployment)

```
MD1 motion
  → IMU INT1 latched high
  → DetectionSensorModule polling sees HIGH
  → positionModule->sendOurPosition()
  → LoRa SX1262 transmission (unnamed primary channel)
  → Gateway (RAK11200) receives on primary
  → MQTT publish to HiveMQ Cloud (TLS)
     topic: tav/2/json/<preset-name>/!<hex-node-id>
  → ThingsBoard Cloud HiveMQ integration subscribes tav/2/json/+/#
  → docs/mqtt2tb.js uplink converter parses JSON
     - sets deviceType=MD1 for TAV-MD1-* longNames (auto-profile assignment)
     - extracts latitude/longitude/altitude as telemetry
  → Device !<hex-node-id> (in MD1 profile) receives telemetry update
  → MD1 Rule Chain (default chain for MD1 profile) runs
     - filter: msg has lat+lon
     - branch 1: format text + POST to Telegram sendMessage
     - branch 2: format location + POST to Telegram sendLocation
     - forward original msg to Root Rule Chain (saves timeseries)
  → Telegram chat receives:
     - 🚨 Movement detected + clickable Google Maps link
     - Inline location pin (tap to open native map app)
```

## Gateway (TAV-GW01) MQTT / ThingsBoard setup

- **Broker**: HiveMQ Cloud (`ae11ebd8a9244098ac2541b35e571096.s1.eu.hivemq.cloud:8883`, TLS)
- **Credentials**: `tav-mesh` / (stored on gateway — set with single-quoted shell string to avoid `$` expansion)
- **Gateway config**:
  ```bash
  meshtastic --set mqtt.enabled true
  meshtastic --set mqtt.address ae11ebd8a9244098ac2541b35e571096.s1.eu.hivemq.cloud
  meshtastic --set mqtt.username tav-mesh
  meshtastic --set mqtt.password '<password>'   # must be single-quoted in shell
  meshtastic --set mqtt.tls_enabled true
  meshtastic --set mqtt.json_enabled true
  meshtastic --set mqtt.root tav
  ```
- **Primary channel** (index 0) has `uplink_enabled=true` and `downlink_enabled=true` so packets are bridged to MQTT.
- **If `MQTT not connected, queue packet` appears in the log**: the gateway lost the broker connection. Reboot it (`meshtastic --reboot`). The password field is the most common culprit — shell interpretation of `$`/`#`/`*` characters during `--set` can mangle it. Always single-quote the password string.

## ThingsBoard Cloud integration

- **Integration type**: HiveMQ (MQTT subscriber)
- **Topic filter**: `tav/2/json/+/#` (wildcard on channel name so it survives channel renames)
  - **Do NOT hard-code a channel name** like `tav/2/json/TAV-OPS/#`. The MD1 sends on the default unnamed primary, which Meshtastic maps to the modem preset display name (e.g. `LongFast`). A wildcard catches any channel.
- **Uplink converter**: [docs/mqtt2tb.js](docs/mqtt2tb.js) (TBEL). Parses Meshtastic JSON packets, extracts position / telemetry / nodeinfo / text. Outputs:
  - `deviceName = "!" + hex(from)` (e.g. `!d36d787`)
  - `deviceType = 'MD1'` when the packet is a `nodeinfo` with `longName` starting `TAV-MD1` — drives auto-profile assignment on device creation
  - `deviceType = 'Gateway'` for `TAV-GW`-prefixed nodes
  - Falls back to `meshtastic-node` for unknown nodes
- **Device profiles**:
  - `MD1` profile with **Default rule chain** set to `MD1 Rule Chain` — all MD1 telemetry goes through the dedicated chain
  - `meshtastic-node` profile uses the root rule chain (default)
- **Device auto-create**: enable "Allow create devices or assets" on the integration so unknown nodes get provisioned automatically on first packet and land in the correct profile.
- **MD1 Rule Chain**: dedicated chain handling MD1-specific behavior. Currently:
  - Filters on `msg.latitude != null && msg.longitude != null`
  - Two parallel branches → Telegram sendMessage + sendLocation
  - Forward node that passes every message back to Root Rule Chain so timeseries are saved normally
  - See [docs/ThingsBoard-Telegram-Alerts.md](docs/ThingsBoard-Telegram-Alerts.md) for full setup
- **Debugging**: use the integration's **Events** tab (Uplink / Debug) to see raw messages, converter output, and errors. Use debug mode on individual rule chain nodes to trace message flow.
