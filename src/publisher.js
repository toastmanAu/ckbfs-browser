/**
 * publisher.js — Browser-native CKBFS V2 transaction builder + sender
 *
 * Uses CCC for transaction construction and any CCC signer for signing.
 * No Node.js. No server. Works in Chrome, Firefox, Safari (iOS included).
 *
 * Note: This package does NOT import @ckb-ccc/core directly — instead it
 * accepts the signer object (which comes from the host app's CCC instance)
 * and builds the raw transaction using only browser-native APIs + CKB RPC.
 * This avoids peer dep bundling issues and keeps the package truly universal.
 */

import {
  CKBFS_CODE_HASH, CKBFS_CELL_CAPACITY, CHUNK_SIZE, CONTRACT
} from './constants.js';
import { encodeCKBFSData, encodeCKBFSWitness } from './molecule.js';

const BYTES_PER_SHANNON = 100_000_000n;

/**
 * Publish a file to CKBFS V2 using any CCC signer.
 *
 * @param {object}   opts
 * @param {object}   opts.signer       - CCC signer (JoyID, MetaMask, private key, etc.)
 * @param {object}   opts.ccc          - the @ckb-ccc/core module (passed from host app)
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
  ccc,
  content,
  contentType,
  filename,
  mainnet = false,
  onProgress = () => {},
}) {
  if (!signer) throw new Error('publishCKBFS: signer is required');
  if (!ccc)    throw new Error('publishCKBFS: ccc module is required — pass import * as ccc from "@ckb-ccc/core"');
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
  // witnesses[0] = lock witness, witnesses[1+] = content chunks
  const witnessIndexes = chunks.map((_, i) => i + 1);

  const outputData = encodeCKBFSData({
    witnessIndexes,
    fileBytes:   content,
    contentType: contentType || 'application/octet-stream',
    filename:    filename    || 'file',
  });

  log(10, 'Encoded metadata…');

  // ── 3. Get signer lock script ──────────────────────────────────────────────
  // getAddressObjs() returns Address objects with .script — unlike getAddresses() which returns strings
  const addrObj = await signer.getRecommendedAddressObj();
  const lockScript = addrObj.script;

  // ── 4. Build CCC transaction ───────────────────────────────────────────────
  log(15, 'Building transaction…');

  const tx = ccc.Transaction.from({
    version: '0x0',
    cellDeps: [
      {
        outPoint: {
          txHash: CONTRACT[network].txHash,
          index:  CONTRACT[network].index,
        },
        depType: CONTRACT[network].depType,
      },
    ],
    headerDeps:  [],
    inputs:      [],
    outputs: [
      // Output[0]: CKBFS index cell — TypeID filled after input collection
      {
        capacity: ccc.numToHex(CKBFS_CELL_CAPACITY),
        lock: lockScript,
        type: {
          codeHash: CKBFS_CODE_HASH,
          hashType: 'data1',
          args:     '0x' + '00'.repeat(32),
        },
      },
      // Output[1]: change
      {
        capacity: '0x0',
        lock: lockScript,
        type: null,
      },
    ],
    outputsData: [
      ccc.hexFrom(outputData),
      '0x',
    ],
    witnesses: [],
  });

  // ── 5. Content witnesses ───────────────────────────────────────────────────
  tx.witnesses.push('0x'); // slot 0 = lock witness (CCC fills on sign)

  log(20, 'Encoding content witnesses…');
  for (let i = 0; i < chunks.length; i++) {
    const w = encodeCKBFSWitness(chunks[i]);
    tx.witnesses.push(ccc.hexFrom(w));  // hex string — Uint8Array breaks JoyID serialisation
    log(20 + Math.round((i / chunks.length) * 30), `Chunk ${i + 1}/${chunks.length}…`);
  }

  // ── 6. Collect inputs + fees ───────────────────────────────────────────────
  log(50, 'Collecting inputs…');
  await tx.addCellDepsOfKnownScripts(signer.client);
  const witnessFeeReserve = BigInt(chunks.length) * 100000n;
  log(51, `[DBG] outputs capacity: ${tx.getOutputsCapacity()} shannons, fee reserve: ${witnessFeeReserve}`);
  await tx.completeInputsByCapacity(signer, witnessFeeReserve);
  log(52, `[DBG] inputs collected: ${tx.inputs.length}, inputs capacity: ${await tx.getInputsCapacity(signer.client)} shannons`);
  log(53, `[DBG] outputs[1] before fee: ${tx.outputs[1]?.capacity}`);
  await tx.completeFeeBy(signer, 3000n);
  log(54, `[DBG] fee complete — inputs: ${tx.inputs.length}, change: ${tx.outputs[1]?.capacity} shannons`);

  // ── 7. Derive TypeID ──────────────────────────────────────────────────────
  if (!tx.inputs[0]) {
    throw new Error('No inputs collected — wallet may have insufficient CKB (need 225+ CKB for CKBFS index cell)');
  }
  // hashTypeId takes the full CellInput object, NOT just previousOutput
  const typeId = ccc.hashTypeId(tx.inputs[0], 0);
  tx.outputs[0].type.args = typeId;

  log(70, `TypeID: ${typeId.slice(0, 18)}…`);

  // ── 8. Sign + send ─────────────────────────────────────────────────────────
  log(80, 'Waiting for wallet signature…');
  // Log full tx summary before handing to JoyID
  log(81, `[DBG] tx summary — inputs:${tx.inputs.length} outputs:${tx.outputs.length} witnesses:${tx.witnesses.length} totalOutputCap:${tx.getOutputsCapacity()} shannons`);
  console.log('[ckbfs-publisher] tx before sign:', JSON.stringify({
    inputs:  tx.inputs.length,
    outputs: tx.outputs.map(o => ({ cap: o.capacity?.toString(), type: o.type?.codeHash?.slice(0,10) })),
    witnesses: tx.witnesses.map(w => (typeof w === 'string' ? w.length : '?') + ' chars'),
    cellDeps: tx.cellDeps.map(d => ({ txHash: d.outPoint?.txHash?.slice(0,10), depType: d.depType })),
  }, null, 2));
  const txHash = await signer.sendTransaction(tx);

  log(95, `Broadcast: ${txHash.slice(0, 18)}… — waiting for confirmation…`);
  await waitConfirmed(txHash, signer.client, (msg) => log(97, msg));
  log(100, 'Confirmed on-chain ✅');

  return {
    txHash,
    typeId,
    uri:         `ckbfs://${typeId}`,
    capacityCkb: Number(CKBFS_CELL_CAPACITY / BYTES_PER_SHANNON),
  };
}

export function estimateCKBFSCost(contentBytes) {
  const chunks = Math.max(1, Math.ceil(contentBytes / CHUNK_SIZE));
  return {
    indexCellCkb: Number(CKBFS_CELL_CAPACITY / 100_000_000n),
    txFeeCkb:     parseFloat((0.01 + chunks * 0.001).toFixed(4)),
    totalCkb:     Number(CKBFS_CELL_CAPACITY / 100_000_000n) + parseFloat((0.01 + chunks * 0.001).toFixed(4)),
    chunks,
    note: 'Index cell (225 CKB) locked permanently. File bytes in prunable witnesses.',
  };
}

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
    await new Promise(r => setTimeout(r, 6000));
  }
  onMsg('Timed out — tx may still confirm');
}
