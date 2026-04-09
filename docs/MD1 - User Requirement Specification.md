# MD1 Motion Detect Sensor — User Requirement Specification

| Field        | Value                                      |
| ------------ | ------------------------------------------ |
| Document     | URS-MD1                                    |
| Product      | MD1 Motion Detect Sensor                   |
| Version      | 0.1 (Draft)                                |
| Date         | 2026-04-08                                 |
| Author       | TAV Networks                               |
| Status       | Draft                                      |

---

## 1  Purpose

The MD1 is a battery-powered edge IoT device designed to detect unauthorised movement of normally static infrastructure assets — such as pull-box covers, cable enclosure doors, or buried cable runs — and to alert operators in near-real-time so that theft or tampering can be investigated before significant loss occurs.

## 2  Scope

This specification covers the functional and non-functional requirements for the MD1 sensor node only. The gateway, MQTT broker, backend (ThingsBoard), and end-user alerting application are out of scope but are referenced where the MD1 interfaces with them.

## 3  System Overview

```
┌──────────┐    LoRa Mesh     ┌──────────┐     MQTT      ┌────────────┐
│   MD1    │ ──────────────▶  │ Gateway  │ ───────────▶  │ ThingsBoard│ ──▶ Alert
│ (Sensor) │   Meshtastic     │          │               │  Backend   │
└──────────┘                  └──────────┘               └────────────┘
```

1. The MD1 is attached to the asset and commissioned (position recorded, sensitivity profile selected).
2. The device enters deep sleep.
3. On motion exceeding the configured threshold, the IMU generates a hardware interrupt that wakes the MCU.
4. The MD1 transmits a **motion-detected event** and its **stored position** over the Meshtastic LoRa mesh.
5. A gateway node bridges the message via MQTT to the ThingsBoard backend.
6. The backend evaluates the event and, if warranted, sends an alert to the end user.
7. The MD1 returns to deep sleep after a configurable cooldown period.

## 4  Hardware Platform

| Component       | Selection                                                    |
| --------------- | ------------------------------------------------------------ |
| MCU + BLE + IMU | Seeed XIAO nRF52840 Sense (nRF52840, BLE 5.0, LSM6DS3TR-C) |
| LoRa transceiver| Wio-SX1262 for XIAO (Semtech SX1262)                        |
| Battery         | Primary lithium cell (CR123A or AA-size lithium)             |
| Enclosure       | IP67 or higher rated, outdoor-suitable housing               |
| GPS             | None — position is fixed at commissioning                    |

## 5  Functional Requirements

### 5.1  Motion Detection

| ID       | Requirement                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| FR-MD-01 | The device SHALL use the on-board LSM6DS3TR-C 6-axis IMU to detect motion via hardware interrupt.            |
| FR-MD-02 | The device SHALL support multiple sensitivity profiles, each defining acceleration threshold and duration parameters appropriate to the mounting context. At minimum the following profiles SHALL be provided: **Cable**, **Door**, **Pull Box**. |
| FR-MD-03 | The active sensitivity profile SHALL be selectable during commissioning.                                      |
| FR-MD-04 | The device SHALL reject transient vibrations (e.g. passing traffic, wind) that fall below the active profile's threshold to minimise false alarms. |

### 5.2  Alert and Position Reporting

| ID       | Requirement                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| FR-AR-01 | On motion detection the device SHALL transmit a **motion-detected event message** containing at minimum: device ID, event timestamp, and sensitivity profile that triggered. |
| FR-AR-02 | On motion detection the device SHALL transmit the **stored fixed position** (latitude, longitude, altitude) alongside or immediately after the event message. |
| FR-AR-03 | After transmitting the alert and position the device SHALL return to deep sleep.                              |
| FR-AR-04 | A configurable **cooldown period** SHALL prevent repeated alerts for sustained disturbance. During cooldown the device remains in deep sleep and does not re-trigger. Default: 60 seconds. |

### 5.3  Heartbeat / Health Reporting

| ID       | Requirement                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| FR-HB-01 | The device SHALL periodically wake from deep sleep to transmit a **heartbeat message** confirming it is operational and in place. |
| FR-HB-02 | The heartbeat interval SHALL be configurable in the range of **1 hour to 24 hours**. Default: 24 hours.      |
| FR-HB-03 | The heartbeat message SHALL include at minimum: device ID, battery voltage, battery level (%), and uptime.   |

### 5.4  Communication

| ID       | Requirement                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| FR-CO-01 | The device SHALL communicate over the **Meshtastic LoRa mesh** network using the SX1262 transceiver.        |
| FR-CO-02 | The device SHALL operate in the Meshtastic **SENSOR** device role.                                           |
| FR-CO-03 | The device SHALL support mesh relay — messages may traverse intermediate nodes to reach the gateway.          |
| FR-CO-04 | The device SHALL use Meshtastic encryption for all mesh traffic.                                              |

### 5.5  Commissioning and Provisioning

| ID       | Requirement                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| FR-PR-01 | The device SHALL support provisioning via **BLE** using the Meshtastic mobile application (primary method, field use). |
| FR-PR-02 | The device SHALL support provisioning via **USB** as a fallback for factory or bench configuration.          |
| FR-PR-03 | During commissioning the operator SHALL be able to configure: fixed position (lat/lon/alt), sensitivity profile, heartbeat interval, mesh/channel settings, and device name. |
| FR-PR-04 | After commissioning is complete the device SHALL enter deep sleep and begin normal operation.                 |

### 5.6  Power Management

| ID       | Requirement                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| FR-PM-01 | The default state of the device SHALL be **deep sleep** with minimal current draw.                           |
| FR-PM-02 | Wake from deep sleep SHALL be triggered by: (a) IMU motion interrupt, or (b) heartbeat timer expiry.         |
| FR-PM-03 | The device SHALL power down the LoRa radio and BLE between transmissions.                                    |
| FR-PM-04 | The device SHALL monitor battery voltage and include it in heartbeat and alert messages.                     |
| FR-PM-05 | The device SHALL transmit a **low-battery warning** when battery voltage drops below a configurable threshold.|

## 6  Non-Functional Requirements

### 6.1  Battery Life

| ID       | Requirement                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| NF-BL-01 | The device SHALL achieve a minimum operational life of **5 years** under the following reference duty cycle: heartbeat every 24 hours, ≤ 1 motion event per day. |
| NF-BL-02 | Deep-sleep current consumption SHALL NOT exceed **10 µA** (MCU + IMU, excluding battery self-discharge).     |

### 6.2  Environmental

| ID       | Requirement                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| NF-EN-01 | The device in its enclosure SHALL meet **IP67** ingress protection (dust-tight, temporary immersion to 1 m). |
| NF-EN-02 | The device SHALL operate over an ambient temperature range of **−20 °C to +60 °C**.                          |
| NF-EN-03 | The device SHALL withstand outdoor UV exposure without degradation of the enclosure over the operational life.|

### 6.3  Communication Range

| ID       | Requirement                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| NF-CR-01 | The device SHALL achieve a minimum direct communication range of **2 km** in a suburban environment with the gateway at a reasonable antenna height. |
| NF-CR-02 | Effective range beyond 2 km SHALL be achievable via Meshtastic mesh relay through intermediate nodes.        |

### 6.4  Reliability

| ID       | Requirement                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| NF-RE-01 | The device SHALL survive a power-on reset or watchdog reset and resume normal operation without manual intervention. |
| NF-RE-02 | Motion alert messages SHALL be retried via Meshtastic's built-in reliable delivery mechanism.                |

### 6.5  Physical

| ID       | Requirement                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| NF-PH-01 | The device and enclosure SHALL be compact enough to attach to a pull-box cover, enclosure door, or to be buried alongside cable. Target maximum volume: to be determined during mechanical design. |
| NF-PH-02 | The device SHALL include a mounting method suitable for attachment to metal and plastic surfaces (e.g. adhesive, cable tie, or mechanical fastener). |

## 7  Regulatory

| ID       | Requirement                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| RG-01    | The device SHALL rely on the **pre-existing regulatory certifications** of the Seeed XIAO nRF52840 and Wio-SX1262 modules (FCC, IC, CE as applicable). |
| RG-02    | The device design SHALL not modify the certified RF modules in ways that would void their certifications.    |

## 8  Firmware Requirements

| ID       | Requirement                                                                                                  |
| -------- | ------------------------------------------------------------------------------------------------------------ |
| FW-01    | The firmware SHALL be based on the **Meshtastic firmware** (ag-firmware fork).                                |
| FW-02    | The firmware SHALL use the existing `LSM6DS3Sensor` driver in `src/motion/` for IMU integration.             |
| FW-03    | The firmware SHALL use the `DetectionSensorModule` or a derivative for motion event messaging.                |
| FW-04    | The firmware SHALL support over-the-air (OTA) updates via BLE where supported by the Meshtastic platform.    |
| FW-05    | The firmware SHALL be buildable as a variant of the existing `seeed_xiao_nrf52840_kit` platform target.      |

## 9  Interfaces

| Interface         | Protocol / Format        | Direction     | Description                                    |
| ----------------- | ------------------------ | ------------- | ---------------------------------------------- |
| MD1 → Mesh        | Meshtastic LoRa          | Outbound      | Motion events, position reports, heartbeats    |
| Mesh → Gateway    | Meshtastic LoRa          | Relay         | Standard mesh forwarding                       |
| Gateway → Backend | MQTT (ServiceEnvelope)   | Outbound      | Encrypted mesh packets bridged to MQTT broker  |
| Operator → MD1    | BLE (Meshtastic app)     | Bidirectional | Commissioning, configuration, firmware update  |
| Operator → MD1    | USB Serial               | Bidirectional | Factory provisioning, diagnostics, FW flash    |

## 10  Acceptance Criteria

| ID    | Criterion                                                                                               |
| ----- | ------------------------------------------------------------------------------------------------------- |
| AC-01 | Device wakes from deep sleep within **1 second** of motion exceeding the configured threshold.          |
| AC-02 | Motion event and position are received at the gateway within **10 seconds** of detection.               |
| AC-03 | Device returns to deep sleep within **30 seconds** of completing transmission.                          |
| AC-04 | Deep-sleep current measured at ≤ 10 µA (MCU + IMU).                                                    |
| AC-05 | Heartbeat messages are received at the configured interval ± 5 %.                                      |
| AC-06 | Device survives 1 m water immersion for 30 minutes (IP67 verification).                                |
| AC-07 | Commissioning via BLE successfully sets position, sensitivity profile, and heartbeat interval.          |
| AC-08 | No false motion alerts over a 72-hour static test in an outdoor environment with normal ambient vibration.|
| AC-09 | Communication verified at 2 km range in a suburban test environment.                                    |

## 11  Definitions and Abbreviations

| Term          | Definition                                                              |
| ------------- | ----------------------------------------------------------------------- |
| BLE           | Bluetooth Low Energy                                                    |
| IMU           | Inertial Measurement Unit                                               |
| IP67          | Ingress Protection: dust-tight, temporary immersion to 1 m depth        |
| LoRa          | Long Range (low-power wide-area modulation technique)                   |
| MCU           | Microcontroller Unit                                                    |
| MQTT          | Message Queuing Telemetry Transport                                     |
| OTA           | Over-the-Air (firmware update)                                          |
| SX1262        | Semtech LoRa transceiver IC                                            |
| URS           | User Requirement Specification                                          |

---

*End of document.*
