// ThingsBoard MQTT Integration — Uplink Data Converter (TBEL)
// Parses Meshtastic JSON packets from tav/2/json/{channel}/{nodeId}
//
// Maps incoming packets onto ThingsBoard devices keyed by the Meshtastic
// hex node ID (e.g. "!d36d787"). Nodes whose longName matches a TAV prefix
// are auto-assigned to a dedicated device profile on creation:
//   TAV-MD1-*  -> 'MD1'       (handled by the MD1 Rule Chain)
//   TAV-GW-*   -> 'Gateway'
//   other      -> 'meshtastic-node'
//
// NOTE: ThingsBoard only uses deviceType at device-creation time. Existing
// devices do not get re-profiled automatically — reassign manually if needed.
//
// To install: ThingsBoard -> Data Converters -> Add -> Uplink -> Paste this script

var data = decodeToJson(payload);

// Parse topic: tav/2/json/{channel}/{nodeId}
var topic = metadata['topic'];
var channel = 'unknown';
var topicNodeId = 'unknown';
if (topic != null) {
    var topicParts = topic.split('/');
    if (topicParts.length > 3) {
        channel = topicParts[3];
    }
    if (topicParts.length > 4) {
        topicNodeId = topicParts[4];
    }
}

// "from" is the originating node (decimal int), "sender" is always the gateway
// Convert "from" to hex node ID format: 142323128 -> "!087badb8"
var deviceName = topicNodeId;
if (data.from != null) {
    deviceName = "!" + Long.toHexString(data.from);
}

// Default device type / profile. Nodeinfo packets carry the longName which
// lets us map TAV-branded nodes onto their specific device profiles.
// Note: ThingsBoard only uses deviceType at device-creation time. It does not
// re-profile existing devices based on subsequent converter output, so
// previously-created devices still need a manual profile change.
var deviceType = 'meshtastic-node';
if (data.type == 'nodeinfo' && data.payload != null && data.payload.longName != null) {
    var longName = data.payload.longName;
    if (longName.indexOf('TAV-MD1') === 0) {
        deviceType = 'MD1';
    } else if (longName.indexOf('TAV-GW') === 0) {
        deviceType = 'Gateway';
    }
}

var telemetry = {};
telemetry.channel = channel;
if (data.hop_start != null) {
    telemetry.hop_start = data.hop_start;
}
if (data.hops_away != null) {
    telemetry.hops_away = data.hops_away;
}

var attributes = {};

if (data.type == 'text') {
    telemetry.message = data.payload.text;
}

if (data.type == 'position') {
    if (data.payload.latitude_i != null) {
        telemetry.latitude = data.payload.latitude_i * 0.0000001;
    }
    if (data.payload.longitude_i != null) {
        telemetry.longitude = data.payload.longitude_i * 0.0000001;
    }
    if (data.payload.altitude != null) {
        telemetry.altitude = data.payload.altitude;
    }
    if (data.payload.ground_speed != null) {
        telemetry.ground_speed = data.payload.ground_speed;
    }
    if (data.payload.ground_track != null) {
        telemetry.ground_track = data.payload.ground_track / 100.0;
    }
    if (data.payload.sats_in_view != null) {
        telemetry.sats_in_view = data.payload.sats_in_view;
    }
    if (data.payload.PDOP != null) {
        telemetry.pdop = data.payload.PDOP / 100.0;
    }
    if (data.payload.HDOP != null) {
        telemetry.hdop = data.payload.HDOP / 100.0;
    }
}

if (data.type == 'nodeinfo') {
    if (data.payload.longName != null) {
        attributes.long_name = data.payload.longName;
    }
    if (data.payload.shortName != null) {
        attributes.short_name = data.payload.shortName;
    }
    if (data.payload.hwModel != null) {
        attributes.hw_model = data.payload.hwModel;
    }
    if (data.payload.role != null) {
        attributes.role = data.payload.role;
    }
}

if (data.type == 'telemetry' && data.payload.deviceMetrics != null) {
    var dm = data.payload.deviceMetrics;
    if (dm.batteryLevel != null) {
        telemetry.battery_level = dm.batteryLevel;
    }
    if (dm.voltage != null) {
        telemetry.voltage = dm.voltage;
    }
    if (dm.channelUtilization != null) {
        telemetry.channel_utilization = dm.channelUtilization;
    }
    if (dm.airUtilTx != null) {
        telemetry.air_util_tx = dm.airUtilTx;
    }
    if (dm.uptimeSeconds != null) {
        telemetry.uptime_seconds = dm.uptimeSeconds;
    }
}

if (data.type == 'telemetry' && data.payload.environmentMetrics != null) {
    var em = data.payload.environmentMetrics;
    if (em.temperature != null) {
        telemetry.temperature = em.temperature;
    }
    if (em.relativeHumidity != null) {
        telemetry.humidity = em.relativeHumidity;
    }
    if (em.barometricPressure != null) {
        telemetry.pressure = em.barometricPressure;
    }
    if (em.gasResistance != null) {
        telemetry.gas_resistance = em.gasResistance;
    }
    if (em.lux != null) {
        telemetry.lux = em.lux;
    }
    if (em.windSpeed != null) {
        telemetry.wind_speed = em.windSpeed;
    }
    if (em.windDirection != null) {
        telemetry.wind_direction = em.windDirection;
    }
    if (em.soilMoisture != null) {
        telemetry.soil_moisture = em.soilMoisture;
    }
    if (em.soilTemperature != null) {
        telemetry.soil_temperature = em.soilTemperature;
    }
}

if (data.type == 'telemetry' && data.payload.powerMetrics != null) {
    var pm = data.payload.powerMetrics;
    if (pm.ch1Voltage != null) { telemetry.power_ch1_voltage = pm.ch1Voltage; }
    if (pm.ch1Current != null) { telemetry.power_ch1_current = pm.ch1Current; }
    if (pm.ch2Voltage != null) { telemetry.power_ch2_voltage = pm.ch2Voltage; }
    if (pm.ch2Current != null) { telemetry.power_ch2_current = pm.ch2Current; }
    if (pm.ch3Voltage != null) { telemetry.power_ch3_voltage = pm.ch3Voltage; }
    if (pm.ch3Current != null) { telemetry.power_ch3_current = pm.ch3Current; }
}

if (data.type == 'telemetry' && data.payload.airQualityMetrics != null) {
    var aq = data.payload.airQualityMetrics;
    if (aq.pm10Standard != null) { telemetry.pm1_0 = aq.pm10Standard; }
    if (aq.pm25Standard != null) { telemetry.pm2_5 = aq.pm25Standard; }
    if (aq.pm100Standard != null) { telemetry.pm10 = aq.pm100Standard; }
    if (aq.co2 != null) { telemetry.co2 = aq.co2; }
}

if (data.type == 'telemetry' && data.payload.localStats != null) {
    var ls = data.payload.localStats;
    if (ls.numPacketsTx != null) { telemetry.packets_tx = ls.numPacketsTx; }
    if (ls.numPacketsRx != null) { telemetry.packets_rx = ls.numPacketsRx; }
    if (ls.numPacketsRxBad != null) { telemetry.packets_rx_bad = ls.numPacketsRxBad; }
    if (ls.numOnlineNodes != null) { telemetry.online_nodes = ls.numOnlineNodes; }
    if (ls.numTotalNodes != null) { telemetry.total_nodes = ls.numTotalNodes; }
    if (ls.heapFreeBytes != null) { telemetry.heap_free = ls.heapFreeBytes; }
}

if (data.type == 'neighborinfo' && data.payload.neighbors != null) {
    telemetry.neighbor_count = data.payload.neighbors.length;
}

var result = {
    deviceName: deviceName,
    deviceType: deviceType,
    attributes: attributes,
    telemetry: telemetry
};
