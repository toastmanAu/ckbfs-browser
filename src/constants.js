/**
 * constants.js — CKBFS V2 protocol constants
 *
 * All values verified against:
 *   1. @ckbfs/api npm package (node_modules/@ckbfs/api/dist/utils/constants.js)
 *   2. A real mainnet CKBFS V2 publish transaction we made on 2026-03-04:
 *      txHash: 0xd824b272df0e6ec2cee6eeb353a418174ff52150f4643aa06642d7236b141d0e
 *
 * Verification method:
 *   - Fetched the above tx via CKB RPC get_transaction
 *   - Confirmed cell_deps[0] = secp256k1 dep_group (0xfab07962... → lock scripts)
 *   - Confirmed cell_deps[1] = CKBFS V2 dep_group (0x71a7ba8...)
 *     Wait — actually 0x71a7ba8 is secp256k1, 0xfab07962 is CKBFS V2 dep_group.
 *     Cross-checked: @ckbfs/api DEP_GROUP_TX_HASH.mainnet.V2 = 0xfab07962... ✓
 *   - Output[0] type script code_hash = 0x31e637... matches CKBFS_CODE_HASH.mainnet.V2 ✓
 *
 * Sources:
 *   - https://github.com/ckb-devrel/ckbfs
 *   - @ckbfs/api@latest (npm package constants)
 *   - CKB Explorer: https://explorer.nervos.org/transaction/0xd824b272...
 */

// ── V2 Code Hash (same on mainnet and testnet) ────────────────────────────────
// hash_type: 'data1' (code hash of contract binary)
export const CKBFS_CODE_HASH = '0x31e6376287d223b8c0410d562fb422f04d1d617b2947596a14c3d2efb7218d3a';

// ── Contract TypeID (alternative: use hash_type 'type' instead of 'data1') ───
// Useful if you want to reference by TypeID rather than code hash
export const CKBFS_TYPE_ID = {
  mainnet: '0xfd2058c9a0c0183354cf637e25d2707ffa9bb6fa2ba9b29f4ebc6be3e54ad7eb',
  testnet: '0x7c6dcab8268201f064dc8676b5eafa60ca2569e5c6209dcbab0eb64a9cb3aaa3',
};

// ── Dep group cell deps ───────────────────────────────────────────────────────
// dep_type: 'dep_group' — contains pointer(s) to the actual contract binary cell(s)
// Source: @ckbfs/api DEP_GROUP_TX_HASH, confirmed against real tx cell_deps
export const CONTRACT = {
  mainnet: {
    txHash:  '0xfab07962ed7178ed88d450774e2a6ecd50bae856bdb9b692980be8c5147d1bfa',
    index:   '0x0',
    depType: 'depGroup',  // CCC uses camelCase — 'dep_group' encodes as 0x00 (wrong), 'depGroup' = 0x01
  },
  testnet: {
    txHash:  '0x469af0d961dcaaedd872968a9388b546717a6ccfa47b3165b3f9c981e9d66aaa',
    index:   '0x0',
    depType: 'depGroup',
  },
};

// ── Deploy transactions (for reference / verification) ────────────────────────
// The transactions where the CKBFS V2 contract was originally deployed
export const DEPLOY_TX = {
  mainnet: '0xc9b6698f44c3b80e7e1c48823b2714e432b93f0206ffaf9df885d23267ed2ebc',
  testnet: null, // see @ckbfs/api constants for testnet deploy tx
};

// ── Cell capacity ─────────────────────────────────────────────────────────────
// Each CKBFS index cell requires exactly 225 CKB locked permanently
export const CKBFS_CELL_CAPACITY = 22500000000n; // shannons (225 CKB)

// ── Chunk size ────────────────────────────────────────────────────────────────
// Max bytes per CKBFS witness chunk.
// CKB consensus allows ~512KB per tx; 30KB chunks give comfortable headroom
// for overhead and multi-chunk files up to ~15MB per transaction.
export const CHUNK_SIZE = 30 * 1024; // 30KB

// ── Wire format ───────────────────────────────────────────────────────────────
// Each CKBFS witness begins with: magic(5) + version(1) + content_bytes
// "CKBFS" = 0x43 0x4b 0x42 0x46 0x53
// version = 0x00 for V2 (confirmed from real tx witness[1][5] = 0x00)
export const MAGIC   = new Uint8Array([0x43, 0x4b, 0x42, 0x46, 0x53]); // "CKBFS"
export const VERSION = 0x00; // V2 wire format

// ── V3 Contract (deployed 20250821) ──────────────────────────────────────────
export const CONTRACT_V3 = {
  mainnet: {
    codeHash: '0xb5d13ffe0547c78021c01fe24dce2e959a1ed8edbca3cb93dd2e9f57fb56d695',
    txHash:   '0x03deba7f8206c81981d6f6a2d61b67dde75b4df91cbcfaf2e2fb041ba50c4719',
    index:    '0x0',
    depType:  'depGroup',
  },
  testnet: {
    codeHash: '0xb5d13ffe0547c78021c01fe24dce2e959a1ed8edbca3cb93dd2e9f57fb56d695',
    txHash:   '0x47cfa8d554cccffe7796f93b58437269de1f98f029d0a52b6b146381f3e95e61',
    index:    '0x0',
    depType:  'depGroup',
  },
};
