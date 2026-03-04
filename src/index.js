/**
 * @wyltek/ckbfs-browser
 *
 * Browser CKBFS publisher — wraps @ckbfs/api V3 with a simple progress-aware interface.
 * Protocol: CKBFS V3 (contract deployed 20250821)
 *
 * @example
 * import { publishCKBFS } from '@wyltek/ckbfs-browser';
 *
 * const result = await publishCKBFS({
 *   signer,          // any CCC signer (JoyID, MetaMask, etc.)
 *   ccc,             // import * as ccc from '@ckb-ccc/core'
 *   ckbfs,           // import * as ckbfs from '@ckbfs/api'
 *   content,         // Uint8Array
 *   contentType,     // 'image/jpeg'
 *   filename,        // 'my-art.jpg'
 *   mainnet,         // true for mainnet
 *   onProgress,      // (pct, msg) => void
 * });
 * // result: { txHash, typeId, capacityCkb }
 */

export { publishCKBFS, estimateCKBFSCost } from './publisher.js';
export { resolveCKBFS, parseIdentifier  } from './resolver.js';
export { CHUNK_SIZE } from './constants.js';
