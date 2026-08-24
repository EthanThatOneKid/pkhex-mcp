/**
 * Gen IV party-slot codec primitives (spec section 7; ADR-0002).
 *
 * Wire layout of one 236-byte slot:
 *   +0x00  u32 PID
 *   +0x04  u16 flags (bit0 = partyDecrypted: game left data plaintext in place)
 *   +0x06  u16 Add16 checksum over decrypted bytes 0x08..0x87
 *   +0x08..0x87  four 32-byte logical blocks, PID-shuffled, LCG-XORed with the checksum word
 *   +0x88..0xEB  battle tail (status/level/HP/stats), LCG-XORed with the PID
 */

/** Physical slot i holds the logical block named by SHUFFLE_TABLE[sv][i]. */
export const SHUFFLE_TABLE = [
  "ABCD",
  "ABDC",
  "ACBD",
  "ACDB",
  "ADBC",
  "ADCB",
  "BACD",
  "BADC",
  "BCAD",
  "BCDA",
  "BDAC",
  "BDCA",
  "CABD",
  "CADB",
  "CBAD",
  "CBDA",
  "CDAB",
  "CDBA",
  "DABC",
  "DACB",
  "DBAC",
  "DBCA",
  "DCAB",
  "DCBA",
] as const;

const BLOCKS_START = 0x08;
const BLOCKS_END = 0x88;
const TAIL_END = 0xec;

/** Sum of little-endian u16s across [start, end), truncated to 16 bits. */
export function add16Checksum(
  bytes: Uint8Array,
  start: number,
  end: number,
): number {
  let sum = 0;
  for (let i = start; i < end; i += 2) {
    sum += bytes[i]! | (bytes[i + 1]! << 8);
  }
  return sum & 0xffff;
}

/**
 * The Gen IV stream cipher: seed evolves per u16 via
 * seed = 0x41C64E6D*seed + 0x6073 (mod 2^32); each word XORs seed >>> 16.
 */
export function lcgXorRegion(
  bytes: Uint8Array,
  start: number,
  endExclusive: number,
  seed: number,
): void {
  for (let i = start; i < endExclusive; i += 2) {
    seed = (Math.imul(0x41c64e6d, seed) + 0x6073) >>> 0;
    const word = bytes[i]! | (bytes[i + 1]! << 8);
    const out = word ^ (seed >>> 16);
    bytes[i] = out & 0xff;
    bytes[i + 1] = (out >>> 8) & 0xff;
  }
}

const BLOCK_SIZE = 32;

/**
 * Reorder the four physical 32-byte blocks at `blocksStart` into logical
 * A/B/C/D order per the PID-derived shuffle value. Shared by the 236-byte
 * party codec and the 136-byte stored-record codec.
 */
export function unshuffleBlocks(
  image: Uint8Array,
  pid: number,
  blocksStart: number,
): void {
  const sv = ((pid >>> 13) & 31) % 24;
  const perm = SHUFFLE_TABLE[sv];
  const logical = new Uint8Array(BLOCK_SIZE * 4);
  const letters = ["A", "B", "C", "D"] as const;
  for (let phys = 0; phys < 4; phys++) {
    const logicalIndex = letters.indexOf(perm[phys] as "A" | "B" | "C" | "D");
    logical.set(
      image.subarray(
        blocksStart + phys * BLOCK_SIZE,
        blocksStart + (phys + 1) * BLOCK_SIZE,
      ),
      logicalIndex * BLOCK_SIZE,
    );
  }
  image.set(logical, blocksStart);
}

/**
 * Produce a fully decrypted, logically-ordered 236-byte image.
 *
 * When `decryptedInPlace` is set (flags.bit0) the game already applied BOTH
 * ciphers inside its decryption context (pokeplatinum decrypts the whole
 * PartyPokemon, tail included) -- so we skip both XOR layers; only the block
 * unshuffle remains, which persists regardless of the flag.
 */
export function decryptSlot(
  slot: Uint8Array,
  decryptedInPlace: boolean,
): Uint8Array {
  if (slot.length !== 236) throw new Error(`slot must be 236 bytes`);
  const image = slot.slice();

  const pid = image[0x00]! |
    (image[0x01]! << 8) |
    (image[0x02]! << 16) |
    (image[0x03]! << 24);
  const checksumWord = image[0x06]! | (image[0x07]! << 8);

  if (!decryptedInPlace) {
    lcgXorRegion(image, BLOCKS_START, BLOCKS_END, checksumWord);
    lcgXorRegion(image, BLOCKS_END, TAIL_END, pid);
  }

  // Unshuffle blocks into logical order (persists regardless of bit0).
  unshuffleBlocks(image, pid, BLOCKS_START);

  return image;
}
