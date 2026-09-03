/* Dump every project symbol from the database back into ghidra/annotations.
 *
 * The inverse of ApplyAnnotations, and the reason interactive work is not
 * lost. Exploring over the Ghidra MCP bridge renames functions and labels in
 * the live database and leaves no reproducible trail; running this afterwards
 * turns that work into a committed diff.
 *
 *     ./ghidra/run.sh export-annotations
 *
 * Writes ghidra/annotations/functions.tsv and globals.tsv.
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
 *     tools/annotate.py and not yet applied simply vanished -- and globals
 *     were written as `address, name` with no third column at all, so a
 *     single export deleted the comment on 195 of the 282 global rows.
 *
 * So: read the file, keep every line in place, update the rows the database
 * has something to say about, append genuinely new ones at the end, and leave
 * everything else exactly as found. The database wins on **names**, because
 * that is the rename this script exists to capture. The file wins on
 * **comments** the database has none of, because a Ghidra label carries no
 * comment and the file is where that prose lives.
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
import java.util.TreeMap;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolIterator;
import ghidra.program.model.symbol.SymbolType;

public class ExportAnnotations extends GhidraScript {

    private static final String[] AUTO_PREFIX = {
        "FUN_", "SUB_", "LAB_", "DAT_", "UNK_", "EXT_", "_DAT_", "__DAT_",
        "Catch@", "Unwind@", "switchD", "caseD", "PTR_", "s_", "u_", "ADDR_",
        "thunk_", "Rsrc_", "AddressOfEntryPoint", "entry",
    };
    /* Recovered by Ghidra's function ID analyser on any fresh import. */
    private static final String[] LIB_PREFIX = {
        "_", "__", "D3DX", "d3dx", "CD3du", "CHelInfo", "operator_",
    };

    /** What the database knows about one address. */
    private static final class Entry {
        final String name;
        final String comment;      // "" when the database carries none
        Entry(String name, String comment) {
            this.name = name;
            this.comment = comment == null ? ""
                : comment.replace('\n', ' ').replace('\t', ' ').trim();
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
            MemoryBlock b = currentProgram.getMemory().getBlock(a);
            if (b == null || !b.isInitialized()) continue;   // drops TEB
            if (currentProgram.getFunctionManager().getFunctionAt(a) != null) continue;
            // A label carries no comment of its own, so the file's third
            // column is the only place a global's prose exists. Never
            // overwrite it from here.
            gbl.put(a.getOffset(), new Entry(n, null));
        }

        merge(new File(dir, "functions.tsv"), fns, "functions");
        merge(new File(dir, "globals.tsv"), gbl, "globals");
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
        int updated = 0, keptUnknown = 0, keptComment = 0;

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
                        // tools/annotate.py and not yet applied, or a symbol
                        // deleted in the GUI. Either way the committed file is
                        // the source of truth and this is not the script that
                        // gets to drop it.
                        out.add(line);
                        keptUnknown++;
                        continue;
                    }
                    String had = c.length > 2 ? c[2] : "";
                    String comment = e.comment.isEmpty() ? had : e.comment;
                    if (e.comment.isEmpty() && !had.isEmpty()) keptComment++;
                    String row = row(addr, e.name, comment);
                    if (!row.equals(line)) updated++;
                    out.add(row);
                    seen.put(addr, Boolean.TRUE);
                }
            }
        }

        int added = 0;
        for (Map.Entry<Long, Entry> e : db.entrySet()) {   // TreeMap: by address
            if (seen.containsKey(e.getKey())) continue;
            out.add(row(e.getKey(), e.getValue().name, e.getValue().comment));
            added++;
        }

        try (PrintWriter w = new PrintWriter(f)) {
            for (String s : out) w.println(s);
        }
        println(String.format(
            "[hotd2] %s.tsv: %d updated, %d appended, %d kept (not in the "
            + "database), %d comments kept from the file",
            what, updated, added, keptUnknown, keptComment));
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
        for (String p : AUTO_PREFIX) if (n.startsWith(p)) return true;
        return false;
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
