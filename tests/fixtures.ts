import type { SyncPayload } from "../src/gen4/schemas.ts";

/** base64 of 236 zero bytes (316 chars with one pad) -- matches the frozen contract. */
export const EMPTY_SLOT_BYTES = `${"A".repeat(315)}=`;

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function emptySlot() {
  return { bytes: EMPTY_SLOT_BYTES, decryptedInPlace: false };
}

/** Synthetic SyncPayload built field-by-field -- no copyrighted game data. */
export function makeSyncPayload(): SyncPayload {
  return {
    trainerMeta: {
      tid: 12345,
      sid: 54321,
      playerName: "ETHAN",
      playtime: { hours: 87, minutes: 14, seconds: 3 },
      mapId: 66,
    },
    slots: [emptySlot(), emptySlot(), emptySlot(), emptySlot(), emptySlot(), emptySlot()],
  };
}
