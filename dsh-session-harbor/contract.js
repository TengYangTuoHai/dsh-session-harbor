/**
 * Cross-host placement protocol version. The same plugin runs on every machine,
 * so an aggregator reads placements from the host that owns the sessions.
 * Bump on any breaking change to the snapshot/action envelope.
 */
export const PLACEMENT_CONTRACT = 1;
