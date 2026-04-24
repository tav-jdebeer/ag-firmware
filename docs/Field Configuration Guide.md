# TAV Field Configuration Guide

Step-by-step configuration for the MD1 Motion Detect Sensor and its gateway. Use this guide when commissioning a fresh device or reconfiguring an existing one in the field.

## Scope

This guide covers the current **Proof of Concept** configuration:

- **MD1**: battery/USB powered, fixed position, sends a single Position packet on motion
- **Gateway**: forwards mesh traffic to HiveMQ Cloud → ThingsBoard → Telegram

Production-only features (deep sleep, heartbeat telemetry, OTA updates) are out of scope for this version of the guide.

## Prerequisites

- The Meshtastic Python CLI installed on your laptop:
  ```bash
  pip install meshtastic
  ```
- A USB-C data cable (power-only cables will not work)
- Firmware already flashed on both devices:
  - **MD1**: `firmware-seeed_xiao_nrf52840_tav-<version>.uf2` built from this repo
  - **Gateway**: stock Meshtastic firmware for a RAK11200 / similar ESP32 gateway board
- HiveMQ Cloud credentials for the shared broker
- ThingsBoard Cloud project with:
  - HiveMQ MQTT integration subscribed to `tav/2/json/+/#`
  - [docs/mqtt2tb.js](mqtt2tb.js) uplink converter installed
  - `MD1` device profile with `MD1 Rule Chain` as its default rule chain
  - Telegram bot token + chat ID for alerts (see [docs/ThingsBoard-Telegram-Alerts.md](ThingsBoard-Telegram-Alerts.md))

## Reference values

Replace these placeholders with your real values throughout the guide:

| Placeholder | Example | Notes |
| --- | --- | --- |
| `<lat>` | `-33.9` | Device latitude in decimal degrees |
| `<lon>` | `18.4` | Device longitude in decimal degrees |
| `<alt>` | `10` | Device altitude in meters |
| `<region>` | `US` | LoRa region — see "LoRa region codes" below |
| `<psk>` | `base64:ZmYyR0h5N3RWSTJxNjZZUXBZZzlEOUFabWdHQ3pYZFc=` | Primary-channel PSK (must match between all devices) |
| `<broker-host>` | `ae11ebd8...s1.eu.hivemq.cloud` | HiveMQ Cloud cluster hostname |
| `<mqtt-user>` | `tav-mesh` | HiveMQ user |
| `<mqtt-password>` | `...` | HiveMQ password — must be single-quoted in shell (see gotcha below) |

### LoRa region codes

Use the code for your deployment location:

| Code | Region |
| --- | --- |
| `US` | United States (902-928 MHz) |
| `EU_868` | Europe (863-870 MHz) |
| `EU_433` | Europe (433 MHz) |
| `ANZ` | Australia / New Zealand (915-928 MHz) |
| `CN` | China (470-510 MHz) |
| `JP` | Japan (920-923 MHz) |
| `KR` | Korea (920-923 MHz) |
| `TW` | Taiwan (920-925 MHz) |
| `RU` | Russia (868.7-869.2 MHz) |
| `IN` | India (865-867 MHz) |
| `TH` | Thailand (920-925 MHz) |
| `UA_433` / `UA_868` | Ukraine |
| `MY_433` / `MY_919` | Malaysia |
| `SG_923` | Singapore |

---

# Part 1 — MD1 client configuration

Attach the MD1 to your laptop via USB. The Meshtastic CLI auto-detects the port. If you have multiple serial devices connected, add `--port COMn` (Windows) or `--port /dev/ttyACMn` (Linux/Mac) to each command.

## 1.1 — Core device

```bash
meshtastic --set device.role CLIENT
meshtastic --set power.is_power_saving false
```

**Why CLIENT?** The `TRACKER` role combined with `power.is_power_saving = true` wipes the fixed position on every boot, which breaks our "position is the alert" design. CLIENT avoids this and also skips automatic position broadcasts.

## 1.2 — LoRa radio and MQTT opt-in

```bash
meshtastic --set lora.region <region>
meshtastic --set lora.config_ok_to_mqtt true
```

**Why `config_ok_to_mqtt`?** This node-wide flag sets the `ok_to_mqtt` bit on outgoing packets, permitting any gateway that receives them to publish them to MQTT. Without it, the gateway drops the MD1's packets at the MQTT-publish step even though mesh routing works.

## 1.3 — Primary channel

```bash
meshtastic --ch-set psk '<psk>' --ch-index 0
meshtastic --ch-set module_settings.position_precision 32 --ch-index 0
```

**Why NOT rename the primary channel?** Naming the primary channel (e.g. to "TAV-OPS") breaks mesh routing when the MD1 and gateway are on slightly different firmware versions. Leave the primary unnamed and keep the default modem preset display name.

**Why `position_precision = 32`?** By default some channels ship with a reduced precision that rounds lat/lon to protect privacy on public channels. For motion alerts we want the exact coordinates, so set the MD1's outgoing-precision to 32 bits on channel 0. The gateway must have the same value on its own channel 0 (see Part 2).

If you need a named channel for text messaging (not required for the MD1 alert flow), add it as a **secondary**:

```bash
meshtastic --ch-add "TAV-OPS"
meshtastic --ch-set psk '<psk>' --ch-index 1
```

## 1.4 — Fixed position

⚠️ **Set position BEFORE enabling power saving or rebooting** — on some configurations the position can get wiped by the first boot cycle if it's not persisted yet.

```bash
meshtastic --set position.gps_mode DISABLED
meshtastic --setlat <lat> --setlon <lon> --setalt <alt>
meshtastic --set position.fixed_position true
```

**Why `gps_mode DISABLED`?** There is no GNSS hardware on the MD1. If GPS is left enabled, the GPS module overwrites the fixed position with zeros on boot as it waits for a fix that never arrives.

## 1.5 — Disable scheduled broadcasts

```bash
meshtastic --set position.position_broadcast_secs 0
meshtastic --set telemetry.device_update_interval 0
```

The MD1 only sends position on motion — no timed position or telemetry broadcasts.

## 1.6 — Detection sensor (IMU mode)

```bash
meshtastic --set detection_sensor.enabled true
meshtastic --set detection_sensor.monitor_pin 18
meshtastic --set detection_sensor.detection_trigger_type LOGIC_HIGH
meshtastic --set detection_sensor.minimum_broadcast_secs 30
meshtastic --set detection_sensor.send_bell false
meshtastic --set detection_sensor.name "MD1"
```

**Field notes:**
- `monitor_pin = 18` (`IMU_INT1_PIN`) enables IMU mode. Any other pin reverts to upstream GPIO-polling mode.
- `LOGIC_HIGH` is required — `RISING_EDGE` does not re-trigger reliably with latched interrupts.
- `minimum_broadcast_secs = 30` is the cooldown between alerts. Motion during the cooldown is silently dropped (the latch is cleared) so only a new event after the cooldown expires fires another alert.
- `send_bell = false` — the bell character is not used because we send Position packets, not text.
- `name` appears in mesh debug logs but the position alert itself does not include this string (see URS).

## 1.7 — IMU sensitivity

```bash
meshtastic --set detection_sensor.state_broadcast_secs <sensitivity>
```

**The `state_broadcast_secs` field is repurposed in IMU mode** as a motion-detection sensitivity value (1-100, lower = more sensitive). Its upstream "state heartbeat interval" meaning is only used in GPIO mode and is disabled in IMU mode.

Mapping 1-100 onto the LSM6DS3TR-C 6-bit wake-threshold register (1-63):

| Sensitivity | Approx. threshold | Use case |
| --- | --- | --- |
| `0` | default (≈ 310 mg) | Use firmware default |
| `5` | ≈ 95 mg | Very sensitive — light taps trigger |
| `16` | ≈ 310 mg | General-purpose default |
| `25` | ≈ 475 mg | Moderate — firm tap |
| `50` | ≈ 1 g | Low — requires a deliberate shake |
| `100` | ≈ 2 g | Minimum — only strong movements trigger |

## 1.8 — Reboot and verify

```bash
meshtastic --reboot
```

Wait ~15 seconds, then:

```bash
meshtastic --info
```

Expected highlights:

- `role: CLIENT`
- `lora.region: <region>`
- `lora.config_ok_to_mqtt: True`
- `position.fixed_position: True`
- `position.gps_mode: 0` (DISABLED)
- `detection_sensor.enabled: True`
- `detection_sensor.monitor_pin: 18`
- The primary channel shows your PSK and the configured `position_precision`

At this point the serial log (if you attach a monitor) should show:

```
Detection Sensor Module: IMU sensitivity=<n>/100 -> threshold=<n>
Detection Sensor Module: IMU mode, INT1 on pin 18, settled in ~1000ms
```

Shake the device — a position packet is sent on the mesh. After the 30 s cooldown you can trigger again.

---

# Part 2 — Gateway configuration

The gateway is a stock Meshtastic device (e.g. RAK11200) with MQTT bridging enabled. Attach it to your laptop via USB.

## 2.1 — Core device

```bash
meshtastic --set device.role ROUTER
meshtastic --set lora.region <region>
```

`ROUTER` role is appropriate for a fixed gateway that rebroadcasts packets and bridges MQTT. Region must match the MD1.

## 2.2 — Primary channel (must match the MD1)

```bash
meshtastic --ch-set psk '<psk>' --ch-index 0
meshtastic --ch-set module_settings.position_precision 32 --ch-index 0
meshtastic --ch-set uplink_enabled true --ch-index 0
meshtastic --ch-set downlink_enabled true --ch-index 0
```

**Why `uplink_enabled` / `downlink_enabled` on the gateway?** These are channel-level flags that tell the gateway "bridge packets on this channel to/from MQTT". This is the gateway side of the MQTT pipeline; the client side is the `config_ok_to_mqtt` flag set in Part 1.

## 2.3 — MQTT broker

```bash
meshtastic --set mqtt.enabled true
meshtastic --set mqtt.address <broker-host>
meshtastic --set mqtt.username <mqtt-user>
meshtastic --set mqtt.password '<mqtt-password>'
meshtastic --set mqtt.tls_enabled true
meshtastic --set mqtt.json_enabled true
meshtastic --set mqtt.root tav
```

⚠️ **Password gotcha**: shells may interpret `$`, `#`, `*` and other characters in the password. **Always single-quote the password string** in Bash or PowerShell, otherwise the password is silently mangled and the gateway fails to authenticate.

**Why `json_enabled true`?** The gateway publishes packets as human-readable JSON on topics like `tav/2/json/<channel>/!<node>`. ThingsBoard's uplink converter parses this JSON directly. If you disable JSON the gateway only publishes protobuf-encoded packets on `tav/2/e/...` which the converter cannot parse.

## 2.4 — Reboot and verify

```bash
meshtastic --reboot
```

Wait ~15 seconds, then:

```bash
meshtastic --info
```

Look for:

- `role: ROUTER`
- `lora.region` matches the MD1
- `mqtt.enabled: True`
- `mqtt.tls_enabled: True`
- `mqtt.json_enabled: True`
- Primary channel `uplinkEnabled: true` and `downlinkEnabled: true`

If you can attach a serial monitor, look for:

```
MQTT Connected
```

or similar. If you instead see:

```
MQTT not connected, queue packet
MQTT queue is full, discard oldest
```

…the gateway could not connect to the broker. Most common causes:

1. **Password mangled by shell** — re-run the password command with single quotes
2. **Wrong broker hostname** — verify against the HiveMQ Cloud console
3. **WiFi/Ethernet not up** — check `network.wifi_ssid` / `network.wifi_psk`
4. **TLS certs missing** — some gateway firmware builds exclude TLS; re-flash with a TLS-enabled build

---

# Part 3 — Backend sanity check

Once the MD1 and gateway are configured, verify the full end-to-end path before deploying:

1. **Shake the MD1.** You should see a brief RED LED flash (detection indicator) if the firmware has the debug LEDs enabled.
2. **Check the gateway's MQTT output.** From any machine with `mosquitto_sub`:
   ```bash
   mosquitto_sub -h <broker-host> -p 8883 -u <mqtt-user> -P '<mqtt-password>' \
     --capath /etc/ssl/certs/ -t 'tav/2/json/#' -v
   ```
   Within ~10 seconds of the shake you should see a JSON message on topic `tav/2/json/<preset>/!<md1-node-id>` containing `"type":"position"` and the configured lat/lon.
3. **Check the ThingsBoard integration.** In ThingsBoard: **Integrations → [HiveMQ integration] → Events → Uplink**. New events should appear on each shake. Click one to see the raw payload and converter output.
4. **Check the MD1 device in ThingsBoard.** **Entities → Devices → `!<hex-node-id>` → Latest Telemetry**. `latitude`, `longitude`, `altitude`, `channel` should show the latest values with a recent timestamp.
5. **Check Telegram.** The `MD1 Rule Chain` should fire a `🚨 Movement detected` text message plus an inline location pin in your configured chat within ~1 second of the position arriving at ThingsBoard.

If any step fails, troubleshoot at that step before moving on.

---

# Part 4 — Factory reset and recovery

## Wipe the MD1 config without reflashing firmware

```bash
meshtastic --factory-reset
```

This resets all config (role, channels, position, detection sensor, LoRa region, MQTT settings) back to Meshtastic defaults while leaving the firmware intact. Re-run Part 1 to reconfigure.

## Reflash firmware via USB

1. Double-tap the reset button on the MD1 within ~500 ms. The device enters the UF2 bootloader and appears as a USB drive (e.g. `XIAO-SENSE`).
2. Drag `firmware-seeed_xiao_nrf52840_tav-<version>.uf2` onto the drive.
3. The device reboots automatically with the new firmware. Config is preserved across firmware updates.

## Full erase (last resort)

If the LittleFS filesystem is corrupted and `--factory-reset` does not help, see the SoftDevice / LittleFS recovery notes in [CLAUDE.md](../CLAUDE.md#known-quirks--gotchas). Full-chip erase requires a J-Link programmer and re-flashing the Adafruit bootloader.

---

# Appendix A — Config reference card

Condensed one-page reference you can print and take to the field.

## MD1

```bash
meshtastic --set device.role CLIENT
meshtastic --set power.is_power_saving false
meshtastic --set lora.region <region>
meshtastic --set lora.config_ok_to_mqtt true
meshtastic --ch-set psk '<psk>' --ch-index 0
meshtastic --ch-set module_settings.position_precision 32 --ch-index 0
meshtastic --set position.gps_mode DISABLED
meshtastic --setlat <lat> --setlon <lon> --setalt <alt>
meshtastic --set position.fixed_position true
meshtastic --set position.position_broadcast_secs 0
meshtastic --set telemetry.device_update_interval 0
meshtastic --set detection_sensor.enabled true
meshtastic --set detection_sensor.monitor_pin 18
meshtastic --set detection_sensor.detection_trigger_type LOGIC_HIGH
meshtastic --set detection_sensor.minimum_broadcast_secs 30
meshtastic --set detection_sensor.send_bell false
meshtastic --set detection_sensor.name "MD1"
meshtastic --set detection_sensor.state_broadcast_secs 16
meshtastic --reboot
```

## Gateway

```bash
meshtastic --set device.role ROUTER
meshtastic --set lora.region <region>
meshtastic --ch-set psk '<psk>' --ch-index 0
meshtastic --ch-set module_settings.position_precision 32 --ch-index 0
meshtastic --ch-set uplink_enabled true --ch-index 0
meshtastic --ch-set downlink_enabled true --ch-index 0
meshtastic --set mqtt.enabled true
meshtastic --set mqtt.address <broker-host>
meshtastic --set mqtt.username <mqtt-user>
meshtastic --set mqtt.password '<mqtt-password>'
meshtastic --set mqtt.tls_enabled true
meshtastic --set mqtt.json_enabled true
meshtastic --set mqtt.root tav
meshtastic --reboot
```

---

# Related documents

- [CLAUDE.md](../CLAUDE.md) — project context, known quirks, implementation progress
- [docs/MD1 - User Requirement Specification.md](MD1%20-%20User%20Requirement%20Specification.md) — product URS
- [docs/mqtt2tb.js](mqtt2tb.js) — ThingsBoard uplink converter
- [docs/ThingsBoard-Telegram-Alerts.md](ThingsBoard-Telegram-Alerts.md) — Telegram alerts setup
