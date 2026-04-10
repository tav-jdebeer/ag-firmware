# TAV Networks - AG Firmware

Meshtastic firmware fork for TAV Networks IoT devices, starting with the MD1 Motion Detect Sensor.

## Project Structure

- `variants/nrf52840/seeed_xiao_nrf52840_tav/` - TAV MD1 variant (Seeed XIAO nRF52840 Sense + Wio-SX1262)
- `src/motion/LSM6DS3Sensor.cpp` - Extended with `initForDetection()` for autonomous motion detection
- `src/modules/DetectionSensorModule.cpp` - Extended with IMU mode (`HAS_IMU_DETECTION`)
- `src/main.cpp` - Added `SKIP_WIRE1_SCAN` guard to prevent I2C scan hang
- `docs/MD1 - User Requirement Specification.md` - Product URS

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

After flashing, configure via Meshtastic CLI. Order matters: set GPS off and fixed position BEFORE leaving CLIENT role config.

```bash
# Device role - CLIENT for PoC (TRACKER + power_saving wipes fixed position on reboot)
meshtastic --set device.role CLIENT

# Channel (must not be default public channel)
meshtastic --ch-set name "TAV-OPS" --ch-index 0

# Disable power saving (no deep sleep in PoC)
meshtastic --set power.is_power_saving false

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
meshtastic --set detection_sensor.state_broadcast_secs 0
meshtastic --set detection_sensor.send_bell false
meshtastic --set detection_sensor.name "MD1"
```

## Implementation Progress

### Completed (PoC working on hardware)
- TAV variant created and customized (IMU pins, Wire1, GPS disabled, feature flags)
- `LSM6DS3Sensor::initForDetection()` configures IMU for autonomous wake detection with latched INT1
- `DetectionSensorModule` IMU mode: motion → single Position packet, cooldown handling, settling wait

### Future Work (deferred to production)
- **Deep sleep**: re-add as a clean module-level concern (separate from DetectionSensorModule). 5+ year battery life on CR123A is the goal.
- **Heartbeat**: implement as a periodic Telemetry packet (DeviceMetrics with battery + uptime), not as a text message
- **Configurable IMU sensitivity threshold**: add `imu_sensitivity` proto field (currently hardcoded to 10 ≈ 310mg)
- **Reduce wake-to-send latency**: when deep sleep is added, the cold-boot path takes 20-30s. Investigate ways to send the alert earlier in boot.
- **Remove debug LED + INT1 polling log** for production

## Known Quirks / Gotchas

- **GPS must be `DISABLED`** (`position.gps_mode 0`) — otherwise the GPS module overwrites the fixed position with zeros on boot.
- **TRACKER role + `power.is_power_saving=true` wipes the fixed position on every boot** ([PositionModule.cpp:46-51](src/modules/PositionModule.cpp#L46-L51)). For fixed-position sensors, use CLIENT role or keep power_saving off.
- **`detection_trigger_type` must be `LOGIC_HIGH`** (not `RISING_EDGE`) for proper re-triggering with latched interrupts.
- **IMU high-pass filter takes ~1 sec to settle** after init. The init code polls INT1 until it stays LOW for 500ms before considering the sensor armed (5-second overall timeout as a safety net).
- **The detection text message and position broadcast are separate mesh packets** (different ports). The PoC only sends Position; the Position protobuf has no free-form text field.
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
