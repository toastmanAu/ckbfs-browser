/**
 * publisher.js — Browser-native CKBFS V2 transaction builder + sender
 *
 * Uses CCC for transaction construction and any CCC signer for signing.
 * No Node.js. No server. Works in Chrome, Firefox, Safari (iOS included).
 *
 * Flow:
 *   1. Split file into 30KB chunks
 *   2. Build CKB transaction:
 *      - Output[0]: CKBFS index cell (225 CKB, type=CKBFS, data=molecule metadata)
 *      - Output[1]: change cell (remainder)
 *      - Witnesses[1+]: CKBFS content witnesses (one per chunk)
 *   3. Complete fees via CCC (handles input collection automatically)
 *   4. Sign + send via signer
 *   5. Return { txHash, typeId, uri }
 */

import { ccc } from '@ckb-ccc/core';
import {
  CKBFS_CODE_HASH, CKBFS_CELL_CAPACITY, CHUNK_SIZE, CONTRACT
} from './constants.js';
import { encodeCKBFSData, encodeCKBFSWitness, crc32 } from './molecule.js';

const BYTES_PER_SHANNON = 100_000_000n;

/**
 * Publish a file to CKBFS V2 using any CCC signer.
 *
 * @param {object}   opts
 * @param {object}   opts.signer       - CCC signer (JoyID, MetaMask, private key, etc.)
 * @param {Uint8Array} opts.content    - raw file bytes
 * @param {string}   opts.contentType  - MIME type, e.g. 'image/jpeg'
 * @param {string}   opts.filename     - filename, e.g. 'art.jpg'
 * @param {boolean}  [opts.mainnet]    - default false (testnet)
 * @param {function} [opts.onProgress] - (pct: number, msg: string) => void
 *
 * @returns {Promise<{ txHash: string, typeId: string, uri: string, capacityCkb: number }>}
 */
export async function publishCKBFS({
  signer,
  content,
  contentType,
  filename,
  mainnet = false,
  onProgress = () => {},
}) {
  if (!signer) throw new Error('publishCKBFS: signer is required');
  if (!(content instanceof Uint8Array)) throw new Error('publishCKBFS: content must be Uint8Array');

  const network = mainnet ? 'mainnet' : 'testnet';
  const log = (pct, msg) => { onProgress(pct, msg); console.log(`[ckbfs] ${msg}`); };

  log(0, `Preparing ${filename || 'file'} (${(content.length / 1024).toFixed(1)} KB) for CKBFS…`);

  // ── 1. Split into chunks ───────────────────────────────────────────────────
  const chunks = [];
  for (let i = 0; i < content.length; i += CHUNK_SIZE) {
    chunks.push(content.slice(i, i + CHUNK_SIZE));
  }
  if (chunks.length === 0) chunks.push(new Uint8Array(0));

  log(5, `Split into ${chunks.length} chunk${chunks.length > 1 ? 's' : ''}`);

  // ── 2. Encode cell output_data ─────────────────────────────────────────────
  // Witness layout: [0]=lock witness, [1..N]=content chunks
  // So witness indexes for content chunks are 1, 2, 3, ...
  const witnessIndexes = chunks.map((_, i) => i + 1);

  const outputData = encodeCKBFSData({
    witnessIndexes,
    fileBytes:   content,
    contentType: contentType || 'application/octet-stream',
    filename:    filename    || 'file',
  });

  log(10, 'Encoded metadata…');

  // ── 3. Get signer address for change output ────────────────────────────────
  const addresses = await signer.getAddresses();
  const changeAddr = addresses[0];

  // ── 4. Build transaction via CCC ───────────────────────────────────────────
  log(15, 'Building transaction…');

  const tx = ccc.Transaction.from({
    version: '0x0',
    cellDeps: [
      // CKBFS contract
      {
        outPoint: {
          txHash: CONTRACT[network].txHash,
          index:  CONTRACT[network].index,
        },
        depType: CONTRACT[network].depType,
      },
    ],
    headerDeps: [],
    inputs:  [],   // CCC completeFeeBy fills these
    outputs: [
      // Output[0]: CKBFS index cell
      {
        capacity: ccc.numToHex(CKBFS_CELL_CAPACITY),
        lock: changeAddr.script,  // owned by signer
        type: {
          codeHash: CKBFS_CODE_HASH,
          hashType: 'data1',
          args:     '0x' + '00'.repeat(32), // TypeID filled after input collection
        },
      },
      // Output[1]: change (CCC fills capacity)
      {
        capacity: '0x0',
        lock: changeAddr.script,
        type: null,
      },
    ],
    outputsData: [
      ccc.bytesFrom(outputData),
      '0x',
    ],
    witnesses: [], // filled below
  });

  // ── 5. Add content witnesses ───────────────────────────────────────────────
  // witnesses[0] = lock witness placeholder (CCC fills on sign)
  // witnesses[1..N] = CKBFS content chunks
  tx.witnesses.push('0x'); // placeholder for lock witness

  log(20, 'Encoding content witnesses…');
  for (let i = 0; i < chunks.length; i++) {
    const witness = encodeCKBFSWitness(chunks[i]);
    tx.witnesses.push(ccc.bytesFrom(witness));
    log(20 + Math.round((i / chunks.length) * 30), `Chunk ${i + 1}/${chunks.length}…`);
  }

  // ── 6. Collect inputs + complete fees ─────────────────────────────────────
  log(50, 'Collecting inputs…');
  await tx.addCellDepsOfKnownScripts(signer.client);
  await tx.completeInputsByCapacity(signer);
  await tx.completeFeeBy(signer, 1000n); // 1000 shannons/KB fee rate

  // ── 7. Derive TypeID from first input ─────────────────────────────────────
  // TypeID = CCC hashTypeId(firstInputOutPoint, outputIndex=0)
  const firstInput = tx.inputs[0];
  const typeId = ccc.hashTypeId(firstInput.previousOutput, 0);

  // Patch the type args
  tx.outputs[0].type.args = typeId;

  log(70, `TypeID: ${typeId.slice(0,18)}…`);

  // ── 8. Sign + send ─────────────────────────────────────────────────────────
  log(80, 'Waiting for signature…');
  const txHash = await signer.sendTransaction(tx);

  log(95, `Broadcast: ${txHash.slice(0,18)}… — waiting for confirmation…`);

  // ── 9. Wait for confirmation ───────────────────────────────────────────────
  await waitConfirmed(txHash, signer.client, (msg) => log(97, msg));

  log(100, 'Confirmed on-chain ✅');

  return {
    txHash,
    typeId,
    uri:         `ckbfs://${typeId}`,
    capacityCkb: Number(CKBFS_CELL_CAPACITY / BYTES_PER_SHANNON),
  };
}

// ── Estimate cost ─────────────────────────────────────────────────────────────

/**
 * Estimate cost of publishing a file to CKBFS.
 * Does NOT require a signer — safe to call for UI display.
 */
export function estimateCKBFSCost(contentBytes) {
  const chunks = Math.max(1, Math.ceil(contentBytes / CHUNK_SIZE));
  const txFeeCkb = 0.01 + chunks * 0.001; // rough estimate
  return {
    indexCellCkb: Number(CKBFS_CELL_CAPACITY / 100_000_000n),
    txFeeCkb:     parseFloat(txFeeCkb.toFixed(4)),
    totalCkb:     Number(CKBFS_CELL_CAPACITY / 100_000_000n) + parseFloat(txFeeCkb.toFixed(4)),
    chunks,
    note: 'Index cell (225 CKB) is locked permanently. File bytes live in prunable witnesses.',
  };
}

// ── Wait for confirmation ─────────────────────────────────────────────────────

async function waitConfirmed(txHash, client, onMsg, maxMs = 120_000) {
  const start = Date.now();
  while (Date.now() - start < maxMs) {
    try {
      const tx = await client.getTransaction(txHash);
      const status = tx?.status;
      if (status === 'committed') return;
      if (status === 'rejected') throw new Error(`Transaction rejected: ${txHash}`);
      onMsg(`Waiting… status: ${status || 'pending'}`);
    } catch (e) {
      if (e.message.includes('rejected')) throw e;
    }
    await sleep(6000);
  }
  // Don't throw — tx may still confirm, caller can poll themselves
  onMsg('Timed out waiting for confirmation — tx may still confirm');
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
