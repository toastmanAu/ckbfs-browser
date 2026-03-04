/**
 * @wyltek/ckbfs-browser
 *
 * Browser-native CKBFS V2 publisher.
 * Publishes any file to CKB using any CCC-compatible signer — JoyID, MetaMask,
 * hardware wallets, raw private key — with zero server infrastructure.
 *
 * Protocol: CKBFS V2 (contract deployed 20241025)
 * Code hash: 0x31e6376287d223b8c0410d562fb422f04d1d617b2947596a14c3d2efb7218d3a
 *
 * Transaction layout:
 *   Inputs:    [signer cells to cover 225+ CKB]
 *   Outputs:   [0: CKBFS index cell (225 CKB), 1: change cell]
 *   Witnesses: [0: secp256k1/joyid unlock, 1+: CKBFS content chunks]
 *   Cell data: molecule-encoded metadata (indexes, checksum, contentType, filename, version)
 *
 * @example
 * import { publishCKBFS } from '@wyltek/ckbfs-browser';
 * import { ccc } from '@ckb-ccc/core';
 *
 * const result = await publishCKBFS({
 *   signer,          // any CCC signer
 *   content,         // Uint8Array
 *   contentType,     // 'image/jpeg'
 *   filename,        // 'my-art.jpg'
 *   onProgress,      // (pct, msg) => void
 * });
 * // result: { txHash, typeId, uri: 'ckbfs://0x...' }
 */

export { publishCKBFS, estimateCKBFSCost } from './publisher.js';
export { resolveCKBFS, parseIdentifier  } from './resolver.js';
export { CKBFS_CODE_HASH, CKBFS_CELL_CAPACITY, CHUNK_SIZE, CONTRACT } from './constants.js';
