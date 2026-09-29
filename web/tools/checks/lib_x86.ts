/**
 * A linear-sweep x86-32 decoder that knows each instruction's length, the
 * mnemonic of the few instructions a check selects by one, and its immediate
 * operands -- and nothing else.
 *
 * A check that asks "which instructions in this range have an immediate of
 * `0x80000`" needs exactly that much of a disassembler. The sweep keeps the
 * conventions of capstone's x86-32 mode with SKIPDATA on: a range decodes
 * from its first byte, a byte that begins no valid instruction is reported as
 * a one-byte `.byte` and the sweep resumes at the next, a relative branch's
 * immediate is its absolute target, an 8-bit immediate the instruction
 * sign-extends is reported sign-extended to 32 bits, and a shift by one
 * (`D0`/`D1`) carries the immediate 1. Embedded jump tables decode as
 * whatever instructions their bytes spell, as they do in any linear sweep.
 * Over the whole of `Hod2.exe`'s `.text` it finds the same boundaries, the
 * same immediates and the same shift and bit-test mnemonics capstone does.
 *
 * Covered: the one-byte map, x87 with its undefined register forms refused,
 * `LOCK` only where it is defined, and the two-byte map through SSE2, MMX and
 * 3DNow!, with the operand- and address-size prefixes. The three-byte maps
 * (`0F 38`, `0F 3A`) are decoded for length only.
 */

/** One decoded instruction. */
export interface X86Insn {
  /** Virtual address of its first byte, prefixes included. */
  address: number;
  /** Bytes it occupies; 1 for a skipped byte. */
  size: number;
  /**
   * The mnemonic, for the instructions a caller may select by one: the shift
   * and rotate group, the bit tests, `push`, `call` and `jmp`, and `.byte`
   * for a skipped byte. Everything else is `""`.
   */
  mnemonic: string;
  /** Immediate operands as unsigned 32-bit values, in operand order. */
  imms: number[];
}

enum Imm { None, B, BS, W, Z, ZW, WB, Rel8, RelZ, ModrmDep }

interface Op {
  modrm: boolean;
  imm: Imm;
  /** Set for the opcodes whose reg field names the mnemonic. */
  group?: readonly string[];
  /** A fixed mnemonic. */
  name?: string;
  /** `0F 0F`: the byte after the operands is a 3DNow! opcode, not an immediate. */
  suffix3dnow?: boolean;
  invalid?: boolean;
}

const SHIFT_GROUP = ["rol", "ror", "rcl", "rcr", "shl", "shr", "sal", "sar"];
const BT_GROUP = ["", "", "", "", "bt", "bts", "btr", "btc"];

const INVALID: Op = { modrm: false, imm: Imm.None, invalid: true };
const PLAIN: Op = { modrm: false, imm: Imm.None };
const RM: Op = { modrm: true, imm: Imm.None };

function oneByte(op: number): Op {
  // The eight ALU rows: r/m,r ; r,r/m (both widths) ; AL,ib ; eAX,iz.
  if (op < 0x40 && (op & 7) < 6) {
    const k = op & 7;
    if (k < 4) return RM;
    return { modrm: false, imm: k === 4 ? Imm.B : Imm.Z };
  }
  if (op >= 0x40 && op <= 0x5f) {
    return { modrm: false, imm: Imm.None, name: op >= 0x50 && op <= 0x57 ? "push" : "" };
  }
  if (op >= 0x70 && op <= 0x7f) return { modrm: false, imm: Imm.Rel8 };
  if (op >= 0x90 && op <= 0x97) return PLAIN;
  if (op >= 0xb0 && op <= 0xb7) return { modrm: false, imm: Imm.B };
  if (op >= 0xb8 && op <= 0xbf) return { modrm: false, imm: Imm.Z };
  if (op >= 0xd8 && op <= 0xdf) return RM;                  // x87
  switch (op) {
    case 0x06: case 0x07: case 0x0e: case 0x16: case 0x17: case 0x1e: case 0x1f:
    case 0x27: case 0x2f: case 0x37: case 0x3f:
      return PLAIN;
    case 0x60: case 0x61: return PLAIN;
    case 0x62: case 0x63: return RM;
    case 0x68: return { modrm: false, imm: Imm.Z, name: "push" };
    case 0x69: return { modrm: true, imm: Imm.Z };
    case 0x6a: return { modrm: false, imm: Imm.BS, name: "push" };
    case 0x6b: return { modrm: true, imm: Imm.BS };
    case 0x6c: case 0x6d: case 0x6e: case 0x6f: return PLAIN;
    case 0x80: case 0x82: return { modrm: true, imm: Imm.B };
    case 0x81: return { modrm: true, imm: Imm.Z };
    case 0x83: return { modrm: true, imm: Imm.BS };
    case 0x84: case 0x85: case 0x86: case 0x87:
    case 0x88: case 0x89: case 0x8a: case 0x8b:
    case 0x8c: case 0x8d: case 0x8e: case 0x8f:
      return RM;
    case 0x98: case 0x99: case 0x9b: case 0x9c: case 0x9d: case 0x9e: case 0x9f:
      return PLAIN;
    case 0x9a: return { modrm: false, imm: Imm.ZW, name: "call" };
    case 0xa0: case 0xa1: case 0xa2: case 0xa3:
      return { modrm: false, imm: Imm.None, name: "moffs" };
    case 0xa4: case 0xa5: case 0xa6: case 0xa7:
    case 0xaa: case 0xab: case 0xac: case 0xad: case 0xae: case 0xaf:
      return PLAIN;
    case 0xa8: return { modrm: false, imm: Imm.B };
    case 0xa9: return { modrm: false, imm: Imm.Z };
    case 0xc0: return { modrm: true, imm: Imm.B, group: SHIFT_GROUP };
    case 0xc1: return { modrm: true, imm: Imm.B, group: SHIFT_GROUP };
    case 0xc2: case 0xca: return { modrm: false, imm: Imm.W };
    case 0xc3: case 0xcb: case 0xc9: case 0xcc: case 0xce: case 0xcf:
      return PLAIN;
    case 0xc4: case 0xc5: return RM;
    case 0xc6: return { modrm: true, imm: Imm.B };
    case 0xc7: return { modrm: true, imm: Imm.Z };
    case 0xc8: return { modrm: false, imm: Imm.WB };
    case 0xcd: return { modrm: false, imm: Imm.B };
    case 0xd0: case 0xd1: case 0xd2: case 0xd3:
      return { modrm: true, imm: Imm.None, group: SHIFT_GROUP };
    case 0xd4: case 0xd5: return { modrm: false, imm: Imm.B };
    case 0xd6: case 0xd7: return PLAIN;
    case 0xe0: case 0xe1: case 0xe2: case 0xe3: return { modrm: false, imm: Imm.Rel8 };
    case 0xe4: case 0xe5: case 0xe6: case 0xe7: return { modrm: false, imm: Imm.B };
    case 0xe8: return { modrm: false, imm: Imm.RelZ, name: "call" };
    case 0xe9: return { modrm: false, imm: Imm.RelZ, name: "jmp" };
    case 0xea: return { modrm: false, imm: Imm.ZW, name: "jmp" };
    case 0xeb: return { modrm: false, imm: Imm.Rel8, name: "jmp" };
    case 0xec: case 0xed: case 0xee: case 0xef: return PLAIN;
    case 0xf1: case 0xf4: case 0xf5: return PLAIN;
    case 0xf6: case 0xf7: return { modrm: true, imm: Imm.ModrmDep };
    case 0xf8: case 0xf9: case 0xfa: case 0xfb: case 0xfc: case 0xfd: return PLAIN;
    case 0xfe: case 0xff: return RM;
  }
  return INVALID;
}

function twoByte(op: number): Op {
  if (op >= 0x80 && op <= 0x8f) return { modrm: false, imm: Imm.RelZ };
  if (op >= 0x90 && op <= 0x9f) return RM;                  // setcc
  if (op >= 0x40 && op <= 0x4f) return RM;                  // cmovcc
  if (op >= 0xc8 && op <= 0xcf) return PLAIN;               // bswap
  if (op >= 0x10 && op <= 0x17) return RM;
  if (op >= 0x18 && op <= 0x1f) return RM;                  // prefetch, hint nop
  if (op >= 0x20 && op <= 0x23) return RM;                  // mov cr/dr
  if (op >= 0x28 && op <= 0x2f) return RM;
  if (op >= 0x50 && op <= 0x6f) return RM;
  if (op >= 0x74 && op <= 0x76) return RM;
  if (op >= 0xd0 && op <= 0xfe) return RM;
  switch (op) {
    case 0x00: case 0x01: case 0x02: case 0x03: return RM;
    case 0x05: case 0x06: case 0x07: case 0x08: case 0x09: case 0x0b:
    case 0x0e: case 0x30: case 0x31: case 0x32: case 0x33: case 0x34: case 0x35:
    case 0x77: case 0xa0: case 0xa1: case 0xa2: case 0xa8: case 0xa9: case 0xaa:
      return PLAIN;
    case 0x0d: return RM;
    case 0x0f: return { modrm: true, imm: Imm.B, suffix3dnow: true };
    case 0x70: return { modrm: true, imm: Imm.B };
    case 0x71: case 0x72: case 0x73: return { modrm: true, imm: Imm.B };
    case 0x7e: case 0x7f: return RM;
    case 0xa3: return { modrm: true, imm: Imm.None, name: "bt" };
    case 0xab: return { modrm: true, imm: Imm.None, name: "bts" };
    case 0xb3: return { modrm: true, imm: Imm.None, name: "btr" };
    case 0xbb: return { modrm: true, imm: Imm.None, name: "btc" };
    case 0xa4: case 0xac: return { modrm: true, imm: Imm.B };
    case 0xa5: case 0xad: return RM;
    case 0xae: case 0xaf: return RM;
    case 0xb0: case 0xb1: case 0xb2: case 0xb4: case 0xb5:
    case 0xb6: case 0xb7: case 0xb9: case 0xbc: case 0xbd: case 0xbe: case 0xbf:
      return RM;
    case 0xba: return { modrm: true, imm: Imm.B, group: BT_GROUP };
    case 0xc0: case 0xc1: case 0xc3: case 0xc7: return RM;
    case 0xc2: case 0xc4: case 0xc5: case 0xc6: return { modrm: true, imm: Imm.B };
  }
  return INVALID;
}

const PREFIXES = new Set([0xf0, 0xf2, 0xf3, 0x2e, 0x36, 0x3e, 0x26, 0x64, 0x65, 0x66, 0x67]);

/** The 3DNow! operations, by the suffix byte that names them. */
const AMD3DNOW = new Set([
  0x0c, 0x0d, 0x1c, 0x1d, 0x8a, 0x8e, 0x90, 0x94, 0x96, 0x97, 0x9a, 0x9e,
  0xa0, 0xa4, 0xa6, 0xa7, 0xaa, 0xae, 0xb0, 0xb4, 0xb6, 0xb7, 0xbb, 0xbf,
]);

/** One-byte opcodes that take `LOCK` (with a memory destination). */
const LOCKABLE_1 = new Set([
  0x00, 0x01, 0x08, 0x09, 0x10, 0x11, 0x18, 0x19, 0x20, 0x21, 0x28, 0x29,
  0x30, 0x31, 0x80, 0x81, 0x82, 0x83, 0x86, 0x87, 0xf6, 0xf7, 0xfe, 0xff,
]);
/** ...and two-byte ones. */
const LOCKABLE_2 = new Set([0xab, 0xb3, 0xbb, 0xba, 0xb0, 0xb1, 0xc0, 0xc1, 0xc7]);

/**
 * Whether an x87 register form (`mod == 3`) is defined. The memory forms of
 * every x87 opcode are, except the reg values {@link x87MemValid} refuses.
 */
function x87RegValid(op: number, m: number): boolean {
  switch (op) {
    case 0xd8: case 0xdc: return true;
    case 0xd9:
      return m <= 0xd0 || m === 0xe0 || m === 0xe1 || m === 0xe4 || m === 0xe5
        || (m >= 0xe8 && m <= 0xee) || m >= 0xf0;
    case 0xda: return m <= 0xdf || m === 0xe9;
    case 0xdb: return m <= 0xdf || (m >= 0xe2 && m <= 0xe3) || (m >= 0xe8 && m <= 0xf7);
    case 0xdd: return m <= 0xc7 || (m >= 0xd0 && m <= 0xef);
    case 0xde: return m <= 0xcf || m === 0xd9 || m >= 0xe0;
    case 0xdf: return m === 0xe0 || (m >= 0xe8 && m <= 0xf7);
  }
  return false;
}

/** Whether an x87 memory form is defined: the reg values each opcode leaves out. */
function x87MemValid(op: number, reg: number): boolean {
  if (op === 0xd9) return reg !== 1;
  if (op === 0xdb) return reg !== 4 && reg !== 6;
  if (op === 0xdd) return reg !== 5;
  return true;
}

/** The bytes a ModRM (and its SIB and displacement) occupy, from `at`. */
function modrmLength(code: Uint8Array, at: number, addr16: boolean): number {
  const m = code[at];
  const mod = m >> 6;
  const rm = m & 7;
  if (mod === 3) return 1;
  if (addr16) {
    if (mod === 0) return rm === 6 ? 3 : 1;
    return mod === 1 ? 2 : 3;
  }
  let n = 1;
  if (rm === 4) {
    const base = code[at + 1] & 7;
    n += 1;
    if (mod === 0 && base === 5) return n + 4;
  } else if (mod === 0 && rm === 5) {
    return n + 4;
  }
  if (mod === 1) n += 1;
  else if (mod === 2) n += 4;
  return n;
}

function sext8(v: number): number { return v & 0x80 ? v - 0x100 : v; }

/** Decode one instruction at `code[pos]`, or null when it does not decode. */
function decodeOne(code: Uint8Array, pos: number, va: number): X86Insn | null {
  let p = pos;
  let opsize16 = false;
  let addr16 = false;
  let lock = false;
  while (p < code.length && PREFIXES.has(code[p]) && p - pos < 14) {
    if (code[p] === 0x66) opsize16 = true;
    if (code[p] === 0x67) addr16 = true;
    if (code[p] === 0xf0) lock = true;
    p++;
  }
  if (p >= code.length) return null;
  let op: Op;
  const b0 = code[p++];
  let b1 = -1;
  if (b0 === 0x0f) {
    if (p >= code.length) return null;
    b1 = code[p++];
    if (b1 === 0x38 || b1 === 0x3a) {
      if (p >= code.length) return null;
      p++;                                       // the third opcode byte
      op = { modrm: true, imm: b1 === 0x3a ? Imm.B : Imm.None };
    } else {
      op = twoByte(b1);
    }
  } else {
    op = oneByte(b0);
  }
  if (op.invalid) return null;

  let mnemonic = op.name ?? "";
  let reg = 0;
  if (lock && !op.modrm) return null;
  if (op.modrm) {
    if (p >= code.length) return null;
    reg = (code[p] >> 3) & 7;
    const mod = code[p] >> 6;
    // Encodings a disassembler refuses: a register form of an opcode that
    // only takes memory, and the reg values a group leaves undefined.
    if (b0 === 0x8d && mod === 3) return null;              // lea r, r
    if ((b0 === 0xc4 || b0 === 0xc5 || b0 === 0x62) && mod === 3) return null;
    if (b0 === 0x8f && reg !== 0) return null;
    if ((b0 === 0xc6 || b0 === 0xc7) && reg !== 0) return null;
    if (b0 === 0xfe && reg > 1) return null;
    if (b0 === 0xff && reg === 7) return null;
    if (b0 === 0x8c && reg > 5) return null;
    if (b0 === 0x8e && (reg > 5 || reg === 1)) return null;
    if (b0 >= 0xd8 && b0 <= 0xdf
        && !(mod === 3 ? x87RegValid(b0, code[p]) : x87MemValid(b0, reg))) return null;
    if (b1 === 0xc7 && !(reg === 1 ? mod !== 3 : (reg >= 6 && mod === 3))) return null;
    if (lock) {
      const lockable = b1 < 0 ? LOCKABLE_1.has(b0) : LOCKABLE_2.has(b1);
      if (!lockable || mod === 3) return null;
      if ((b0 >= 0x80 && b0 <= 0x83) && reg === 7) return null;      // cmp
      if ((b0 === 0xf6 || b0 === 0xf7) && reg !== 2 && reg !== 3) return null;
      if (b1 === 0xba && reg < 5) return null;
    }
    if (op.group) {
      mnemonic = op.group[reg];
      if (!mnemonic) return null;                         // 0F BA /0-/3
    }
    if (b0 === 0xff && reg === 6) mnemonic = "push";
    if (b0 === 0xff && (reg === 2 || reg === 3)) mnemonic = "call";
    if (b0 === 0xff && (reg === 4 || reg === 5)) mnemonic = "jmp";
    const n = modrmLength(code, p, addr16);
    p += n;
  }

  const imms: number[] = [];
  const need = (k: number): boolean => p + k <= code.length;
  const zs = opsize16 ? 2 : 4;
  const readZ = (): number => {
    const v = zs === 2 ? code[p] | (code[p + 1] << 8)
      : (code[p] | (code[p + 1] << 8) | (code[p + 2] << 16) | (code[p + 3] << 24)) >>> 0;
    p += zs;
    return v;
  };
  switch (op.imm) {
    case Imm.None: break;
    case Imm.B:
      if (!need(1)) return null;
      if (op.suffix3dnow) {
        if (!AMD3DNOW.has(code[p])) return null;
      } else {
        imms.push(code[p]);
      }
      p += 1;
      break;
    case Imm.BS:
      // Sign-extended to 32 bits whatever the operand size, as a
      // disassembler reports it.
      if (!need(1)) return null;
      imms.push(sext8(code[p]) >>> 0);
      p += 1;
      break;
    case Imm.W:
      if (!need(2)) return null;
      imms.push(code[p] | (code[p + 1] << 8));
      p += 2;
      break;
    case Imm.Z:
      if (!need(zs)) return null;
      imms.push(readZ());
      break;
    case Imm.ZW: {
      if (!need(zs + 2)) return null;
      const off = readZ();
      imms.push(code[p] | (code[p + 1] << 8), off);
      p += 2;
      break;
    }
    case Imm.WB:
      if (!need(3)) return null;
      imms.push(code[p] | (code[p + 1] << 8), sext8(code[p + 2]) >>> 0);
      p += 3;
      break;
    case Imm.Rel8: {
      if (!need(1)) return null;
      const rel = sext8(code[p]);
      p += 1;
      imms.push((va + (p - pos) + rel) >>> 0);
      break;
    }
    case Imm.RelZ: {
      if (!need(zs)) return null;
      const raw = readZ();
      const rel = zs === 2 ? (raw << 16) >> 16 : raw | 0;
      imms.push((va + (p - pos) + rel) >>> 0);
      break;
    }
    case Imm.ModrmDep:                                     // F6/F7: test takes one
      if (reg === 0 || reg === 1) {
        const k = b0 === 0xf6 ? 1 : zs;
        if (!need(k)) return null;
        imms.push(k === 1 ? code[p++] : readZ());
      }
      break;
  }
  if (b0 === 0xa0 || b0 === 0xa1 || b0 === 0xa2 || b0 === 0xa3) {
    const k = addr16 ? 2 : 4;
    if (!need(k)) return null;
    p += k;
    mnemonic = "";
  }
  if ((b0 === 0xd0 || b0 === 0xd1) && op.group) imms.push(1);
  return { address: va, size: p - pos, mnemonic, imms };
}

/**
 * Every instruction in `code`, which starts at virtual address `va`, in
 * address order. A byte that begins no instruction is reported as a one-byte
 * `.byte` and the sweep carries on from the next.
 */
export function sweep(code: Uint8Array, va: number): X86Insn[] {
  const out: X86Insn[] = [];
  let pos = 0;
  while (pos < code.length) {
    const ins = decodeOne(code, pos, (va + pos) >>> 0);
    if (ins) {
      out.push(ins);
      pos += ins.size;
    } else {
      out.push({ address: (va + pos) >>> 0, size: 1, mnemonic: ".byte", imms: [] });
      pos += 1;
    }
  }
  return out;
}
