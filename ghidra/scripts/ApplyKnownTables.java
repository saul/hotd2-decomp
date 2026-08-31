/* Turn every dispatch table this project has recovered into named functions.
 *
 * Ghidra's auto-analysis cannot reach a function whose only reference is an
 * entry in a table it did not recognise. That is most of the ".text that will
 * not form function bodies" recorded in Phase 1. Feeding it the tables fixes
 * it, and is the single cheapest way to raise code coverage on this binary.
 *
 * Run this first after a fresh import:
 *
 *     ./ghidra/run.sh script ApplyKnownTables.java      # reports only
 *     HOTD2_APPLY=1 ./ghidra/run.sh script ApplyKnownTables.java
 *
 * Tables applied (see docs/re/addresses.md and docs/formats/pipeline.md):
 *
 *   0x005931D8   96 entries   evt/ bytecode opcode handlers
 *   0x00593358   56 pairs     spawn class handlers {class_id, handler}
 *   0x00588C20    8 entries   asset job kinds
 *   0x0057A29C    7 entries   asset job sub-steps
 *   0x005776EC    7 groups    queue_event scripted actions, 16 each
 *
 * Naming keeps the table index in the symbol so a name can always be traced
 * back to its source, in the PascalCase style the rest of the project uses:
 *
 *   EvtOpScoreBonusSweep2B      opcode 0x2B
 *   EvtClassHandler41           spawn class 0x41
 *   AssetJobUnloadSlot2         job kind 2
 *   EvtActionCamPlay40          queue_event selector 0x40
 *
 * @category HOTD2
 */

import java.io.File;
import java.io.PrintWriter;
import java.util.LinkedHashMap;
import java.util.Map;

import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.SourceType;

public class ApplyKnownTables extends GhidraScript {

    private boolean apply;
    private int created, named, existed, failed;
    private final StringBuilder log = new StringBuilder();

    /* ---- evt opcode names, transcribed from all 96 handlers ---- */
    private static final String[] OPCODES = {
        "nop_stub", "spawn_placed_if_1p", "spawn_simple_if_1p", "spawn_obj_if_1p",
        "spawn_obj_c_if_1p", "spawn_placed_if_2p", "spawn_simple_if_2p", "spawn_obj_if_2p",
        "spawn_obj_c_if_2p", "spawn_placed", "spawn_simple", "spawn_obj",
        "spawn_obj_c", "spawn_obj_unless_skip", "set_slot_xyz", "set_lod_ids",
        "mark_hittest_a", "mark_hittest_b", "set_lod_ids_bias", "set_stage_params",
        "set_scene_lighting", "set_g_8d4c", "set_fog_or_clear3", "cam_pair_c",
        "cam_angles_a", "cam_angles_b", "set_g_8e58", "set_g_2c34",
        "set_g_a090", "set_g_8e50", "set_g_8a78", "set_g_a0f4",
        "view1_set", "view1_tween_rate", "view1_stop", "view1_tween_time",
        "view2_set", "view2_tween_rate", "view2_stop", "view2_tween_time",
        "region_load", "region_enter", "unused_2a", "score_bonus_sweep",
        "set_skip_flag", "call_35b80_u16", "se_if_skipping", "set_g_5c48",
        "queue_event", "cut_to", "cut_to_when_idle", "set_mode_and_pending",
        "unused_34", "set_g_21b0", "set_g_70f4", "set_g_a098",
        "se_play", "se_play_3d", "se_play_unless_skip", "se_play_3d_unless_skip",
        "unused_3c", "skip4", "skip2", "skip1",
        "wait_pending", "wait_cond_a", "wait_frames", "wait_cond_b",
        "wait_cond_c", "wait_flag", "wait_cond_d", "wait_ready",
        "set_flag", "variant_call_a", "variant_call_b", "variant_spawn",
        "unused_4c", "checkpoint", "halt", "advance_step",
        "asset_load_slot", "asset_unload_slot", "asset_load_polfile",
        "asset_free_polfile", "asset_load_texbank", "asset_free_texbank",
        "asset_job_8", "asset_job_9", "call_1d970", "call_1d9d0",
        "call_1da70", "skip1_b", "skip1_c", "call_1d3a0",
        "call_1d3b0", "call_1d450_4",
    };

    private static final String[] JOB_KINDS = {
        "dispatch_sub", "dispatch_sub_b", "unload_slot", "load_polfile_sub",
        "free_polfile", "free_all", "texbank_setup", "texbank_teardown",
    };

    private static final String[] JOB_SUBS = {
        "load_one_slot", "sub1", "read_polfile", "lz_decompress",
        "read_texfile", "bank_setup", "register_models",
    };

    /* Functions reached by call, not by table, but central enough to name. */
    private static final String[][] FIXED = {
        {"00401260", "RegionDrawResidentSet"},
        {"00401470", "RegionInit"},
        {"004014C0", "RegionBindSceneTables"},
        {"00401510", "RegionLoadDelta"},
        {"004015A0", "RegionUnloadDelta"},
        {"00402320", "EvtRunQueuedActions"},
        {"00403360", "EvtActionCamPlay40"},
        {"004033B0", "CamEvalStaticPose"},
        {"00404000", "CamBindPathSlots"},
        {"004040F0", "CamEvalHermiteCurve"},
        {"004041E0", "CamEvalPath7"},
        {"004042D0", "CamEvalObjectPath6"},
        {"00406310", "CheckSphereInFrustum"},
        {"00413120", "EvtRelocatePointers"},
        {"00418560", "AssetDrawSlot"},
        {"00418820", "AssetLoadOneSlot"},
        {"00418BA0", "AssetUnloadSlot"},
        {"00419200", "AssetGetBoundingSphere"},
        {"0041D5A0", "AssetRunJob"},
        {"0045ECC0", "EvtInterpreterLoop"},
        {"0045F000", "EvtAdvanceStepOrRoute"},
        {"004185E0", "SubmitSlotWithSceneLightArray"},
        {"00480CE0", "EvtOpSetSceneLighting14"},
        {"004A7630", "RenderInitStates"},
        {"004A79F0", "SetDrawLayerNibble"},
        {"004A7E50", "RenderEnqueueCommand"},
        {"004AA120", "SetLightingDefaultSingle"},
        {"004AA2B0", "RenderSubmitModelDefaultLight"},
        {"004AA500", "RenderSubmitModelSceneLights"},
        {"004AA8B0", "SetLightingSceneArray"},
    };

    /* queue_event selector -> name, for the 9 selectors the scripts use */
    private static final Map<Integer, String> ACTIONS = new LinkedHashMap<>();
    static {
        ACTIONS.put(0x10, "set_gun_enable");
        ACTIONS.put(0x11, "call_403bd0");
        ACTIONS.put(0x12, "action_12");
        ACTIONS.put(0x14, "action_14");
        ACTIONS.put(0x15, "action_15");
        ACTIONS.put(0x20, "cam_preset");
        ACTIONS.put(0x21, "cam_handoff");
        ACTIONS.put(0x40, "cam_play");       // 885 uses; args[2] = cam path slot
        ACTIONS.put(0x60, "cam_set6");
    }

    public void run() throws Exception {
        apply = "1".equals(System.getenv("HOTD2_APPLY"));

        long before = countCovered();

        // evt opcode handlers
        for (int op = 0; op < 96; op++) {
            long t = u32(0x005931D8L + op * 4);
            String nm = "EvtOp" + pascal(op < OPCODES.length ? OPCODES[op] : "unknown")
                    + String.format("%02X", op);
            handle(t, nm, "evt opcode 0x" + String.format("%02X", op));
        }

        // spawn class handlers: {class_id, handler} pairs, negative id ends
        for (int i = 0; i < 128; i++) {
            long cid = u32(0x00593358L + i * 8);
            if (cid > 0x6F) break;
            long t = u32(0x00593358L + i * 8 + 4);
            handle(t, String.format("EvtClassHandler%02X", cid),
                    "spawn class " + cid);
        }

        // asset job kinds and sub-steps
        for (int k = 0; k < JOB_KINDS.length; k++) {
            handle(u32(0x00588C20L + k * 4),
                    "AssetJob" + pascal(JOB_KINDS[k]) + k,
                    "asset job kind " + k);
        }
        for (int k = 0; k < JOB_SUBS.length; k++) {
            handle(u32(0x0057A29CL + k * 4),
                    "AssetSub" + pascal(JOB_SUBS[k]) + k,
                    "asset job sub-step " + k);
        }

        // queue_event actions: table[sel>>4][sel & 0xF]
        for (Map.Entry<Integer, String> e : ACTIONS.entrySet()) {
            int sel = e.getKey();
            long sub = u32(0x005776ECL + (sel >> 4) * 4);
            if (sub < 0x400000L || sub > 0x5D0000L) continue;
            handle(u32(sub + (sel & 0xF) * 4),
                    "EvtAction" + pascal(e.getValue()) + String.format("%02X", sel),
                    "queue_event selector 0x" + String.format("%02X", sel));
        }

        for (String[] fx : FIXED) {
            handle(Long.parseLong(fx[0], 16), fx[1], "core routine");
        }

        long after = countCovered();
        String summary = String.format(
                "[hotd2] apply=%b  created=%d named=%d existed=%d failed=%d  "
                + "covered bytes %d -> %d (+%d)",
                apply, created, named, existed, failed, before, after, after - before);
        println(summary);

        String out = System.getenv("HOTD2_OUT");
        if (out != null) {
            try (PrintWriter w = new PrintWriter(new File(out, "known_tables.txt"))) {
                w.println(summary);
                w.print(log);
            }
        }
    }

    /** snake_case -> PascalCase, to match the project's symbol convention. */
    private static String pascal(String s) {
        StringBuilder b = new StringBuilder();
        for (String part : s.split("_")) {
            if (part.isEmpty()) continue;
            b.append(Character.toUpperCase(part.charAt(0))).append(part.substring(1));
        }
        return b.toString();
    }

    private long u32(long va) throws Exception {
        return currentProgram.getMemory().getInt(toAddr(va)) & 0xFFFFFFFFL;
    }

    /** Create the function if missing, then name it if it is still default. */
    private void handle(long target, String name, String note) {
        if (target < 0x401000L || target > 0x4C4000L) return;
        Address a = toAddr(target);
        Listing lst = currentProgram.getListing();
        Function f = lst.getFunctionAt(a);

        if (f == null) {
            if (!apply) {
                log.append(String.format("would create %08X  %s%n", target, name));
                created++;
                return;
            }
            if (lst.getInstructionAt(a) == null) {
                new DisassembleCommand(a, null, true).applyTo(currentProgram, monitor);
            }
            if (!new CreateFunctionCmd(a).applyTo(currentProgram, monitor)) {
                log.append(String.format("FAILED   %08X  %s%n", target, name));
                failed++;
                return;
            }
            f = lst.getFunctionAt(a);
            created++;
        } else {
            existed++;
        }
        if (f == null) return;

        // Never overwrite a name a human already chose; only replace FUN_*.
        if (apply && f.getName().startsWith("FUN_")) {
            try {
                f.setName(name, SourceType.USER_DEFINED);
                f.setComment(note + " -- named by ApplyKnownTables.java from the "
                        + "dispatch tables documented in docs/re/addresses.md");
                named++;
                log.append(String.format("named    %08X  %s%n", target, name));
            } catch (Exception ex) {
                log.append(String.format("RENAME FAILED %08X %s: %s%n",
                        target, name, ex.getMessage()));
            }
        }
    }

    /** Bytes of .text inside some function body -- the Phase 1 coverage metric. */
    private long countCovered() {
        long n = 0;
        for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
            MemoryBlock b = currentProgram.getMemory().getBlock(f.getEntryPoint());
            if (b != null && b.getName().equals(".text")) {
                n += f.getBody().getNumAddresses();
            }
        }
        return n;
    }
}
