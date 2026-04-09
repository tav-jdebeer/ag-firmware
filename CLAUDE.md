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
- Battery: Primary lithium (CR123A/AA), target 5+ year life
- No GPS - fixed position at commissioning
- No screen

## MD1 Variant Key Decisions

- **Wire0** (NFC pins D30/D31): unused on MD1 but left as-is to keep Meshtastic I2C scan safe
- **Wire1** (D16/D17): LSM6DS3TR-C IMU, accessed via `IMU_WIRE` define
- **SKIP_WIRE1_SCAN**: prevents Meshtastic from scanning Wire1 at boot (IMU unpowered at that point)
- **IMU power**: uses high-drive GPIO on P1.08 (Seeed BSP `beginCore()` pattern), powered on inside `initForDetection()`
- **GPS**: undefined (`#undef HAS_GPS`), not removed from codebase - future variants can re-enable
- **Screen**: excluded via `MESHTASTIC_EXCLUDE_SCREEN=1`

## Meshtastic Configuration (MD1)

After flashing, configure via Meshtastic app or CLI:

```bash
# Device role
meshtastic --set device.role SENSOR

# Detection sensor
meshtastic --set detection_sensor.enabled true
meshtastic --set detection_sensor.monitor_pin 18
meshtastic --set detection_sensor.detection_trigger_type LOGIC_HIGH
meshtastic --set detection_sensor.minimum_broadcast_secs 60
meshtastic --set detection_sensor.state_broadcast_secs 3600
meshtastic --set detection_sensor.name "MD1"
meshtastic --set detection_sensor.send_bell true

# Fixed position (set during commissioning)
meshtastic --setlat XX.XXX --setlon YY.YYY --setalt ZZZ
meshtastic --set position.fixed_position true

# Power saving (for sleep mode - Phase 5)
meshtastic --set power.is_power_saving true
meshtastic --set power.sds_secs 3600
```

## Implementation Progress

### Completed
- **Phase 1**: TAV variant created (clone of seeed_xiao_nrf52840_kit)
- **Phase 2**: Variant customized (IMU pins, Wire1, GPS disabled, feature flags)
- **Phase 3**: `LSM6DS3Sensor::initForDetection()` implemented with Adafruit API + latch mode
- **Phase 4**: `DetectionSensorModule` extended for IMU mode, position broadcast on detection, verified on hardware

### Pending
- **Phase 5**: Sleep with IMU interrupt wake (chunked delay with INT1 interrupt in `cpuDeepSleep()`)
- **Phase 6**: Power optimization (`variant_shutdown()`, disable `AccelerometerThread`)
- **Phase 7**: Configurable sensitivity threshold via protobuf field (`imu_sensitivity`)

## Known Issues / Notes

- IMU wake threshold is currently hardcoded to 5 (~155mg) for testing. Will be made configurable in Phase 7.
- Debug LED indicators: BLUE 2s = IMU init OK, RED flash = motion detected. Remove for production.
- Debug logging (INT1 state every 5s) should be removed for production.
- `detection_trigger_type` must be `LOGIC_HIGH` (not `RISING_EDGE`) for proper re-triggering with latched interrupts.
