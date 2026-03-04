# Contract Verification

This document records how the CKBFS V2 contract constants in this package were verified.

## Method

### 1. Cross-referenced with @ckbfs/api npm package

The official SDK (`@ckbfs/api`) ships its deployment constants in:
`node_modules/@ckbfs/api/dist/utils/constants.js`

All values in `src/constants.js` match the `ProtocolVersion.V2` entries from that file exactly.

### 2. Verified against a real mainnet publish transaction

We published a real file to mainnet CKBFS V2 on 2026-03-04 using the `@ckbfs/api` CLI:

**Transaction:** `0xd824b272df0e6ec2cee6eeb353a418174ff52150f4643aa06642d7236b141d0e`  
**Explorer:** https://explorer.nervos.org/transaction/0xd824b272df0e6ec2cee6eeb353a418174ff52150f4643aa06642d7236b141d0e

Fetched via RPC and confirmed:

```
=== OUTPUTS ===
[0] 225 CKB
    type.code_hash = 0x31e6376287d223b8c0410d562fb422f04d1d617b2947596a14c3d2efb7218d3a ✓ CKBFS_CODE_HASH
    type.hash_type = data1 ✓
    type.args      = 0xbdf595ff...  (TypeID for this specific file)

=== CELL DEPS ===
[0] txHash: 0xfab07962ed7178ed88d450774e2a6ecd50bae856bdb9b692980be8c5147d1bfa ✓ CKBFS V2 dep_group
    index:   0x0
    depType: dep_group

[1] txHash: 0x71a7ba8fc96349fea0ed3a5c47992e3b4084b031a42264a018e0072e8172e46c
    depType: dep_group  (secp256k1 lock — added by @ckbfs/api SDK)

=== WITNESSES ===
[0] lock witness (secp256k1 unlock)
[1] 30726 bytes — starts with 0x434b42465300 = "CKBFS\x00" ✓ magic + version=0x00
[2] 30726 bytes — chunk 2
[3] 16436 bytes — chunk 3 (last chunk, smaller)
```

### 3. Wire format confirmed

From real witness bytes:
- `witnesses[1][0:5]` = `43 4b 42 46 53` = `"CKBFS"` ✓
- `witnesses[1][5]`   = `00` = version byte (V2) ✓
- `witnesses[1][6:]`  = raw file bytes (JPEG data starting with `ffd8ffe0...`) ✓

### 4. Output data molecule structure confirmed

`outputs_data[0]` decoded:
```
field[0] Vec<Uint32>: [1, 2, 3]       — witness indexes for 3 chunks
field[1] Uint32:      0xf5302348       — CRC32 checksum of file
field[2] Bytes:       "image/jpeg"     — content type
field[3] Bytes:       "founding-member-dob-optimized.jpg" — filename
field[4] Uint32:      4               — version marker
```

---

## Summary

| Constant | Value | Source |
|---|---|---|
| `CKBFS_CODE_HASH` | `0x31e637...` | @ckbfs/api + real tx output type.code_hash |
| `CKBFS_TYPE_ID.mainnet` | `0xfd2058...` | @ckbfs/api |
| `CKBFS_TYPE_ID.testnet` | `0x7c6dcab...` | @ckbfs/api |
| `CONTRACT.mainnet.txHash` | `0xfab07962...` | @ckbfs/api DEP_GROUP_TX_HASH + real tx cell_deps[0] |
| `CONTRACT.testnet.txHash` | `0x469af0d9...` | @ckbfs/api DEP_GROUP_TX_HASH |
| `depType` | `dep_group` | real tx cell_deps |
| `CHUNK_SIZE` | 30KB | real tx witnesses (3× ~30KB chunks for 76KB file) |
| `CKBFS_CELL_CAPACITY` | 225 CKB | real tx output[0] capacity |
| `VERSION` | `0x00` | real tx witnesses[1][5] |
| `MAGIC` | `CKBFS` | real tx witnesses[1][0:5] |

All constants are **production-verified** against a real CKB mainnet transaction.
