/**
 * Music, the message groups and the dialogue lines.
 *
 * Part of the bundle the exporter writes; see docs/formats/ for each block.
 */

export interface BgmJson {
  /** Both filename tables, indexed by `id & 0xFFF`. Holes are real nulls. */
  names: { ar: (string | null)[]; plain: (string | null)[] };
  default_table: "ar" | "plain";
  /** The stage's own track — named by convention, not started by the script. */
  stage_track: {
    index: number;
    id: number;
    ar: string | null;
    plain: string | null;
    note: string;
  } | null;
  game_mode: number;
}

/** The SE and voice name tables. Keys are decimal ids as strings. */
export interface MessageVariant {
  variant: number;
  /** 0 = 1P/player 1, 1 = 1P/player 2, 2 = 2P. */
  player_cfg: number;
  sprite: number;
  frames: number;
  /** Screen position in the game's 640x480 space. */
  x: number;
  y: number;
  voice: number;
  voice_file: string | null;
  /** The subtitle lines, in order. See `DialogueLine`. */
  lines?: DialogueLine[];
}

/**
 * One subtitle line of a dialogue variant.
 *
 * The task counts `frames` *down*, and steps to the next line whenever the
 * remaining count falls below this line's `end_frame` — so `end_frame` reads
 * as "frames still left when this line gives way", and the last line of a
 * variant has 0.
 */
export interface DialogueLine {
  line: number;
  text: string;
  /** Added to the centred position, in the game's 640-wide screen. */
  x_offset: number;
  end_frame: number;
}

/** One motion, baked flat so the client can index it without parsing. */
