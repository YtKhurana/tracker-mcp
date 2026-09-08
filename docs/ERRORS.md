# Error contract

Tool failures return `isError: true` and a text JSON body:
`{ "ok": false, "error": { "code": "...", "message": "...", "details": {} } }`.
Malformed MCP protocol messages are handled by the SDK; valid tool calls with
invalid arguments use this envelope. Never infer success from a returned path
inside an error's `details`.

| Code | Representative condition | Behavioral check |
| --- | --- | --- |
| NOT_FOUND | Missing input or track | session-native, output-native |
| INVALID_ARGUMENT | Invalid numbers, batch or path | session, marks, output |
| PARSE_FAILED | Malformed project XML | session-native |
| UNSUPPORTED_TYPE | Non-point-mass analysis | service-native, marks |
| NO_SESSION | Stale session ID | session-native |
| SESSION_BUSY | Second open or concurrent service call | session-native, service-client |
| SERVICE_UNAVAILABLE | Missing service jar or broken protocol | service-client |
| JAVA_EXIT | Owned Java process exits unexpectedly | service-client |
| TIMEOUT | Startup, transport or EDT deadline | service-client, service-lifecycle-native |
| VIDEO_DECODE | Corrupt encoded media | service-native |
| SAVE_FAILED | Existing output or inaccessible directory | output-native, service-native |
| EXPORT_EMPTY | Track has no usable data | output-native |

Names above refer to `test/<name>.test.js`. `service-client.test.js` also
exercises all twelve envelopes across real loopback TCP; `error-wire.test.js`
checks their MCP framing and detail preservation. These synthetic propagation
checks supplement, not replace, behavioral generation checks.

Timeouts and broken exchanges terminate the owned service; in-memory state is
lost. A write may already have completed. There is no automatic retry. Inspect
the requested output, then reopen the last confirmed saved project. A PNG
service-request failure after an output path has been selected includes
`details.attempted_path`; validation/allocation failures may lack it. Uncertain
temporary outputs are retained.
