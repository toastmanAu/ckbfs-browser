/**
 * constants.js — CKBFS V2 protocol constants
 */

// CKBFS V2 contract (deployed 20241025, mainnet + testnet)
export const CKBFS_CODE_HASH = '0x31e6376287d223b8c0410d562fb422f04d1d617b2947596a14c3d2efb7218d3a';

// Contract deployment cells (dep_type: 'code')
export const CONTRACT = {
  mainnet: {
    txHash:  '0x30b4e03f8e8f8aae4e48e9ba37218eb2c4c3e4d5fad2c8f5e8090ee06a54c2a1',
    index:   '0x0',
    depType: 'code',
  },
  testnet: {
    txHash:  '0x8f8c79eb6671709633fe6a46de93c0fedc9c1b8a6527a18d3983879542635c9f',
    index:   '0x0',
    depType: 'code',
  },
};

// Each index cell locks 225 CKB (22500000000 shannons)
export const CKBFS_CELL_CAPACITY = 22500000000n; // shannons

// Max bytes per CKBFS witness chunk (~30KB — CKB consensus limit ~512KB per tx,
// using 30KB chunks gives headroom for witnesses overhead and multi-chunk files)
export const CHUNK_SIZE = 30 * 1024; // 30KB

// Magic header prefix for each CKBFS witness
export const MAGIC = new Uint8Array([0x43, 0x4b, 0x42, 0x46, 0x53]); // "CKBFS"
export const VERSION = 0x00; // V2
