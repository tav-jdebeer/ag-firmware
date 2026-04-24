// ThingsBoard MQTT Integration — Uplink Data Converter (TBEL)
// Parses Meshtastic JSON packets from tav/2/json/{channel}/{nodeId}
//
// Maps incoming packets onto ThingsBoard devices keyed by the Meshtastic
// hex node ID (e.g. "!d36d787"). 
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

// Default device type
// // Note: Device profile must be set manually after creation to ensure the appropriate rule engine is used
var deviceType = 'TAV Device';

var telemetry = {};
telemetry.channel = channel;
if (data.hop_start != null) {
    telemetry.hop_start = data.hop_start;
}
if (data.hops_away != null) {
    telemetry.hops_away = data.hops_away;
}

// Mesh signal quality — present at envelope level on most packet types
if (data.rssi != null) { telemetry.rssi = data.rssi; }
if (data.snr != null) { telemetry.snr = data.snr; }

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

if (data.type == 'telemetry') {
    var p = data.payload;
    if (p.battery_level != null) { telemetry.battery_level = p.battery_level; }
    if (p.voltage != null) { telemetry.voltage = p.voltage; }
    if (p.channel_utilization != null) { telemetry.channel_utilization = p.channel_utilization; }
    if (p.air_util_tx != null) { telemetry.air_util_tx = p.air_util_tx; }
    if (p.uptime_seconds != null) { telemetry.uptime_seconds = p.uptime_seconds; }
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
