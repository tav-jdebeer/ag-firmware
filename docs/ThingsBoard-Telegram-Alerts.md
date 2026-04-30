# Telegram Alerts for MD1 Motion Events

This document describes how to configure ThingsBoard Cloud PE to send a Telegram notification whenever an MD1 Motion Detect Sensor reports a movement event (i.e. a new position telemetry update).

Each motion event produces two Telegram messages in the configured chat:

1. A **text message** with the device name and a clickable link to Google Maps
2. A **location pin** that renders as an inline map in the chat and can be tapped to open the phone's native map app

The implementation uses a **dedicated rule chain** assigned to the `MD1` device profile so MD1-specific logic lives in its own chain and does not touch the root rule chain. The MD1 chain processes Telegram alerts and then forwards every message back to the root rule chain so the normal telemetry-save behavior still runs.

## Prerequisites

- MD1 firmware is flashed, configured, and sending position on motion (see [CLAUDE.md](../CLAUDE.md))
- Gateway is forwarding MQTT to HiveMQ Cloud
- ThingsBoard Cloud PE is connected to HiveMQ via a MQTT integration
- The `docs/mqtt2tb.js` uplink converter is installed and the MD1 device appears in ThingsBoard with live telemetry (latitude / longitude / altitude)

## Rule chain topology

```
[ HiveMQ integration ] → message arrives for an MD1-profile device
           │
           ▼
[ MD1 Rule Chain ]     ← this chain is assigned as the default for the MD1 profile
   │
   ├─→ [Filter: msg has lat+lon?]
   │        │ True
   │        ├─→ [Format Telegram text]   → [Telegram sendMessage]
   │        └─→ [Format Telegram location] → [Telegram sendLocation]
   │
   └─→ [Rule Chain: Root Rule Chain]   ← always forward the original message
                                         back to root so timeseries are saved
                                         as normal
```

Key points:

- No device-level or profile-level filter is needed inside the rule chain — because only MD1-profile devices can send messages here, every message is from an MD1 by definition.
- The telegram alert branches run in parallel from the filter's `True` output.
- The "Rule Chain" node at the end of the MD1 chain forwards the message to the root rule chain regardless of whether the Telegram branch fired, so normal telemetry processing still happens.

## Step 1 — Create a Telegram bot

1. In Telegram, search for **@BotFather** and start a chat with it.
2. Send `/newbot` and follow the prompts:
   - **Name**: e.g. `TAV Alerts`
   - **Username**: must end in `bot`, e.g. `tav_alerts_bot`
3. BotFather replies with a **token** — save it. It looks like `8234567890:ABCdef...`.
4. Click the `t.me/<botusername>` link to open a chat with your new bot.
5. Send any message (e.g. `hello`) to activate the chat.

## Step 2 — Get your chat ID

1. Open this URL in a browser (substitute your real token):
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
2. Look for `"chat":{"id":123456789,...}` in the JSON response. That number is your **chat ID**.
3. For a **group chat**:
   - Add the bot to the group
   - Send a message in the group that mentions the bot
   - Re-fetch `/getUpdates` — the group chat ID will appear (usually a negative number like `-1001234567890`)

## Step 3 — Create the `MD1` device profile

The profile is the anchor that routes all MD1 device traffic to the dedicated rule chain.

1. In ThingsBoard: **Profiles → Device profiles → Add device profile**
2. **Name**: `MD1`
3. Leave the rest at defaults for now — we will assign a rule chain in Step 5 once it exists
4. Click **Add**

Assign existing MD1 devices to this profile:

1. Go to **Entities → Devices**
2. Click each MD1 device in the list
3. In the device details panel, click the **pencil / edit** icon next to the profile name
4. Change to `MD1` and save

For **future** MD1 devices: new Meshtastic nodes auto-create in ThingsBoard under the default `TAV Device` profile (the [docs/mqtt2tb.js](mqtt2tb.js) converter does not currently auto-detect MD1 nodes by `longName`). After the first packet from a new MD1, manually reassign it to the `MD1` profile using the steps above so the dedicated rule chain takes over.

## Step 4 — Create the `MD1 Rule Chain`

1. In ThingsBoard: **Rule chains → + Create new rule chain**
2. **Name**: `MD1 Rule Chain`
3. Click **Add**
4. Click the newly created chain to open the editor. It starts empty except for an input endpoint on the left.

## Step 5 — Assign the rule chain to the `MD1` profile

1. Go back to **Profiles → Device profiles → MD1**
2. Click the **pencil / edit** icon to edit the profile
3. Set **Default rule chain** to `MD1 Rule Chain`
4. Save

From this point on, all telemetry, attribute and event messages originating from devices in the `MD1` profile will enter the MD1 chain instead of the root chain.

## Step 6 — Build the filter node

Inside `MD1 Rule Chain`:

**Node type**: Filter → Script
**Name**: `Has lat/lon`

**Script** (TBEL):
```javascript
return msg.latitude != null && msg.longitude != null;
```

Wire the chain's **Input** endpoint → `Has lat/lon` with the `Post telemetry` relation (or use the default "all messages" relation — the input accepts any message type, and this filter only passes position telemetry).

## Step 7 — Text message branch

### 7a. Transformation node

**Node type**: Transformation → Script
**Name**: `Format Telegram text`

**Script** (TBEL):
```javascript
var lat = msg.latitude;
var lon = msg.longitude;
var mapUrl = 'https://maps.google.com/?q=' + lat + ',' + lon;
var deviceLabel = metadata.deviceName;
var text = '🚨 *Movement detected*\n' +
           'Device: ' + deviceLabel + '\n' +
           '[Open in maps](' + mapUrl + ')';
var newMsg = {
    chat_id: '<YOUR_CHAT_ID>',
    text: text,
    parse_mode: 'Markdown',
    disable_web_page_preview: false
};
return {msg: newMsg, metadata: metadata, msgType: msgType};
```

Replace `<YOUR_CHAT_ID>` with the chat ID from Step 2, as a quoted string.

### 7b. REST API Call node

**Node type**: External → REST API Call
**Name**: `Telegram sendMessage`
**Endpoint URL pattern**: `https://api.telegram.org/bot<YOUR_TOKEN>/sendMessage`
**Request method**: `POST`
**Headers**:
- `Content-Type` → `application/json`

Replace `<YOUR_TOKEN>` with the bot token from Step 1.

Wire: connect **"Format Telegram text" → "Success" → "Telegram sendMessage"**.

## Step 8 — Location pin branch

### 8a. Transformation node

**Node type**: Transformation → Script
**Name**: `Format Telegram location`

**Script** (TBEL):
```javascript
var newMsg = {
    chat_id: '<YOUR_CHAT_ID>',
    latitude: msg.latitude,
    longitude: msg.longitude
};
return {msg: newMsg, metadata: metadata, msgType: msgType};
```

### 8b. REST API Call node

**Node type**: External → REST API Call
**Name**: `Telegram sendLocation`
**Endpoint URL pattern**: `https://api.telegram.org/bot<YOUR_TOKEN>/sendLocation`
**Request method**: `POST`
**Headers**:
- `Content-Type` → `application/json`

Wire: connect **"Format Telegram location" → "Success" → "Telegram sendLocation"**.

## Step 9 — Wire the parallel branches from the filter

From the `Has lat/lon` filter node, drag **two** arrows labeled `True`:
- One to **Format Telegram text**
- One to **Format Telegram location**

ThingsBoard allows the same relation (`True`) to feed multiple downstream nodes, which runs both branches in parallel.

## Step 10 — Forward all messages to the root rule chain

So that normal telemetry save / device state / org-wide rules still run for MD1 devices, add a node that hands the original message back to the root chain after the Telegram branch.

### Flow / Rule Chain node

**Node type**: Flow → Rule Chain
**Name**: `→ Root Rule Chain`
**Rule chain**: `Root Rule Chain`

Wire:

- **Input endpoint** → `→ Root Rule Chain` directly, using the default relation (no filter). This forwards **every** incoming message to the root chain regardless of whether Telegram fired.

Note: the Input endpoint can fan out to multiple downstream nodes. You already connected it to the `Has lat/lon` filter; connect it again to the `→ Root Rule Chain` node as a second output. Both paths run in parallel — the filter path handles Telegram, the other path forwards to root for timeseries save.

## Step 11 — Save, enable debug, and test

1. Click **Save** on the `MD1 Rule Chain` (top right).
2. Turn on **Debug mode** on each new node (right-click → Debug mode: On) so events are logged while testing.
3. Shake the MD1.
4. Expected result:
   - In Telegram: 🚨 **Movement detected** / Device: !xxxxx / Open in maps (clickable link)
   - In Telegram: a second message with an inline map pin at the MD1's current location
   - In ThingsBoard: the MD1 device's Latest Telemetry still shows the updated lat/lon/altitude (proves the forward-to-root path is working)
5. Tap the map pin on your phone to open it in your native map app.
6. Once confirmed, turn **Debug mode: Off** on all nodes to avoid cluttering the event log.

## Troubleshooting

Common Telegram API errors (visible in the REST API Call node's debug events):

| HTTP Status / Error | Cause | Fix |
|---|---|---|
| `401 Unauthorized` | Wrong bot token | Verify the URL in the REST API Call node |
| `400 Bad Request: chat not found` | Wrong chat ID or bot hasn't been messaged yet | Re-check chat ID; send the bot a message to activate the chat |
| `400 Bad Request: can't parse entities` | Markdown formatting issue | Escape special characters (`_`, `*`, `[`, `]`, `(`, `)`) in the text, or switch `parse_mode` to `HTML` |
| `403 Forbidden: bot was blocked by the user` | User blocked the bot | Unblock or recreate the chat |
| Message never reaches the filter node | Profile is not assigned the MD1 Rule Chain | Check Profile settings: **Default rule chain** must be set to `MD1 Rule Chain` |
| Telemetry not saving to the device in ThingsBoard | The `→ Root Rule Chain` forward node is missing or not wired to the input | Ensure the Input endpoint has an unfiltered edge going to the Rule Chain forward node |
| Telegram fires but telemetry also missing | You forgot the forward-to-root node — MD1 chain terminates without saving | Add the Rule Chain forward node as described in Step 10 |
| Text message arrives but no location pin (or vice versa) | One branch failed | Check the failing node's debug events for the error detail |

## Security notes

- The bot token is stored in plaintext inside the rule chain configuration. Anyone with ThingsBoard admin access to the rule chain can see it.
- For production deployments, use a dedicated bot for each alert stream so that token leaks can be contained.
- Avoid using personal chat IDs for shared alerts — use a dedicated group chat so multiple people can receive notifications without sharing credentials.
- Consider storing the bot token as a server attribute on a system entity and referencing it via `$[ss_attribute_key]` in the URL pattern. Exact syntax depends on the ThingsBoard version.

## Extending the chain

Because `MD1 Rule Chain` is dedicated to MD1 devices, additional MD1-specific behavior is easy to add without touching the root chain:

- **Battery alerts** — filter on `battery_level < 20` and send a low-battery Telegram message when we add DeviceMetrics telemetry
- **Offline detection** — use a `Delay` node + `Attributes Save` to track last-seen time and alert if quiet for > N hours
- **Deduplication / throttling** — insert a `Filter → Check relation` or `Throttle` node upstream of the Telegram branch to rate-limit alerts
- **Snooze windows** — use a server attribute on each MD1 (`alert_snoozed_until`) and check it in the filter script to suppress alerts during maintenance
- **Cross-posting** — add parallel branches that POST to Slack / email / SMS using similar REST API Call nodes

The same pattern applies for future device profiles — e.g. create a `Gateway Rule Chain` for the gateway's own logic, assigned to a `Gateway` profile. New gateway nodes land in the default `TAV Device` profile and need manual reassignment after the first packet, the same way as MD1s.

## Related documents

- [CLAUDE.md](../CLAUDE.md) — overall project context and MD1 configuration
- [docs/mqtt2tb.js](mqtt2tb.js) — the ThingsBoard uplink converter that parses incoming Meshtastic JSON packets and outputs telemetry to the `TAV Device` default profile (manual profile reassignment per device)
- [docs/MD1 - User Requirement Specification.md](MD1%20-%20User%20Requirement%20Specification.md) — product URS
