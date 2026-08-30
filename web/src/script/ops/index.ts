/**
 * The opcode table, assembled from one module per category.
 *
 * `walker.ts` keeps the machine — addressing, stepping, waits and the branch
 * points — and each category registers its own entries here. Splitting it any
 * other way would put two halves of one opcode in two files.
 */
import type { OpImpl } from "../walker";
import { OPS as camera } from "./camera";
import { OPS as region } from "./region";
import { OPS as lighting } from "./lighting";
import { OPS as scene } from "./scene";
import { OPS as sound } from "./sound";
import { OPS as hud } from "./hud";
import { OPS as spawn } from "./spawn";
import { OPS as flow } from "./flow";
import { OPS as wait } from "./wait";

export const OPS: Record<number, OpImpl> = {
  ...camera,
  ...region,
  ...lighting,
  ...scene,
  ...sound,
  ...hud,
  ...spawn,
  ...flow,
  ...wait,
};
