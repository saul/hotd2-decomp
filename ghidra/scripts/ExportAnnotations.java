/* Dump every project symbol from the database back into ghidra/annotations.
 *
 * The inverse of ApplyAnnotations, and the reason interactive work is not
 * lost. Exploring over the Ghidra MCP bridge renames functions and labels in
 * the live database and leaves no reproducible trail; running this afterwards
 * turns that work into a committed diff.
 *
 *     ./ghidra/run.sh export-annotations
 *
 * Writes ghidra/annotations/functions.tsv, globals.tsv and prototypes.tsv.
 *
 * == It MERGES. It does not rewrite. ==
 *
 * This used to build a fresh list from the database, sort it, and overwrite
 * the file. Three things were wrong with that, and all three were live:
 *
 *  1. **It re-sorted**, which CLAUDE.md forbids in as many words -- both
 *     workstreams append to these files, and a sorted rewrite turns one added
 *     row into a diff nobody can review beside a peer's uncommitted work.
 *  2. **It kept only the leading '#' block.** functions.tsv carries section
 *     headers in the body ("# --- combat: shots, damage, ..."); every one of
 *     them was destroyed on export.
 *  3. **It dropped what the database did not have.** A row added with
 *     npm run annotate and not yet applied simply vanished -- and globals
 *     were written as `address, name` with no third column at all, so a
 *     single export deleted the comment on 195 of the 282 global rows.
 *
 * So: read the file, keep every line in place, update the rows the database
 * has something to say about, insert genuinely new ones in address order, and
 * leave everything else exactly as found. The database wins on **names**,
 * because that is the rename this script exists to capture; every rename it
 * takes is printed, so the diff is not the only place it shows.
 *
 * The file wins on **comments**. This used to let the database win whenever
 * it had one, and ApplyAnnotations wrote a comment only when it first named a
 * function, so a comment improved with npm run annotate never reached the
 * database and the next export put the database's stale copy back: 19 rows in
 * one run, RegisterForShotTest's 1,415 characters replaced by the 455 it had
 * a month earlier. A database comment now reaches the file only for a row
 * whose file comment is empty (or a row that is new). When both have one and
 * they differ, the file's is kept and the pair is **listed**, never settled
 * here -- `conflicts=` on the summary, the first few on their own lines, and
 * all of them in $HOTD2_OUT/export_comment_conflicts.tsv -- because the
 * database's can be the newer prose (set over MCP and never exported), and
 * the next apply-annotations writes the file's over it. Carry what is worth
 * keeping into the file with npm run annotate.
 *
 * What is deliberately NOT exported, because a fresh import recreates it:
 *   - anything still carrying a Ghidra default name (FUN_/DAT_/LAB_/...)
 *   - Ghidra's own analyser output: Catch@/Unwind@/switchD/caseD/PTR_/s_/u_
 *   - Windows TEB fields and PE resource labels
 *   - CRT and D3DX names recovered by the function ID analyser
 *
 * That filter is what keeps the committed file a record of *this project's*
 * findings rather than a snapshot of Ghidra's.
 *
 * @category HOTD2
 */

import java.io.File;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Parameter;
import ghidra.program.model.listing.Variable;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.pcode.Varnode;
import ghidra.program.model.symbol.SourceType;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;
import ghidra.program.model.symbol.SymbolType;

public class ExportAnnotations extends GhidraScript {

    /**
     * Matched **case-insensitively** — see {@link #isAuto}.
     *
     * `switchD` used to be here in that spelling and matched nothing: Ghidra
     * 12 labels a jump table `switchdataD_004330c4`, and `switchdataD_`
     * does not start with `switchD` (the seventh character is `d`, not `D`).
     * 316 of them reached `globals.tsv` on the first export after the
     * upgrade, and three of them *overwrote* curated names —
     * `g_class33_selector_targets`, `g_class33_selector_index` and
     * `g_class26_states` all became `switchdataD_...`. A prefix list is a
     * version-drift hazard, so this one is deliberately loose.
     *
     * ApplyAnnotations.isDefaultName holds the same list: a name this refuses
     * to export is a name that one may replace. Change them together.
     */
    private static final String[] AUTO_PREFIX = {
        "FUN_", "SUB_", "LAB_", "DAT_", "UNK_", "EXT_", "_DAT_", "__DAT_",
        "Catch@", "Unwind@", "switchd", "switchdata", "cased", "casedata",
        "jumptable", "PTR_", "s_", "u_", "ADDR_",
        "thunk_", "Rsrc_", "AddressOfEntryPoint", "entry",
        // MSVC artefacts the RTTI analyser applies on any fresh import.
        "RTTI_", "vftable", "vbtable",
    };
    /**
     * Whole names Ghidra generates that carry no prefix at all. `default` is
     * the label on a jump table's default arm; 148 rows of it arrived at once,
     * every one of them named `default`, which is also the only thing that has
     * ever put duplicate *names* in `globals.tsv`.
     */
    private static final String[] AUTO_EXACT = {
        "default", "vftable", "switch", "case",
    };
    /* Recovered by Ghidra's function ID analyser on any fresh import. */
    private static final String[] LIB_PREFIX = {
        "_", "__", "D3DX", "d3dx", "CD3du", "CHelInfo", "operator_",
    };

    /** Every comment the file and the database disagree on, under HOTD2_OUT. */
    private static final String CONFLICTS = "export_comment_conflicts.tsv";

    /** What the database knows about one address. */
    private static final class Entry {
        final String name;
        final String comment;      // "" when the database carries none
        Entry(String name, String comment) {
            this.name = name;
            // ApplyAnnotations.flat: the two must agree on what "differs" means.
            this.comment = comment == null ? ""
                : comment.replace('\r', ' ').replace('\n', ' ').replace('\t', ' ').trim();
        }
    }

    @Override
    public void run() throws Exception {
        File dir = annotationsDir();
        if (dir == null) { println("[hotd2] ERROR: cannot locate ghidra/annotations"); return; }

        Map<Long, Entry> fns = new TreeMap<>();
        for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
            if (f.isThunk() || f.isExternal()) continue;
            String n = f.getName();
            if (isAuto(n) || isLibrary(n)) continue;
            fns.put(f.getEntryPoint().getOffset(), new Entry(n, f.getComment()));
        }

        Map<Long, Entry> gbl = new TreeMap<>();
        SymbolIterator it = currentProgram.getSymbolTable().getAllSymbols(false);
        while (it.hasNext()) {
            Symbol s = it.next();
            if (s.getSymbolType() != SymbolType.LABEL) continue;
            String n = s.getName();
            if (isAuto(n) || isLibrary(n)) continue;
            Address a = s.getAddress();
            if (!inProgramSection(a)) continue;   // really drops TEB
            if (currentProgram.getFunctionManager().getFunctionAt(a) != null) continue;
            // A label carries no comment of its own, so the file's third
            // column is the only place a global's prose exists. Never
            // overwrite it from here.
            gbl.put(a.getOffset(), new Entry(n, null));
        }

        String outDir = System.getenv("HOTD2_OUT");
        if (outDir != null) new File(outDir, CONFLICTS).delete();   // this run's only
        merge(new File(dir, "functions.tsv"), fns, "functions");
        merge(new File(dir, "globals.tsv"), gbl, "globals");
        mergePrototypes(new File(dir, "prototypes.tsv"), prototypesFromDb());
    }

    /**
     * Rewrite the file in place: same lines, same order, updated rows.
     *
     * Comments, blank lines and rows the database has nothing for are copied
     * through byte for byte. Only a row whose address the database knows is
     * rewritten, and only its name and (for functions) its comment change.
     */
    private void merge(File f, Map<Long, Entry> db, String what) throws Exception {
        List<String> out = new ArrayList<>();
        Map<Long, Boolean> seen = new LinkedHashMap<>();
        List<String> renames = new ArrayList<>();
        List<String[]> conflicts = new ArrayList<>();
        int updated = 0, keptUnknown = 0, filled = 0;
        int downgraded = 0, aliasKept = 0;

        if (f.isFile()) {
            try (java.io.BufferedReader r =
                     new java.io.BufferedReader(new java.io.FileReader(f))) {
                String line;
                while ((line = r.readLine()) != null) {
                    String t = line.trim();
                    if (t.isEmpty() || t.startsWith("#")) { out.add(line); continue; }
                    String[] c = line.split("\t", 3);
                    Long addr = parseAddr(c[0]);
                    if (addr == null) { out.add(line); continue; }
                    Entry e = db.get(addr);
                    if (e == null) {
                        // In the file, not in the database: a row added with
                        // npm run annotate and not yet applied, or a symbol
                        // deleted in the GUI. Either way the committed file is
                        // the source of truth and this is not the script that
                        // gets to drop it.
                        out.add(line);
                        keptUnknown++;
                        continue;
                    }
                    // The file's comment, unless it has none (see the header).
                    String had = c.length > 2 ? c[2].trim() : "";
                    String comment = had;
                    if (had.isEmpty()) {
                        comment = e.comment;
                        if (!comment.isEmpty()) filled++;
                    } else if (!e.comment.isEmpty() && !e.comment.equals(had)) {
                        conflicts.add(new String[] {
                            String.format("%08x", addr), c[1], had, e.comment });
                    }
                    // **A curated name is never replaced by a generated one.**
                    // The collection filters above should mean no generated
                    // name ever reaches here, but they are prefix lists and a
                    // prefix list goes stale on a Ghidra upgrade -- which is
                    // exactly how `g_class26_states` became
                    // `switchdataD_0048e32c`. Belt and braces, because the
                    // cost of being wrong is a silent downgrade of work
                    // nobody will notice until they go looking for the name.
                    String name = e.name;
                    if (isAuto(name) || isLibrary(name)) {
                        name = c[1];
                        downgraded++;
                    }
                    // Two labels on one address: the database yields them in
                    // no particular order, so which one "wins" would otherwise
                    // change between runs. The file decides -- it is where the
                    // choice of canonical alias was made. `0x009C8E58` carries
                    // both `g_camera_fixed_eye_y` and `g_ground_plane_y`, and
                    // the port cites the first.
                    if (!name.equals(c[1]) && aliasAt(addr, c[1])) {
                        name = c[1];
                        aliasKept++;
                    }
                    if (!name.equals(c[1])) {
                        renames.add(String.format("%08x %s -> %s", addr, c[1], name));
                    }
                    String row = row(addr, name, comment);
                    if (!row.equals(line)) updated++;
                    out.add(row);
                    seen.put(addr, Boolean.TRUE);
                }
            }
        }

        List<String> fresh = new ArrayList<>();
        for (Map.Entry<Long, Entry> e : db.entrySet()) {   // TreeMap: by address
            if (seen.containsKey(e.getKey())) continue;
            fresh.add(row(e.getKey(), e.getValue().name, e.getValue().comment));
        }
        int added = fresh.size();
        writeSorted(f, out, fresh);
        // One line in a fixed shape (verify_ghidra_db.py parses it), then the detail.
        println(String.format(
            "[hotd2] export %s: updated=%d renamed=%d appended=%d filled=%d conflicts=%d"
            + " kept=%d refused=%d aliases=%d",
            what, updated, renames.size(), added, filled, conflicts.size(),
            keptUnknown, downgraded, aliasKept));
        for (String n : renames) {
            println("[hotd2] export " + what + " rename " + n
                + " (the database's; check it is not the older name)");
        }
        for (int i = 0; i < conflicts.size() && i < 10; i++) {
            String[] k = conflicts.get(i);
            println(String.format("[hotd2] export %s comment %s %s: kept the file's (%d chars),"
                + " the database has %d", what, k[0], k[1], k[2].length(), k[3].length()));
        }
        String outDir = System.getenv("HOTD2_OUT");
        if (outDir != null && !conflicts.isEmpty()) {
            File cf = new File(outDir, CONFLICTS);
            boolean first = !cf.exists();
            try (PrintWriter w = new PrintWriter(new java.io.FileWriter(cf, true))) {
                if (first) w.println("# table\taddress\tname\tfile comment (kept)\tdatabase comment");
                for (String[] k : conflicts) w.println(what + "\t" + String.join("\t", k));
            }
            println("[hotd2] export " + what + ": " + conflicts.size()
                + " comment conflicts in full in " + cf);
        }
    }

    /**
     * **Everything new goes in address order, and the file leaves sorted.**
     *
     * These used to be appended at the tail, which is where every merge
     * conflict in `ghidra/annotations/` has come from: two branches adding
     * unrelated rows to the same last line. `npm run annotate` inserts in
     * order from the other end, and this keeps the invariant whole -- the
     * header block and its blank line stay put, every data row after it is
     * sorted by address.
     */
    private void writeSorted(File f, List<String> out, List<String> fresh) throws Exception {
        List<String> head = new ArrayList<>();
        List<String> data = new ArrayList<>();
        boolean inHead = true;
        for (String line : out) {
            String t = line.trim();
            if (inHead && (t.isEmpty() || t.startsWith("#"))) { head.add(line); continue; }
            inHead = false;
            if (t.isEmpty()) continue;
            data.add(line);
        }
        data.addAll(fresh);
        data.sort((x, y) -> {
            Long a = parseAddr(x.split("\t", 2)[0]);
            Long b = parseAddr(y.split("\t", 2)[0]);
            if (a == null || b == null) return 0;
            return Long.compare(a, b);
        });
        while (!head.isEmpty() && head.get(head.size() - 1).trim().isEmpty()) {
            head.remove(head.size() - 1);
        }
        List<String> all = new ArrayList<>(head);
        all.add("");
        all.addAll(data);
        try (PrintWriter w = new PrintWriter(f)) {
            for (String s : all) w.println(s);
        }
    }

    // ---- prototypes.tsv ------------------------------------------------------

    private static final Set<String> CONVENTIONS = Set.of(
        "__cdecl", "__stdcall", "__fastcall", "__thiscall", "__vectorcall");

    /**
     * Every function whose signature a person set -- in the GUI, over MCP, or
     * by ApplyAnnotations from this very file -- and every function flagged
     * no-return, as {prototype, attributes}.
     *
     * A signature Ghidra inferred is not exported: it is a guess a fresh
     * import makes again, and committing 2,520 of them made the decompiler
     * worse, not better (`extraout_` up from 184 to 880; L89). A no-return
     * flag is exported whoever set it, because a wrong one is invisible in
     * the pseudocode and a row is where a reviewer sees it.
     */
    private Map<Long, String[]> prototypesFromDb() {
        Map<Long, String[]> out = new TreeMap<>();
        for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
            if (f.isThunk() || f.isExternal()) continue;
            boolean proto = f.getSignatureSource() == SourceType.USER_DEFINED;
            if (!proto && !f.hasNoReturn()) continue;
            List<String> attrs = new ArrayList<>();
            if (f.hasNoReturn()) attrs.add("noreturn");
            if (proto && f.hasCustomVariableStorage()) {
                for (Parameter p : f.getParameters()) attrs.add(p.getName() + "@" + specOf(p));
                attrs.add("return@" + specOf(f.getReturn()));
            }
            out.put(f.getEntryPoint().getOffset(), new String[] {
                proto ? prototypeOf(f) : "-",
                attrs.isEmpty() ? "-" : String.join(" ", attrs) });
        }
        return out;
    }

    /** `void __cdecl MatrixTranslate(float x, float y, float z)`: what ApplyAnnotations parses. */
    private String prototypeOf(Function f) {
        StringBuilder sb = new StringBuilder(f.getReturnType().getName()).append(' ');
        String cc = f.getCallingConventionName();
        if (CONVENTIONS.contains(cc)) sb.append(cc).append(' ');
        sb.append(f.getName()).append('(');
        Parameter[] ps = f.getParameters();
        for (int i = 0; i < ps.length; i++) {
            if (i > 0) sb.append(", ");
            sb.append(ps[i].getDataType().getName()).append(' ').append(ps[i].getName());
        }
        if (f.hasVarArgs()) sb.append(ps.length > 0 ? ", ..." : "...");
        else if (ps.length == 0) sb.append("void");
        return sb.append(')').toString();
    }

    /** `EDX:EAX` -- registers only, which is all a row can say. */
    private String specOf(Variable v) {
        StringBuilder sb = new StringBuilder();
        for (Varnode vn : v.getVariableStorage().getVarnodes()) {
            Register r = currentProgram.getRegister(vn.getAddress(), vn.getSize());
            if (sb.length() > 0) sb.append(':');
            sb.append(r != null ? r.getName() : vn.getAddress().toString());
        }
        return sb.length() == 0 ? "void" : sb.toString();
    }

    /**
     * Same merge as the names: every line kept in place, a row the database
     * has something to say about updated, new ones inserted in order.
     *
     * The database wins on the **prototype**, because a signature set by hand
     * is what this exists to capture. The file wins on the **flags**: a
     * `returns` row stays `returns` even if the database has the function
     * flagged again, and verify_ghidra_db says so loudly -- that disagreement
     * is the bug this file was written for, and an export must not paper over
     * it. A flag the file does not mention yet is added.
     */
    private void mergePrototypes(File f, Map<Long, String[]> db) throws Exception {
        List<String> out = new ArrayList<>();
        Set<Long> seen = new java.util.HashSet<>();
        int updated = 0;
        if (f.isFile()) {
            try (java.io.BufferedReader r =
                     new java.io.BufferedReader(new java.io.FileReader(f))) {
                String line;
                while ((line = r.readLine()) != null) {
                    String t = line.trim();
                    if (t.isEmpty() || t.startsWith("#")) { out.add(line); continue; }
                    String[] c = line.split("\t", 4);
                    Long addr = parseAddr(c[0]);
                    String[] e = addr == null ? null : db.get(addr);
                    if (e == null || c.length < 2) { out.add(line); continue; }
                    seen.add(addr);
                    String proto = e[0].equals("-") ? c[1] : e[0];
                    List<String> attrs = new ArrayList<>();
                    boolean hasFlag = false;
                    for (String a : (c.length > 2 ? c[2] : "-").split("\\s+")) {
                        if (a.isEmpty() || a.equals("-")) continue;
                        if (a.equals("noreturn") || a.equals("returns")) hasFlag = true;
                        // Storage is the database's whenever it set the prototype.
                        if (a.indexOf('@') > 0 && !e[0].equals("-")) continue;
                        attrs.add(a);
                    }
                    for (String a : e[1].split("\\s+")) {
                        if (a.equals("-")) continue;
                        if (a.equals("noreturn") && hasFlag) continue;
                        if (a.indexOf('@') > 0 && e[0].equals("-")) continue;
                        attrs.add(a);
                    }
                    String row = String.format("%08x\t%s\t%s%s", addr, proto,
                        attrs.isEmpty() ? "-" : String.join(" ", attrs),
                        c.length > 3 && !c[3].trim().isEmpty() ? "\t" + c[3].trim() : "");
                    if (!row.equals(line)) updated++;
                    out.add(row);
                }
            }
        }
        List<String> fresh = new ArrayList<>();
        for (Map.Entry<Long, String[]> e : db.entrySet()) {
            if (seen.contains(e.getKey())) continue;
            fresh.add(String.format("%08x\t%s\t%s", e.getKey(), e.getValue()[0], e.getValue()[1]));
        }
        writeSorted(f, out, fresh);
        println(String.format("[hotd2] export prototypes: updated=%d appended=%d",
            updated, fresh.size()));
    }

    /** Does the database also carry `want` as a label on this address? */
    private boolean aliasAt(long addr, String want) {
        Address a = currentProgram.getAddressFactory().getDefaultAddressSpace()
                        .getAddress(addr);
        for (Symbol s : currentProgram.getSymbolTable().getSymbols(a)) {
            if (s.getName().equals(want)) return true;
        }
        return false;
    }

    private static Long parseAddr(String s) {
        try {
            return Long.parseLong(s.trim(), 16);
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private static String row(long addr, String name, String comment) {
        String c = comment == null ? "" : comment.trim();
        return String.format("%08x\t%s%s", addr, name, c.isEmpty() ? "" : "\t" + c);
    }

    private static boolean isAuto(String n) {
        String l = n.toLowerCase();
        for (String p : AUTO_PREFIX) if (l.startsWith(p.toLowerCase())) return true;
        for (String e : AUTO_EXACT) if (l.equals(e)) return true;
        return false;
    }

    /**
     * Is this address in one of the four sections `Hod2.exe` actually has?
     *
     * The old guard here was `!block.isInitialized()`, with the comment
     * "drops TEB". It does not: Ghidra's synthetic TEB block *is* initialized,
     * so 86 Windows thread-block fields — `TlsSlots`, `LockCount`,
     * `TxnScopeContext`, at addresses like `0xffdfffd4` — were exported as
     * though they were program globals. `web/tools/checks/annotations.ts` rejects every
     * one of them with "is in no section", which is the check this should have
     * been making all along: the same one, asked here.
     */
    private boolean inProgramSection(Address a) {
        MemoryBlock b = currentProgram.getMemory().getBlock(a);
        if (b == null || !b.isInitialized() || !b.isLoaded()) return false;
        String n = b.getName();
        return n.equals(".text") || n.equals(".rdata")
            || n.equals(".data") || n.equals(".rsrc");
    }

    private static boolean isLibrary(String n) {
        for (String p : LIB_PREFIX) if (n.startsWith(p)) return true;
        return false;
    }

    private File annotationsDir() {
        String repo = System.getenv("HOTD2_REPO");
        if (repo != null) {
            File d = new File(repo, "ghidra/annotations");
            if (d.isDirectory()) return d;
        }
        File src = getSourceFile() == null ? null : getSourceFile().getFile(false);
        if (src != null) {
            File d = new File(src.getParentFile().getParentFile(), "annotations");
            if (d.isDirectory()) return d;
        }
        return null;
    }
}
