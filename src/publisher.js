/**
 * publisher.js — Browser-native CKBFS V3 transaction builder
 *
 * Pure implementation using only @ckb-ccc/core (1.x) — no @ckbfs/api dependency.
 * Avoids the dual-CCC-version conflict that causes "superclass is not a constructor".
 *
 * Protocol: CKBFS V3 (20250821.4ee6689bf7ec)
 * Witness format: head = CKBFS(5) + ver(1) + prevTxHash(32) + prevWitnessIdx(4) + prevChecksum(4) + nextIdx(4) + content
 *                 continuation = nextIdx(4) + content
 * Cell data: molecule table { index: Uint32, checksum: Uint32, contentType: Bytes, filename: Bytes }
 */

import { CHUNK_SIZE, CONTRACT_V3 } from './constants.js';

const BYTES_PER_SHANNON = 100_000_000n;
const CKBFS_HEADER = new Uint8Array([0x43, 0x4b, 0x42, 0x46, 0x53]); // "CKBFS"

// ── Adler32 checksum (pure JS, no deps) ───────────────────────────────────────
function adler32(data) {
  const MOD = 65521;
  let a = 1, b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]) % MOD;
    b = (b + a) % MOD;
  }
  return ((b << 16) | a) >>> 0;
}

// ── Molecule encoding for V3 cell data ────────────────────────────────────────
// Table layout: 4-byte total-len + 4 offsets (4 bytes each) + field bytes
function u32le(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}
function moleculeBytes(s) {
  const enc = new TextEncoder().encode(s);
  return concat([u32le(enc.length), enc]);
}
function concat(arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) { out.set(a, off); off += a.length; }
  return out;
}

/**
 * Encode V3 CKBFSData molecule table:
 * { index: Uint32, checksum: Uint32, contentType: Bytes, filename: Bytes }
 */
function encodeCKBFSDataV3({ index, checksum, contentType, filename }) {
  const fieldIndex    = u32le(index);
  const fieldChecksum = u32le(checksum);
  const fieldCT       = moleculeBytes(contentType);
  const fieldFN       = moleculeBytes(filename);

  const HEADER_SIZE = 4; // total-len u32
  const OFFSET_SIZE = 4; // per-field offset u32
  const NUM_FIELDS  = 4;
  const headerBytes = HEADER_SIZE + NUM_FIELDS * OFFSET_SIZE; // 20

  const fields = [fieldIndex, fieldChecksum, fieldCT, fieldFN];
  let offset = headerBytes;
  const offsets = fields.map(f => { const o = offset; offset += f.length; return o; });
  const totalLen = offset;

  const out = new Uint8Array(totalLen);
  const dv  = new DataView(out.buffer);
  dv.setUint32(0, totalLen, true);
  offsets.forEach((o, i) => dv.setUint32(4 + i * 4, o, true));
  let pos = headerBytes;
  for (const f of fields) { out.set(f, pos); pos += f.length; }
  return out;
}

// ── V3 witness encoding ───────────────────────────────────────────────────────
function encodeHeadWitness({ prevTxHash, prevWitnessIndex, prevChecksum, nextIndex, content }) {
  const prevTxHashBytes = new Uint8Array(32);
  if (prevTxHash && prevTxHash !== '0x' + '00'.repeat(32)) {
    const h = prevTxHash.startsWith('0x') ? prevTxHash.slice(2) : prevTxHash;
    for (let i = 0; i < 32; i++) prevTxHashBytes[i] = parseInt(h.substr(i * 2, 2), 16);
  }
  const buf = new ArrayBuffer(4);
  const dv  = new DataView(buf);
  const prevWitBuf      = new Uint8Array(4); dv.setUint32(0, prevWitnessIndex || 0, true); prevWitBuf.set(new Uint8Array(buf));
  const prevChecksumBuf = new Uint8Array(4); dv.setUint32(0, prevChecksum    || 0, true); prevChecksumBuf.set(new Uint8Array(buf));
  const nextIdxBuf      = new Uint8Array(4); dv.setUint32(0, nextIndex        || 0, true); nextIdxBuf.set(new Uint8Array(buf));
  return concat([CKBFS_HEADER, new Uint8Array([0x03]), prevTxHashBytes, prevWitBuf, prevChecksumBuf, nextIdxBuf, content]);
}

function encodeContinuationWitness({ nextIndex, content }) {
  const nextIdxBuf = new Uint8Array(4);
  new DataView(nextIdxBuf.buffer).setUint32(0, nextIndex || 0, true);
  return concat([nextIdxBuf, content]);
}

// ── Main publish function ─────────────────────────────────────────────────────
/**
 * Publish a file to CKBFS V3.
 *
 * @param {object} opts
 * @param {Uint8Array}  opts.content       - Raw file bytes
 * @param {string}      opts.contentType   - MIME type
 * @param {string}      opts.filename      - Filename for the CKBFS cell
 * @param {object}      opts.signer        - CCC signer (JoyID, MetaMask, etc.)
 * @param {object}      opts.ccc           - import * as ccc from '@ckb-ccc/core'
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
  mainnet = false,
  onProgress = () => {},
}) {
  if (!signer) throw new Error('publishCKBFS: signer is required');
  if (!ccc)    throw new Error('publishCKBFS: ccc module is required');
  if (!(content instanceof Uint8Array)) throw new Error('publishCKBFS: content must be Uint8Array');

  const network = mainnet ? 'mainnet' : 'testnet';
  const log = (pct, msg) => { onProgress(pct, msg); console.log(`[ckbfs] ${msg}`); };
  const contract = CONTRACT_V3[network];

  log(0, `Preparing ${filename || 'file'} (${(content.length / 1024).toFixed(1)} KB) for CKBFS V3…`);

  // ── 1. Split into chunks ──────────────────────────────────────────────────
  const chunks = [];
  for (let i = 0; i < content.length; i += CHUNK_SIZE) {
    chunks.push(content.slice(i, i + CHUNK_SIZE));
  }
  if (chunks.length === 0) chunks.push(new Uint8Array(0));
  log(5, `Split into ${chunks.length} chunk${chunks.length > 1 ? 's' : ''}`);

  // ── 2. Adler32 checksum over full content ──────────────────────────────────
  const checksum = adler32(content);
  log(10, `Checksum: 0x${checksum.toString(16)}`);

  // ── 3. Get lock script ────────────────────────────────────────────────────
  const addrObj = await signer.getRecommendedAddressObj();
  const lock = addrObj.script;
  log(15, 'Got lock script');

  // ── 4. Compute witness start index and encode cell data ──────────────────
  // witnessStartIndex = number of inputs (each gets one '0x' lock witness slot)
  // We don't know input count yet — use placeholder, recompute after input collection
  // For cell data encoding: use placeholder index 1 (will rebuild after inputs known)
  // CKBFS witnesses encoded separately, re-indexed after inputs collected
  log(18, 'Chunks ready, witnesses will be encoded after input collection…');

  // ── 5. Encode CKBFS witnesses (indices computed after input collection) ─────
  // We encode with placeholder indices first, then rebuild with correct ones after inputs known.
  // The head witness nextIndex is relative — we'll recompute after knowing input count.
  function buildWitnesses(startIndex) {
    return chunks.map((chunk, i) => {
      const isHead = i === 0;
      const isTail = i === chunks.length - 1;
      if (isHead) {
        return encodeHeadWitness({
          prevTxHash:       '0x' + '00'.repeat(32),
          prevWitnessIndex: 0,
          prevChecksum:     0,
          nextIndex:        isTail ? 0 : startIndex + i + 1,
          content:          chunk,
        });
      } else {
        return encodeContinuationWitness({
          nextIndex: isTail ? 0 : startIndex + i + 1,
          content:   chunk,
        });
      }
    });
  }

  function buildOutputData(startIndex) {
    return encodeCKBFSDataV3({
      index:       startIndex,
      checksum,
      contentType: contentType || 'application/octet-stream',
      filename:    filename || 'file',
    });
  }

  // ── 6. Pre-type script (zeroed args for capacity calc) ────────────────────
  const preTypeScript = ccc.Script.from({
    codeHash: contract.codeHash,
    hashType:  'data1',
    args:      '0x' + '00'.repeat(32),
  });

  // Cell capacity = (8 + lock.occupiedSize + type.occupiedSize + outputData.length) * 1e8
  // Use placeholder startIndex=1 for capacity estimate — close enough (1 CKB diff max)
  const _placeholderData = buildOutputData(1);
  const cellBytes = BigInt(8 + lock.occupiedSize + preTypeScript.occupiedSize + _placeholderData.length);
  const cellCapacity = cellBytes * BYTES_PER_SHANNON;
  log(22, `Cell capacity: ${Number(cellCapacity)/1e8} CKB (${cellBytes} bytes)`);
  log(22, `Cell capacity: ${Number(cellCapacity) / 1e8} CKB`);

  // ── 7. Build initial transaction — NO witnesses yet (added after input collection) ──
  // CRITICAL: witnesses must be added AFTER completeInputsByCapacity, because
  // CCC's addInput() inserts '0x' placeholders at inputs.length when witnesses.length > inputs.length,
  // which would push our CKBFS witnesses to wrong indices.
  log(25, 'Building transaction…');
  const preTx = ccc.Transaction.from({
    version: '0x0',
    cellDeps: [{
      outPoint: { txHash: contract.txHash, index: contract.index },
      depType: contract.depType,
    }],
    headerDeps: [],
    inputs: [],
    outputs: [{
      capacity: ccc.numToHex(cellCapacity),
      lock,
      type: preTypeScript,
    }],
    outputsData: [ccc.hexFrom(_placeholderData)],
    witnesses: [], // empty — filled after inputs collected
  });

  // ── 8. Collect inputs ─────────────────────────────────────────────────────
  log(40, 'Collecting inputs…');
  await preTx.completeInputsByCapacity(signer);

  // ── 9. Fee + change ───────────────────────────────────────────────────────
  log(55, 'Computing fee (without witnesses)…');
  await preTx.completeFeeChangeToLock(signer, lock, 2000);

  // ── 10. TypeID = hash(input[0], outputIndex=0) ───────────────────────────
  const typeIdArgs = ccc.hashTypeId(preTx.inputs[0], 0);

  // ── Now set witnesses and rebuild outputData with correct start index ───────
  const witnessStartIndex = preTx.inputs.length; // e.g. 1 or 2 inputs
  const ckbfsWitnesses = buildWitnesses(witnessStartIndex);
  const finalOutputData = buildOutputData(witnessStartIndex);

  preTx.witnesses = [
    ...Array.from({ length: preTx.inputs.length }, () => '0x'), // one slot per input
    ...ckbfsWitnesses.map(w => ccc.hexFrom(w)),
  ];
  preTx.outputsData[0] = ccc.hexFrom(finalOutputData);
  log(60, `Witnesses set: startIndex=${witnessStartIndex}, ${ckbfsWitnesses.length} CKBFS chunks`);
  const finalTypeScript = ccc.Script.from({
    codeHash: contract.codeHash,
    hashType:  'data1',
    args:      typeIdArgs,
  });

  // Rebuild with real TypeID
  const tx = ccc.Transaction.from({
    version:     preTx.version,
    cellDeps:    preTx.cellDeps,
    headerDeps:  preTx.headerDeps,
    inputs:      preTx.inputs,
    outputs: [{
      capacity: preTx.outputs[0].capacity,
      lock,
      type: finalTypeScript,
    }, ...preTx.outputs.slice(1)],
    outputsData: preTx.outputsData,
    witnesses:   preTx.witnesses,
  });

  log(70, 'Sending to JoyID for signature…');

  // ── 11. Sign + send ───────────────────────────────────────────────────────
  const txHash = await signer.sendTransaction(tx);
  log(100, `Confirmed! TX: ${txHash}`);

  return {
    txHash,
    typeId:      typeIdArgs,
    capacityCkb: Number(cellCapacity) / 1e8,
  };
}

/**
 * Estimate CKB needed for a CKBFS V3 upload (for cost panel).
 */
export function estimateCKBFSCost({ contentBytes, lockArgsBytes = 22 }) {
  const outputDataBytes = 60; // typical V3 cell data
  const typeSize   = 65;      // 32 + 1 + 32
  const lockSize   = 32 + 1 + lockArgsBytes;
  const cellBytes  = 8 + lockSize + typeSize + outputDataBytes;
  const chunkCount = Math.max(1, Math.ceil(contentBytes / CHUNK_SIZE));
  const witnessFee = chunkCount * (CHUNK_SIZE + 50) * 2000 / 1000; // shannons
  return cellBytes + 2 + witnessFee / 1e8;
}
