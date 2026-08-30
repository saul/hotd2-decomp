/* Dump every project symbol from the database back into ghidra/annotations.
 *
 * The inverse of ApplyAnnotations, and the reason interactive work is not
 * lost. Exploring over the Ghidra MCP bridge renames functions and labels in
 * the live database and leaves no reproducible trail; running this afterwards
 * turns that work into a committed diff.
 *
 *     ./ghidra/run.sh export-annotations
 *
 * Writes ghidra/annotations/functions.tsv and globals.tsv, sorted by address,
 * preserving the header comment block of whatever is already there.
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
import java.util.List;

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

    @Override
    public void run() throws Exception {
        File dir = annotationsDir();
        if (dir == null) { println("[hotd2] ERROR: cannot locate ghidra/annotations"); return; }

        List<String> fns = new ArrayList<>();
        for (Function f : currentProgram.getFunctionManager().getFunctions(true)) {
            if (f.isThunk() || f.isExternal()) continue;
            String n = f.getName();
            if (isAuto(n) || isLibrary(n)) continue;
            String c = f.getComment();
            fns.add(row(f.getEntryPoint(), n, c));
        }

        List<String> gbl = new ArrayList<>();
        SymbolIterator it = currentProgram.getSymbolTable().getAllSymbols(false);
        while (it.hasNext()) {
            Symbol s = it.next();
            if (s.getSymbolType() != SymbolType.LABEL) continue;
            if (!s.getSource().isHigherPriorityThan(ghidra.program.model.symbol.SourceType.ANALYSIS)) {
                // keep only user/imported labels
            }
            String n = s.getName();
            if (isAuto(n) || isLibrary(n)) continue;
            Address a = s.getAddress();
            MemoryBlock b = currentProgram.getMemory().getBlock(a);
            if (b == null || !b.isInitialized()) continue;   // drops TEB
            if (currentProgram.getFunctionManager().getFunctionAt(a) != null) continue;
            gbl.add(row(a, n, null));
        }

        fns.sort(String::compareTo);
        gbl.sort(String::compareTo);
        write(new File(dir, "functions.tsv"), fns);
        write(new File(dir, "globals.tsv"), gbl);
        println(String.format("[hotd2] exported %d functions, %d globals to %s",
                fns.size(), gbl.size(), dir));
    }

    private static String row(Address a, String name, String comment) {
        String c = comment == null ? "" : comment.replace('\n', ' ').replace('\t', ' ').trim();
        return String.format("%08x\t%s%s", a.getOffset(), name, c.isEmpty() ? "" : "\t" + c);
    }

    /** Rewrite the body, keeping the existing '#' header block verbatim. */
    private void write(File f, List<String> rows) throws Exception {
        List<String> header = new ArrayList<>();
        if (f.isFile()) {
            try (java.io.BufferedReader r = new java.io.BufferedReader(new java.io.FileReader(f))) {
                String line;
                while ((line = r.readLine()) != null) {
                    if (!line.startsWith("#")) break;
                    header.add(line);
                }
            }
        }
        try (PrintWriter w = new PrintWriter(f)) {
            for (String h : header) w.println(h);
            for (String s : rows) w.println(s);
        }
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
