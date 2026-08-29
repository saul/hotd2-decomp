/* Recover and label the evt/ bytecode VM's opcode handlers.
 *
 * The event interpreter FUN_0045ECC0 dispatches through a 96-entry function
 * pointer table at 0x005931D8, indexed by the opcode dword:
 *
 *     do { op = *pc; dispatch[op](); } while (!yield);
 *
 * Auto-analysis failed to form function bodies for 31 of the 84 distinct
 * targets -- they are part of the ~30% of .text that RecoverCodeGaps.java
 * could not reach, because nothing reaches them except this table. The table
 * itself is the fix: it is 96 known-good entry points.
 *
 * This script is the reproducible form of what Session 11 did interactively
 * over MCP. It creates any missing functions, names them by opcode, and adds a
 * plate comment recording the opcode and its operand encoding.
 *
 * Set HOTD2_APPLY=1 to make changes; otherwise it only reports.
 *
 * @category HOTD2
 */

import java.io.File;
import java.io.PrintWriter;

import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.symbol.SourceType;

public class RecoverEventHandlers extends GhidraScript {

    private static final long DISPATCH_TABLE = 0x005931D8L;
    private static final int OPCODE_COUNT = 96;

    /* Handler names, transcribed from the decompilation of all 96 slots.
     * Kept in sync with OPCODES in tools/hod2lib/evt.py -- that table is the
     * authority for operand lengths; this one only supplies symbol names. */
    private static final String[] NAMES = {
        "nop_stub", "spawn_if_mode1_a", "spawn_if_mode1_b", "spawn_if_mode1_c",
        "spawn_if_mode1_d", "spawn_if_mode2_a", "spawn_if_mode2_b", "spawn_if_mode2_c",
        "spawn_if_mode2_d", "spawn_placed", "spawn_simple", "spawn_obj",
        "spawn_obj_c", "spawn_obj_unless_skip", "set_slot_xyz", "set_pending_ids",
        "mark_list_a", "mark_list_b", "set_pending_ids_bias", "set_stage_params",
        "set_g_2bb4", "set_g_8d4c", "set_fog_or_clear3", "cam_pair_c",
        "cam_pair_a", "cam_pair_b", "set_g_8e58", "set_g_2c34",
        "set_g_a090", "set_g_8e50", "set_g_8a78", "set_g_a0f4",
        "view1_set", "view1_tween_rate", "view1_stop", "view1_tween_time",
        "view2_set", "view2_tween_rate", "view2_stop", "view2_tween_time",
        "bgm_restore", "bgm_set", "unused_2a", "score_bonus_sweep",
        "set_skip_flag", "call_35b80_u16", "se_if_skipping", "set_g_5c48",
        "queue_event", "cut_to", "cut_to_when_idle", "set_mode_and_pending",
        "unused_34", "set_g_21b0", "set_g_70f4", "set_g_a098",
        "se_play", "se_play_3d", "se_play_unless_skip", "se_play_3d_unless_skip",
        "unused_3c", "skip4", "skip2", "skip1",
        "wait_pending", "wait_cond_a", "wait_frames", "wait_cond_b",
        "wait_cond_c", "wait_flag", "wait_cond_d", "wait_ready",
        "set_flag", "variant_call_a", "variant_call_b", "variant_spawn",
        "unused_4c", "checkpoint", "halt", "end_block",
        "call_1d5d0", "call_1d610", "voice_a", "voice_b",
        "call_1d6d0", "call_1d710", "call_1d750", "call_1d790",
        "call_1d970", "call_1d9d0", "call_1da70", "skip1_b",
        "skip1_c", "call_1d3a0", "call_1d3b0", "call_1d450_4",
    };

    public void run() throws Exception {
        boolean apply = "1".equals(System.getenv("HOTD2_APPLY"));
        Listing listing = currentProgram.getListing();
        Address table = toAddr(DISPATCH_TABLE);

        int existed = 0, created = 0, failed = 0, named = 0;
        StringBuilder report = new StringBuilder();

        // A target may serve several opcodes (the empty stub serves five).
        // Name by the lowest opcode that uses it.
        java.util.LinkedHashMap<Long, Integer> firstUse = new java.util.LinkedHashMap<>();
        for (int op = 0; op < OPCODE_COUNT; op++) {
            long target = currentProgram.getMemory().getInt(table.add(op * 4L)) & 0xFFFFFFFFL;
            firstUse.putIfAbsent(target, op);
        }

        for (java.util.Map.Entry<Long, Integer> e : firstUse.entrySet()) {
            Address addr = toAddr(e.getKey());
            int op = e.getValue();
            Function fn = listing.getFunctionAt(addr);

            if (fn == null) {
                if (!apply) {
                    report.append(String.format("  would create %08X  (opcode %02X %s)%n",
                            e.getKey(), op, NAMES[op]));
                    created++;
                    continue;
                }
                if (listing.getInstructionAt(addr) == null) {
                    new DisassembleCommand(addr, null, true).applyTo(currentProgram, monitor);
                }
                CreateFunctionCmd cmd = new CreateFunctionCmd(addr);
                if (!cmd.applyTo(currentProgram, monitor)) {
                    report.append(String.format("  FAILED  %08X  (opcode %02X)%n", e.getKey(), op));
                    failed++;
                    continue;
                }
                fn = listing.getFunctionAt(addr);
                created++;
            } else {
                existed++;
            }

            if (apply && fn != null && fn.getName().startsWith("FUN_")) {
                fn.setName("evt_op_" + String.format("%02x_", op) + NAMES[op],
                        SourceType.USER_DEFINED);
                fn.setComment("evt/ bytecode opcode 0x" + String.format("%02X", op)
                        + " -- dispatched from FUN_0045ECC0 via the table at 0x005931D8.\n"
                        + "Operand encoding is recorded in tools/hod2lib/evt.py (OPCODES).");
                named++;
            }
        }

        String summary = String.format(
                "[hotd2] dispatch targets=%d existed=%d created=%d failed=%d named=%d apply=%b",
                firstUse.size(), existed, created, failed, named, apply);
        println(summary);
        print(report.toString());

        String out = System.getenv("HOTD2_OUT");
        if (out != null) {
            try (PrintWriter w = new PrintWriter(new File(out, "event_handlers.txt"))) {
                w.println(summary);
                w.print(report);
                for (int op = 0; op < OPCODE_COUNT; op++) {
                    long t = currentProgram.getMemory().getInt(table.add(op * 4L)) & 0xFFFFFFFFL;
                    w.printf("%02X  %08X  %s%n", op, t, NAMES[op]);
                }
            }
        }
    }
}
