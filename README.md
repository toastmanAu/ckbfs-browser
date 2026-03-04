# @wyltek/ckbfs-browser

**Browser-native CKBFS V2 publisher for CKB.** Publish any file permanently to the CKB blockchain using any CCC-compatible signer — JoyID, MetaMask, hardware wallets, or raw private key. Zero server infrastructure. Zero Node.js dependencies.

> Built by [Wyltek Industries](https://wyltekindustries.com) while shipping the DOB Minter. If you've been waiting for browser-native CKBFS publishing, this is it.

---

## What is CKBFS?

[CKBFS](https://github.com/ckb-devrel/ckbfs) is an on-chain file storage protocol for CKB. Files are stored permanently in CKB transaction witnesses, referenced by a TypeID cell. A 76KB image costs ~225 CKB to store — locked in the index cell forever, file bytes prunable. Perfect for DOB/Spore content, on-chain media, and any dApp needing trustless file storage.

## Why this package?

The official `@ckbfs/api` SDK requires Node.js internals (`crypto`, `fs`). This package re-implements the CKBFS V2 publish flow using pure browser APIs + CCC for transaction construction — making it work in any browser, including iOS Safari.

---

## Install

```bash
npm install @wyltek/ckbfs-browser @ckb-ccc/core
```

## Usage

### Publish a file

```js
import { publishCKBFS } from '@wyltek/ckbfs-browser';

// signer = any CCC signer (JoyID, MetaMask, SignerCkbPrivateKey, etc.)
const result = await publishCKBFS({
  signer,
  content:     new Uint8Array(fileBytes),  // raw file bytes
  contentType: 'image/jpeg',
  filename:    'my-art.jpg',
  mainnet:     true,
  onProgress:  (pct, msg) => console.log(`${pct}% — ${msg}`),
});

console.log(result.uri);         // ckbfs://0xbdf595ff...
console.log(result.txHash);      // 0xd824b272...
console.log(result.typeId);      // 0xbdf595ff...
console.log(result.capacityCkb); // 225
```

### Estimate cost before publishing

```js
import { estimateCKBFSCost } from '@wyltek/ckbfs-browser';

const cost = estimateCKBFSCost(fileBytes.length);
// { indexCellCkb: 225, txFeeCkb: 0.011, totalCkb: 225.011, chunks: 3 }
```

### Resolve / fetch content back from chain

```js
import { resolveCKBFS } from '@wyltek/ckbfs-browser';

const file = await resolveCKBFS('0xbdf595ff...', 'mainnet', (msg) => console.log(msg));
// { fileBytes: Uint8Array, contentType: 'image/jpeg', filename: 'my-art.jpg', ... }

// Render an image:
const dataUrl = `data:${file.contentType};base64,${btoa(String.fromCharCode(...file.fileBytes))}`;
document.getElementById('img').src = dataUrl;
```

### Use a ckbfs:// URI as Spore/DOB content

CKBFS URIs work as Spore cell content with `contentType: 'text/uri-list'`:

```js
import { publishCKBFS } from '@wyltek/ckbfs-browser';
import { ccc, spore } from '@ckb-ccc/spore';

// 1. Publish content to CKBFS
const { uri } = await publishCKBFS({ signer, content, contentType, filename, mainnet: true });

// 2. Mint Spore referencing the CKBFS URI
const { tx, id } = await spore.createSpore({
  signer,
  data: {
    contentType: 'text/uri-list',
    content:     new TextEncoder().encode(uri),
  },
});
await signer.sendTransaction(tx);
```

---

## Transaction Layout

```
Inputs:   [signer cells covering 225+ CKB + fees]
Outputs:
  [0]  225 CKB  — CKBFS index cell
                   type: { codeHash: 0x31e637..., hashType: 'data1', args: TypeID }
                   data: molecule({ witnessIndexes, checksum, contentType, filename, version })
  [1]  change  — remainder back to signer

Witnesses:
  [0]  lock witness (secp256k1 / JoyID / etc.)
  [1]  CKBFS chunk 0: b"CKBFS\x00" + file_bytes[0:30KB]
  [2]  CKBFS chunk 1: b"CKBFS\x00" + file_bytes[30KB:60KB]
  ...
```

Files >30KB are automatically split into chunks. The metadata cell records which witness indices contain the chunks — resolvers reassemble them in order.

---

## Protocol

- **Version:** CKBFS V2
- **Contract code hash:** `0x31e6376287d223b8c0410d562fb422f04d1d617b2947596a14c3d2efb7218d3a`
- **Deployed:** 20241025 (mainnet + testnet)
- **Chunk size:** 30KB per witness
- **Cell capacity:** 225 CKB (locked permanently)
- **File bytes:** stored in witnesses (prunable by full nodes, always available from archive nodes and the CKB explorer)

---

## Requirements

- `@ckb-ccc/core` ≥ 1.0.0 (peer dependency)
- Modern browser with `fetch`, `TextEncoder`, `Uint8Array`
- Signer with ≥ 225 CKB + fees

---

## License

MIT — Wyltek Industries
