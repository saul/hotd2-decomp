/* Replay the committed annotations onto a Ghidra database.
 *
 * This is the script that turns a bare import into the project's annotated
 * decompilation. Everything this project has learned about the binary's
 * symbols lives in ghidra/annotations/*.tsv, which is committed; the database
 * is not. Run this after an import and the names are back.
 *
 *     ./ghidra/run.sh apply-annotations           # report only
 *     HOTD2_APPLY=1 ./ghidra/run.sh apply-annotations
 *
 * Idempotent by construction: a symbol is only renamed when its current name
 * is still a Ghidra default (FUN_/SUB_/LAB_/DAT_/UNK_). A name a human chose
 * in the GUI is never clobbered, so this can be re-run at any time, and it can
 * be run before or after ApplyKnownTables without ordering trouble.
 *
 * Functions that do not exist yet are created, because most of the interesting
 * ones are only reachable through a dispatch table Ghidra did not recognise.
 *
 * @category HOTD2
 */

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.PrintWriter;

import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.symbol.SourceType;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolTable;

public class ApplyAnnotations extends GhidraScript {

    private boolean apply;
    private int fnNamed, fnCreated, fnSkipped, fnFailed;
    private int gNamed, gSkipped, gFailed;
    private final StringBuilder log = new StringBuilder();

    @Override
    public void run() throws Exception {
        apply = "1".equals(System.getenv("HOTD2_APPLY"));

        File dir = annotationsDir();
        if (dir == null) {
            println("[hotd2] ERROR: cannot locate ghidra/annotations");
            return;
        }
        applyFunctions(new File(dir, "functions.tsv"));
        applyGlobals(new File(dir, "globals.tsv"));

        String summary = String.format(
                "[hotd2] apply=%b  functions: named=%d created=%d skipped=%d failed=%d"
                + "  globals: named=%d skipped=%d failed=%d",
                apply, fnNamed, fnCreated, fnSkipped, fnFailed,
                gNamed, gSkipped, gFailed);
        println(summary);

        String out = System.getenv("HOTD2_OUT");
        if (out != null) {
            try (PrintWriter w = new PrintWriter(new File(out, "apply_annotations.txt"))) {
                w.println(summary);
                w.print(log);
            }
        }
    }

    /** ghidra/annotations, found relative to this script or to HOTD2_REPO. */
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

    private void applyFunctions(File f) throws Exception {
        if (!f.isFile()) { println("[hotd2] missing " + f); return; }
        Listing lst = currentProgram.getListing();
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            String line;
            while ((line = r.readLine()) != null) {
                String[] c = split(line);
                if (c == null) continue;
                Address a = toAddr(Long.parseLong(c[0], 16));
                Function fn = lst.getFunctionAt(a);

                if (fn == null) {
                    if (!apply) { fnCreated++; continue; }
                    if (lst.getInstructionAt(a) == null) {
                        new DisassembleCommand(a, null, true)
                                .applyTo(currentProgram, monitor);
                    }
                    if (!new CreateFunctionCmd(a).applyTo(currentProgram, monitor)) {
                        log.append("FAILED create ").append(c[0]).append('\n');
                        fnFailed++;
                        continue;
                    }
                    fn = lst.getFunctionAt(a);
                    fnCreated++;
                }
                if (fn == null) continue;
                if (!isDefaultName(fn.getName())) { fnSkipped++; continue; }
                if (!apply) { fnNamed++; continue; }
                try {
                    fn.setName(c[1], SourceType.USER_DEFINED);
                    if (c.length > 2 && !c[2].isEmpty()) fn.setComment(c[2]);
                    fnNamed++;
                    log.append("fn  ").append(c[0]).append(' ').append(c[1]).append('\n');
                } catch (Exception ex) {
                    log.append("FAILED name ").append(c[0]).append(": ")
                       .append(ex.getMessage()).append('\n');
                    fnFailed++;
                }
            }
        }
    }

    private void applyGlobals(File f) throws Exception {
        if (!f.isFile()) { println("[hotd2] missing " + f); return; }
        SymbolTable st = currentProgram.getSymbolTable();
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            String line;
            while ((line = r.readLine()) != null) {
                String[] c = split(line);
                if (c == null) continue;
                Address a = toAddr(Long.parseLong(c[0], 16));
                Symbol s = st.getPrimarySymbol(a);
                if (s != null && !isDefaultName(s.getName())) { gSkipped++; continue; }
                if (!apply) { gNamed++; continue; }
                try {
                    createLabel(a, c[1], true, SourceType.USER_DEFINED);
                    if (c.length > 2 && !c[2].isEmpty()) {
                        setEOLComment(a, c[2]);
                    }
                    gNamed++;
                    log.append("gbl ").append(c[0]).append(' ').append(c[1]).append('\n');
                } catch (Exception ex) {
                    log.append("FAILED label ").append(c[0]).append(": ")
                       .append(ex.getMessage()).append('\n');
                    gFailed++;
                }
            }
        }
    }

    /** A name Ghidra generated, i.e. one this script is allowed to replace. */
    private static boolean isDefaultName(String n) {
        return n.startsWith("FUN_") || n.startsWith("SUB_") || n.startsWith("LAB_")
            || n.startsWith("DAT_") || n.startsWith("UNK_") || n.startsWith("EXT_")
            || n.startsWith("_DAT_") || n.startsWith("__DAT_");
    }

    /** Trim comments and blanks; require at least address and name. */
    private static String[] split(String line) {
        if (line == null) return null;
        String t = line.trim();
        if (t.isEmpty() || t.startsWith("#")) return null;
        String[] c = line.split("\t", -1);
        if (c.length < 2 || c[0].trim().isEmpty() || c[1].trim().isEmpty()) return null;
        for (int i = 0; i < c.length; i++) c[i] = c[i].trim();
        return c;
    }
}
