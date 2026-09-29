/* Undo what a wrong no-return flag did to every caller, and stop it recurring.
 *
 *     ./ghidra/run.sh script RepairFlowDamage.java            # report only
 *     HOTD2_APPLY=1 ./ghidra/run.sh script RepairFlowDamage.java
 *
 * Run it after ApplyAnnotations, which sets the flags prototypes.tsv declares;
 * this repairs the call sites those flags left behind. `rebuild` does both.
 *
 * == What went wrong (L89) ==
 *
 * Ghidra's "Non-Returning Functions - Discovered" analyzer decides a function
 * never returns when three of its call sites are followed by something that
 * does not look like code, and its "Repair Flow Damage" option then writes a
 * CALL_RETURN flow override on **every** call site: the call is treated as
 * the function's last act, the bytes after it fall out of the body, and the
 * decompiler prints `MatrixStackPop(1); return;` with no warning at all.
 *
 * A fresh import does not do this -- it flags `_longjmp` and `__exit` and
 * nothing else. The live database was damaged later, by the incremental
 * auto-analysis the GUI runs whenever code is created in it, and it flagged
 * `MatrixStackPop` (707 callers) and `PlaySoundId` (498). Clearing
 * `MatrixStackPop`'s flag afterwards cleared nothing at its call sites: 1,085
 * overrides were still there, 59,534 bytes of code were outside the function
 * they belong to, and 517 functions decompiled short -- which five lessons,
 * each learned separately, had taught sessions to read around.
 *
 * == What this does ==
 *
 *  1. Turns the Discovered analyzer off in the program's own analysis
 *     options, which the GUI reads when it opens the database. The flags a
 *     function really has are declared in prototypes.tsv instead, where a
 *     review can see them.
 *  2. Clears every CALL_RETURN override on a CALL whose callee returns (not
 *     flagged, and has a RET). A CALL_RETURN on a JMP is Ghidra's "Shared
 *     Return Calls" marking a tail call, which is right, and is left alone.
 *  3. Disassembles each call's fall-through, regrows the owning function's
 *     body, and re-runs analysis over what changed, so the calls and data
 *     references in the recovered code land in the xref lists.
 *
 * It also reports -- and does not touch -- a no-return flag prototypes.tsv
 * does not declare. Whether a function returns is a claim to prove, not
 * something a repair script gets to decide.
 *
 * Idempotent; a clean database reports zeroes, and verify_ghidra_db.py
 * asserts it does.
 *
 * @category HOTD2
 */

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.util.LinkedHashSet;
import java.util.Map;
import java.util.Set;
import java.util.TreeSet;

import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.listing.Bookmark;
import ghidra.program.model.listing.BookmarkType;
import ghidra.program.model.listing.FlowOverride;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionManager;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.symbol.Reference;

public class RepairFlowDamage extends GhidraScript {

    static final String DISCOVERED = "Non-Returning Functions - Discovered";

    private Listing lst;
    /** Per-site detail, printed after the summary so `run.sh`'s head keeps it. */
    private final java.util.List<String> notes = new java.util.ArrayList<>();
    private FunctionManager fm;

    @Override
    public void run() throws Exception {
        boolean apply = "1".equals(System.getenv("HOTD2_APPLY"));
        lst = currentProgram.getListing();
        fm = currentProgram.getFunctionManager();

        // 1. the analyzer
        Map<String, String> opts = getCurrentAnalysisOptionsAndValues(currentProgram);
        boolean discoveredOn = !"false".equals(opts.get(DISCOVERED));
        if (discoveredOn && apply) setAnalysisOption(currentProgram, DISCOVERED, "false");

        // 2. the overrides, and any call whose fall-through was simply dropped
        AddressSet seeds = new AddressSet();
        Set<Function> owners = new LinkedHashSet<>();
        int stale = 0, dropped = 0, shown = 0;
        for (Instruction i : lst.getInstructions(true)) {
            // By mnemonic, not flow type: a JMP carrying CALL_RETURN reports
            // a call flow, and those are Shared Return Calls' tail calls.
            if (!i.getMnemonicString().equals("CALL")) continue;
            Function callee = callee(i);
            if (callee == null || !returns(callee)) continue;
            boolean override = i.getFlowOverride() == FlowOverride.CALL_RETURN;
            Address next = i.getMaxAddress().next();
            boolean lost = !override && next != null && lst.getInstructionAt(next) == null
                && currentProgram.getMemory().getBlock(next) != null
                && currentProgram.getMemory().getBlock(next).isExecute();
            if (!override && !lost) continue;
            if (override) stale++; else dropped++;
            Function owner = fm.getFunctionContaining(i.getAddress());
            if (shown++ < 10) {
                notes.add("[hotd2] flow " + i.getAddress() + " CALL " + callee.getName()
                    + (override ? " has CALL_RETURN" : " falls into undisassembled bytes")
                    + " in " + (owner == null ? "(no function)" : owner.getName()));
            }
            if (!apply) continue;
            if (override) i.setFlowOverride(FlowOverride.NONE);
            if (next != null) seeds.add(next);
            if (owner != null) owners.add(owner);
        }

        // 3. the tails
        long grown = 0;
        if (apply && !seeds.isEmpty()) {
            new DisassembleCommand(seeds, null, true).applyTo(currentProgram, monitor);
            for (Function f : owners) {
                long before = f.getBody().getNumAddresses();
                CreateFunctionCmd.fixupFunctionBody(currentProgram, f, monitor);
                grown += f.getBody().getNumAddresses() - before;
            }
            analyzeChanges(currentProgram);
        }

        // The analyzer's own bookmarks on a function that returns after all:
        // "Non-Returning Function Found" at MatrixStackPop is a claim a reader
        // meets first and believes.
        int bookmarks = 0;
        for (Bookmark b : allBookmarks("Non-Returning Function")) {
            Function f = fm.getFunctionAt(b.getAddress());
            if (f == null || f.hasNoReturn()) continue;
            bookmarks++;
            if (apply) currentProgram.getBookmarkManager().removeBookmark(b);
        }

        // The flags nobody declared.
        Set<String> declared = declaredNoReturn();
        Set<String> undeclared = new TreeSet<>();
        for (Function f : fm.getFunctions(true)) {
            if (f.isExternal() || !f.hasNoReturn()) continue;
            String a = String.format("%08x", f.getEntryPoint().getOffset());
            if (!declared.contains(a)) undeclared.add(a + " " + f.getName());
        }
        for (String u : undeclared) {
            notes.add("[hotd2] flow no-return flag not in prototypes.tsv: " + u);
        }

        // Its own line, in a fixed shape: verify_ghidra_db.py parses it.
        println(String.format(
            "[hotd2] flow: apply=%b discovered=%b stale=%d dropped=%d undeclared=%d"
            + " bookmarks=%d repaired=%d grown=%d md5=%s",
            apply, discoveredOn, stale, dropped, undeclared.size(), bookmarks,
            owners.size(), grown, currentProgram.getExecutableMD5()));
        for (String n : notes) println(n);
    }

    private java.util.List<Bookmark> allBookmarks(String category) {
        java.util.List<Bookmark> out = new java.util.ArrayList<>();
        java.util.Iterator<Bookmark> it =
            currentProgram.getBookmarkManager().getBookmarksIterator(BookmarkType.ANALYSIS);
        while (it.hasNext()) {
            Bookmark b = it.next();
            if (category.equals(b.getCategory())) out.add(b);
        }
        return out;
    }

    /** The function a CALL lands in, through a thunk. */
    private Function callee(Instruction i) {
        for (Reference r : i.getReferencesFrom()) {
            if (!r.getReferenceType().isCall()) continue;
            Function f = fm.getFunctionAt(r.getToAddress());
            if (f != null && f.isThunk()) f = f.getThunkedFunction(true);
            return f;
        }
        return null;
    }

    /** Not flagged, and at least one RET in its body: it comes back. */
    private boolean returns(Function f) {
        if (f.hasNoReturn() || f.isExternal()) return false;
        for (Instruction i : lst.getInstructions(f.getBody(), true)) {
            if (i.getMnemonicString().startsWith("RET")) return true;
        }
        return false;
    }

    /** Addresses prototypes.tsv marks `noreturn`, as eight hex digits. */
    private Set<String> declaredNoReturn() throws Exception {
        Set<String> out = new TreeSet<>();
        String repo = System.getenv("HOTD2_REPO");
        File f = repo == null ? null : new File(repo, "ghidra/annotations/prototypes.tsv");
        if (f == null || !f.isFile()) return out;
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            String line;
            while ((line = r.readLine()) != null) {
                String t = line.trim();
                if (t.isEmpty() || t.startsWith("#")) continue;
                String[] c = line.split("\t", -1);
                if (c.length > 2 && (" " + c[2] + " ").contains(" noreturn ")) {
                    out.add(String.format("%08x", Long.parseLong(c[0].trim(), 16)));
                }
            }
        }
        return out;
    }
}
