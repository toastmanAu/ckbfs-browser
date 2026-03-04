/**
 * typeid.js — CKB TypeID derivation
 *
 * TypeID = blake2b_256(first_input_out_point_bytes || output_index_u64le)
 *
 * This is the standard CKB TypeID algorithm — same as used for Spore cells,
 * CKBFS cells, and any other type-script-with-unique-id pattern.
 *
 * We use the CCC blake2b implementation so there's no extra dependency.
 */

import { ccc } from '@ckb-ccc/core';

/**
 * Derive the TypeID for a CKBFS output cell.
 *
 * @param {object} firstInput         - the first input in the transaction
 * @param {string} firstInput.txHash  - hex with 0x prefix
 * @param {number} firstInput.index   - output index as number
 * @param {number} outputIndex        - which output this TypeID is for (usually 0)
 * @returns {string} 0x-prefixed 32-byte hex TypeID
 */
export function deriveTypeId(firstInput, outputIndex) {
  // Serialize out_point: tx_hash (32 bytes) + index (4 bytes, little-endian)
  const txHashBytes = hexToBytes(firstInput.txHash);
  const indexBytes  = new Uint8Array(4);
  new DataView(indexBytes.buffer).setUint32(0, firstInput.index, true);

  // Output index as u64 little-endian
  const outIdxBytes = new Uint8Array(8);
  new DataView(outIdxBytes.buffer).setBigUint64(0, BigInt(outputIndex), true);

  // Concatenate: out_point_bytes (36) + output_index_u64le (8) = 44 bytes
  const input = new Uint8Array(44);
  input.set(txHashBytes,  0);
  input.set(indexBytes,  32);
  input.set(outIdxBytes, 36);

  // blake2b_256 using CCC's hasher
  const hash = ccc.hashTypeId(
    { txHash: firstInput.txHash, index: ccc.numToHex(firstInput.index) },
    outputIndex
  );

  return hash;
}

function hexToBytes(hex) {
  const h = hex.startsWith('0x') ? hex.slice(2) : hex;
  const b = new Uint8Array(h.length / 2);
  for (let i = 0; i < b.length; i++) b[i] = parseInt(h.slice(i*2, i*2+2), 16);
  return b;
}
