/**
 * publisher.js — CKBFS V3 publisher using the official @ckbfs/api SDK
 *
 * Delegates to @ckbfs/api's createPublishV3Transaction for correct tx construction.
 * The host app must have @ckbfs/api installed as a peer dependency.
 */

import { CHUNK_SIZE } from './constants.js';

const BYTES_PER_SHANNON = 100_000_000n;

/**
 * Publish a file to CKBFS V3.
 *
 * @param {object} opts
 * @param {Uint8Array}  opts.content       - Raw file bytes
 * @param {string}      opts.contentType   - MIME type
 * @param {string}      opts.filename      - Filename for the CKBFS cell
 * @param {object}      opts.signer        - CCC signer (JoyID, MetaMask, etc.)
 * @param {object}      opts.ccc           - import * as ccc from '@ckb-ccc/core'
 * @param {object}      opts.ckbfs         - import * as ckbfs from '@ckbfs/api'
 * @param {boolean}     opts.mainnet       - true = CKB mainnet, false = testnet
 * @param {Function}    opts.onProgress    - (pct: number, msg: string) => void
 *
 * @returns {Promise<{txHash: string, typeId: string, capacityCkb: number}>}
 */
export async function publishCKBFS({
  content,
  contentType,
  filename,
  signer,
  ccc,
  ckbfs,
  mainnet = false,
  onProgress = () => {},
}) {
  if (!signer) throw new Error('publishCKBFS: signer is required');
  if (!ccc)    throw new Error('publishCKBFS: ccc module is required');
  if (!ckbfs)  throw new Error('publishCKBFS: ckbfs module is required — pass import * as ckbfs from "@ckbfs/api"');
  if (!(content instanceof Uint8Array)) throw new Error('publishCKBFS: content must be Uint8Array');

  const network = mainnet ? 'mainnet' : 'testnet';
  const log = (pct, msg) => { onProgress(pct, msg); console.log(`[ckbfs] ${msg}`); };

  log(0, `Preparing ${filename || 'file'} (${(content.length / 1024).toFixed(1)} KB) for CKBFS V3…`);

  // ── 1. Split into chunks ───────────────────────────────────────────────────
  const contentChunks = [];
  for (let i = 0; i < content.length; i += CHUNK_SIZE) {
    contentChunks.push(content.slice(i, i + CHUNK_SIZE));
  }
  if (contentChunks.length === 0) contentChunks.push(new Uint8Array(0));

  log(5, `Split into ${contentChunks.length} chunk${contentChunks.length > 1 ? 's' : ''}`);

  // ── 2. Get signer lock script ──────────────────────────────────────────────
  const addrObj = await signer.getRecommendedAddressObj();
  const lock = addrObj.script;

  log(15, 'Building V3 transaction via @ckbfs/api…');

  // ── 3. Build tx using official SDK ────────────────────────────────────────
  const tx = await ckbfs.createPublishV3Transaction(signer, {
    contentChunks,
    contentType: contentType || 'application/octet-stream',
    filename: filename || 'file',
    lock,
    network,
    useTypeID: false,
    feeRate: 2000,
  });

  log(85, 'Transaction built — sending to JoyID for signature…');

  // ── 4. Sign + send ────────────────────────────────────────────────────────
  const txHash = await signer.sendTransaction(tx);

  log(100, `Confirmed! TX: ${txHash}`);

  // Extract TypeID from output[0] type args
  const typeId = tx.outputs[0]?.type?.args ?? null;
  const capacityCkb = Number(tx.outputs[0]?.capacity ?? 0n) / 1e8;

  return {
    txHash,
    typeId,
    capacityCkb,
  };
}

/**
 * Estimate capacity cost for a CKBFS V3 cell (for cost panel display).
 * @param {object} opts
 * @param {number}  opts.contentBytes    - Total file size in bytes
 * @param {number}  opts.lockArgsBytes   - Lock args length in bytes (default: 22 for JoyID)
 * @returns {number} Estimated CKB needed
 */
export function estimateCKBFSCost({ contentBytes, lockArgsBytes = 22 }) {
  // V3 outputData is smaller than V2 (no witness indexes, just index+checksum+contentType+filename)
  // Rough estimate: 32 (molecule header) + 8 (index+checksum) + contentType + filename
  const outputDataBytes = 60; // conservative estimate for typical files
  const typeSize = 65; // 32 code_hash + 1 hashType + 32 args
  const lockSize = 32 + 1 + lockArgsBytes;
  const capacityBytes = 8;
  const cellBytes = capacityBytes + lockSize + typeSize + outputDataBytes;
  const chunkCount = Math.max(1, Math.ceil(contentBytes / CHUNK_SIZE));
  // Witness fee: chunks × (CHUNK_SIZE + 6 byte header) at 2000 shannons/KB
  const witnessFeeShannons = BigInt(chunkCount) * BigInt(CHUNK_SIZE + 6) * 2000n / 1000n;
  const capacityCkb = cellBytes + 2; // +2 CKB headroom
  const feeCkb = Number(witnessFeeShannons) / 1e8;
  return capacityCkb + feeCkb;
}
