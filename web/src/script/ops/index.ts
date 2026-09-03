/**
 * The opcode table, assembled from one module per category.
 *
 * `walker.ts` keeps the machine — addressing, stepping, waits and the branch
 * points — and each category registers its own entries here. Splitting it any
 * other way would put two halves of one opcode in two files.
 *
 * Assembled with {@link mergeTables} rather than a spread, because a spread
 * has one behaviour for a collision and it is silence: `{ ...camera,
 * ...collision }` where both name `0x30` keeps whichever came last, and the
 * table cannot then tell "this opcode moved category" from "two modules
 * implement it and disagree". Ten modules and eighty-odd opcodes is where
 * moving one into the wrong file stops being unthinkable. It throws at module
 * load, so it cannot reach a build.
 */
import type { OpImpl } from "../walker";
import { hexKey, mergeTables } from "../registry";
import { OPS as camera } from "./camera";
import { OPS as collision } from "./collision";
import { OPS as region } from "./region";
import { OPS as lighting } from "./lighting";
import { OPS as scene } from "./scene";
import { OPS as sound } from "./sound";
import { OPS as hud } from "./hud";
import { OPS as spawn } from "./spawn";
import { OPS as flow } from "./flow";
import { OPS as wait } from "./wait";

export const OPS: Record<number, OpImpl> =
  mergeTables<Record<number, OpImpl>>("opcode", [
    ["camera", camera],
    ["collision", collision],
    ["region", region],
    ["lighting", lighting],
    ["scene", scene],
    ["sound", sound],
    ["hud", hud],
    ["spawn", spawn],
    ["flow", flow],
    ["wait", wait],
  ], hexKey);
