/**
 * molecule.js — CKBFS V2 molecule encoding
 *
 * Encodes the cell output_data as a 5-field molecule table:
 *   field[0]: Vec<Uint32>  — witness indexes (1 per chunk)
 *   field[1]: Uint32       — CRC32 checksum of reassembled file
 *   field[2]: String       — contentType (molecule Bytes = Uint32 len + payload)
 *   field[3]: String       — filename    (molecule Bytes = Uint32 len + payload)
 *   field[4]: Uint32       — version (always 4 = V2 marker, from our observed tx)
 *
 * Molecule table layout:
 *   Uint32 totalSize
 *   Uint32[fieldCount] fieldOffsets  (absolute, from start of buffer)
 *   <field data>
 */

// ── CRC32 ─────────────────────────────────────────────────────────────────────
// Standard CRC32 (matches what @ckbfs/api uses)

const CRC32_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[i] = c;
  }
  return t;
})();

export function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) crc = CRC32_TABLE[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// ── Molecule helpers ──────────────────────────────────────────────────────────

function u32le(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return b;
}

function moleculeBytes(str) {
  const enc = new TextEncoder().encode(str);
  return concat([u32le(enc.length), enc]);
}

function concat(arrays) {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

// ── Encode ────────────────────────────────────────────────────────────────────

/**
 * Encode CKBFS V2 output data (molecule table).
 *
 * @param {object} opts
 * @param {number[]} opts.witnessIndexes  - which witness slots contain content chunks
 * @param {Uint8Array} opts.fileBytes     - full reassembled file (for checksum)
 * @param {string} opts.contentType
 * @param {string} opts.filename
 * @returns {Uint8Array}
 */
export function encodeCKBFSData({ witnessIndexes, fileBytes, contentType, filename }) {
  const checksum = crc32(fileBytes);

  // field[0]: Vec<Uint32> indexes
  const idxCount = u32le(witnessIndexes.length);
  const idxItems = witnessIndexes.map(i => u32le(i));
  const field0 = concat([idxCount, ...idxItems]);

  // field[1]: Uint32 checksum
  const field1 = u32le(checksum);

  // field[2]: molecule Bytes contentType
  const field2 = moleculeBytes(contentType);

  // field[3]: molecule Bytes filename
  const field3 = moleculeBytes(filename);

  // field[4]: Uint32 version = 4 (V2 marker, observed in real tx)
  const field4 = u32le(4);

  const fields = [field0, field1, field2, field3, field4];
  const N = fields.length;

  // Header: Uint32 totalSize + N×Uint32 offsets
  const headerSize = 4 + N * 4;
  let bodySize = fields.reduce((s, f) => s + f.length, 0);
  const totalSize = headerSize + bodySize;

  const out = new Uint8Array(totalSize);
  const dv = new DataView(out.buffer);

  dv.setUint32(0, totalSize, true);

  let fieldOffset = headerSize;
  for (let i = 0; i < N; i++) {
    dv.setUint32(4 + i * 4, fieldOffset, true);
    fieldOffset += fields[i].length;
  }

  let writeOff = headerSize;
  for (const f of fields) { out.set(f, writeOff); writeOff += f.length; }

  return out;
}

// ── Witness encoding ──────────────────────────────────────────────────────────

/**
 * Encode a CKBFS content witness: b"CKBFS" + 0x00 (version) + chunk_bytes
 */
export function encodeCKBFSWitness(chunkBytes) {
  const out = new Uint8Array(6 + chunkBytes.length);
  out.set([0x43, 0x4b, 0x42, 0x46, 0x53, 0x00]); // "CKBFS\x00"
  out.set(chunkBytes, 6);
  return out;
}
