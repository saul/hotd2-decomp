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
 * is still one Ghidra generated (FUN_/DAT_/PTR_/s_/switchdataD_/..., the list
 * ExportAnnotations refuses to export -- see isDefaultName). A name a human chose
 * in the GUI is never clobbered, so this can be re-run at any time, and it can
 * be run before or after ApplyKnownTables without ordering trouble. A curated
 * name that differs from the row is reported as `renamed`, and left:
 * export-annotations is what settles it, and it takes the database's.
 *
 * **Comments are the file's.** A row's comment is written whenever it differs
 * from the database's -- not only when the symbol is first named, which is
 * what this used to do, so a comment improved with tools/annotate.py never
 * reached the database, and export-annotations, which then let the database
 * win, put the stale copy back over the curated one (19 rows at once; L90). An
 * empty file comment never clears the database's (export-annotations brings
 * that one into the file), and a row whose name disagrees keeps the database's
 * comment too, because the two are not describing the same reading until
 * someone settles the name. Every comment replaced is logged, old text and
 * all, in $HOTD2_OUT/apply_annotations.txt.
 *
 * Functions that do not exist yet are created, because most of the interesting
 * ones are only reachable through a dispatch table Ghidra did not recognise.
 *
 * == prototypes.tsv ==
 *
 * Applied after the names. The **attributes are the file's**: a `noreturn` or
 * `returns` row sets the flag whatever the database says, because a wrong
 * no-return flag is not a choice anyone made -- it is what the "Non-Returning
 * Functions - Discovered" analyzer left behind, and it cut 517 functions short
 * (L89). The **prototype** follows the names' rule: it replaces a signature
 * Ghidra made up, and never one a person set in the GUI or over MCP. That
 * one is reported as `kept`, and `export-annotations` is how it reaches the
 * file.
 *
 * Without HOTD2_APPLY this is a report of what would change, and
 * tools/verify_ghidra_db.py asserts that report is empty: a database that
 * says what the committed files say.
 *
 * @category HOTD2
 */

import java.io.BufferedReader;
import java.io.File;
import java.io.FileReader;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import ghidra.app.cmd.disassemble.DisassembleCommand;
import ghidra.app.cmd.function.CreateFunctionCmd;
import ghidra.app.script.GhidraScript;
import ghidra.app.util.parser.FunctionSignatureParser;
import ghidra.program.model.address.Address;
import ghidra.program.model.data.DataType;
import ghidra.program.model.data.FunctionDefinitionDataType;
import ghidra.program.model.data.ParameterDefinition;
import ghidra.program.model.lang.Register;
import ghidra.program.model.listing.CommentType;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.Listing;
import ghidra.program.model.listing.Parameter;
import ghidra.program.model.listing.ParameterImpl;
import ghidra.program.model.listing.ReturnParameterImpl;
import ghidra.program.model.listing.Variable;
import ghidra.program.model.listing.VariableStorage;
import ghidra.program.model.pcode.Varnode;
import ghidra.program.model.symbol.SourceType;
import ghidra.program.model.symbol.Symbol;
import ghidra.program.model.symbol.SymbolTable;

public class ApplyAnnotations extends GhidraScript {

    private boolean apply;
    private int fnNamed, fnCreated, fnSame, fnRenamed, fnComments, fnFailed;
    private int gNamed, gSame, gRenamed, gComments, gFailed;
    private int nameNotes, commentNotes;
    private int pApplied, pSame, pKept, pMissing, pFailed, pFlags;
    private final StringBuilder log = new StringBuilder();
    /** Per-row detail, printed after the summaries so `run.sh`'s head keeps them. */
    private final java.util.List<String> notes = new java.util.ArrayList<>();

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
        applyPrototypes(new File(dir, "prototypes.tsv"));

        // One line per table, in a fixed shape: verify_ghidra_db.py parses them.
        // named/created/comments are what apply would write; renamed is a
        // curated name the row disagrees with, which apply never touches.
        String summary = String.format(
                "[hotd2] functions: apply=%b named=%d created=%d same=%d renamed=%d"
                + " comments=%d failed=%d",
                apply, fnNamed, fnCreated, fnSame, fnRenamed, fnComments, fnFailed);
        String gsummary = String.format(
                "[hotd2] globals: apply=%b named=%d same=%d renamed=%d comments=%d failed=%d",
                apply, gNamed, gSame, gRenamed, gComments, gFailed);
        println(summary);
        println(gsummary);
        println(String.format(
                "[hotd2] prototypes: apply=%b changed=%d same=%d kept=%d missing=%d"
                + " failed=%d flags=%d",
                apply, pApplied, pSame, pKept, pMissing, pFailed, pFlags));
        for (String n : notes) println(n);

        String out = System.getenv("HOTD2_OUT");
        if (out != null) {
            try (PrintWriter w = new PrintWriter(new File(out, "apply_annotations.txt"))) {
                w.println(summary);
                w.println(gsummary);
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
                // The row's own name first: `s_mot_path_format` is curated
                // and also starts like one of Ghidra's string labels.
                if (fn.getName().equals(c[1])) {
                    fnSame++;
                } else if (isDefaultName(fn.getName())) {
                    if (apply) {
                        try {
                            fn.setName(c[1], SourceType.USER_DEFINED);
                            log.append("fn  ").append(c[0]).append(' ').append(c[1]).append('\n');
                        } catch (Exception ex) {
                            log.append("FAILED name ").append(c[0]).append(": ")
                               .append(ex.getMessage()).append('\n');
                            fnFailed++;
                            continue;
                        }
                    }
                    fnNamed++;
                } else {
                    fnRenamed++;
                    nameNote("function", c[0], fn.getName(), c[1]);
                    continue;                  // and its comment with it
                }
                String want = c.length > 2 ? c[2] : "";
                String have = flat(fn.getComment());
                if (want.isEmpty() || want.equals(have)) continue;
                fnComments++;
                commentNote("function", c[0], c[1], have, want);
                if (!apply) continue;
                fn.setComment(want);
                log.append("comment ").append(c[0]).append(' ').append(c[1])
                   .append(" was: ").append(have).append('\n');
            }
        }
    }

    private void applyGlobals(File f) throws Exception {
        if (!f.isFile()) { println("[hotd2] missing " + f); return; }
        SymbolTable st = currentProgram.getSymbolTable();
        Listing lst = currentProgram.getListing();
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            String line;
            while ((line = r.readLine()) != null) {
                String[] c = split(line);
                if (c == null) continue;
                Address a = toAddr(Long.parseLong(c[0], 16));
                Symbol s = st.getPrimarySymbol(a);
                if (s != null && s.getName().equals(c[1])) {
                    gSame++;
                } else if (s == null || isDefaultName(s.getName())) {
                    // Also when the row's name is there but not primary, as
                    // `g_class26_states` sat behind `switchdataD_0048e32c`:
                    // createLabel makes it the one the listing shows.
                    if (apply) {
                        try {
                            createLabel(a, c[1], true, SourceType.USER_DEFINED);
                            log.append("gbl ").append(c[0]).append(' ').append(c[1]).append('\n');
                        } catch (Exception ex) {
                            log.append("FAILED label ").append(c[0]).append(": ")
                               .append(ex.getMessage()).append('\n');
                            gFailed++;
                            continue;
                        }
                    }
                    gNamed++;
                } else if (hasSymbol(st, a, c[1])) {
                    // One of two curated labels on the address; the file's
                    // choice of alias is kept by ExportAnnotations too.
                    gSame++;
                } else {
                    gRenamed++;
                    nameNote("global", c[0], s.getName(), c[1]);
                    continue;
                }
                String want = c.length > 2 ? c[2] : "";
                String have = flat(lst.getComment(CommentType.EOL, a));
                if (want.isEmpty() || want.equals(have)) continue;
                gComments++;
                commentNote("global", c[0], c[1], have, want);
                if (!apply) continue;
                setEOLComment(a, want);
                log.append("comment ").append(c[0]).append(' ').append(c[1])
                   .append(" was: ").append(have).append('\n');
            }
        }
    }

    private static boolean hasSymbol(SymbolTable st, Address a, String name) {
        for (Symbol s : st.getSymbols(a)) if (s.getName().equals(name)) return true;
        return false;
    }

    /** A comment as the TSV holds it: one line, no tabs, trimmed. */
    static String flat(String s) {
        return s == null ? ""
            : s.replace('\r', ' ').replace('\n', ' ').replace('\t', ' ').trim();
    }

    private void nameNote(String what, String addr, String have, String want) {
        if (nameNotes++ >= 40) return;
        notes.add("[hotd2] name " + addr + " " + what + ": the database has `" + have
            + "`, the file `" + want + "` -- not applied; export-annotations takes the"
            + " database's, so settle which is right before exporting");
    }

    private void commentNote(String what, String addr, String name, String have, String want) {
        if (commentNotes++ >= 40) return;
        notes.add("[hotd2] comment " + addr + " " + what + " " + name + ": the database's "
            + (have.isEmpty() ? "is empty" : "is " + have.length() + " chars")
            + ", the file's " + want.length() + (apply ? " -- written" : ""));
    }

    private static final Pattern CALLING_CONVENTION =
        Pattern.compile("\\b(__cdecl|__stdcall|__fastcall|__thiscall|__vectorcall)\\b");

    /** One row of prototypes.tsv, parsed. `def` is null for a `-` prototype. */
    private final class Row {
        FunctionDefinitionDataType def;
        String cc = Function.UNKNOWN_CALLING_CONVENTION_STRING;
        Boolean noReturn;                                   // null: leave it
        final Map<String, String> storage = new LinkedHashMap<>(); // "return" or a parameter name

        Row(String proto, String attrs, FunctionSignatureParser parser) throws Exception {
            for (String a : attrs.split("\\s+")) {
                if (a.isEmpty() || a.equals("-")) continue;
                if (a.equals("noreturn")) noReturn = Boolean.TRUE;
                else if (a.equals("returns")) noReturn = Boolean.FALSE;
                else if (a.indexOf('@') > 0) storage.put(a.substring(0, a.indexOf('@')), a.substring(a.indexOf('@') + 1));
                else throw new IllegalArgumentException("unknown attribute `" + a + "`");
            }
            if (proto.equals("-")) return;
            // FunctionSignatureParser resolves Ghidra's own types (float10,
            // longlong, undefined4) but not a calling convention, so that is
            // taken out and set on its own.
            Matcher m = CALLING_CONVENTION.matcher(proto);
            if (m.find()) {
                cc = m.group(1);
                proto = m.replaceFirst("").replaceAll("\\s+", " ");
            }
            def = parser.parse(null, proto);
            if (!storage.isEmpty()) {
                if (!storage.containsKey("return") && !(def.getReturnType().getLength() <= 0))
                    throw new IllegalArgumentException("custom storage needs return@...");
                for (ParameterDefinition p : def.getArguments())
                    if (!storage.containsKey(p.getName()))
                        throw new IllegalArgumentException("custom storage needs " + p.getName() + "@...");
            }
        }

        /** The same shape as {@link #canon(Function)}. */
        String canon() {
            StringBuilder sb = new StringBuilder();
            List<String> ps = new ArrayList<>();
            for (ParameterDefinition p : def.getArguments())
                ps.add(p.getDataType().getName() + " " + p.getName());
            if (def.hasVarArgs()) ps.add("...");
            sb.append(def.getReturnType().getName()).append(' ').append(cc)
              .append(" (").append(String.join(", ", ps)).append(')');
            if (!storage.isEmpty()) {
                sb.append(" return@").append(storage.getOrDefault("return", "void"));
                for (ParameterDefinition p : def.getArguments())
                    sb.append(' ').append(p.getName()).append('@').append(storage.get(p.getName()));
            }
            return sb.toString();
        }

        void applyTo(Function fn) throws Exception {
            boolean custom = !storage.isEmpty();
            List<Variable> params = new ArrayList<>();
            for (ParameterDefinition p : def.getArguments()) {
                params.add(custom
                    ? new ParameterImpl(p.getName(), p.getDataType(), storageOf(storage.get(p.getName())),
                                        currentProgram, SourceType.USER_DEFINED)
                    : new ParameterImpl(p.getName(), p.getDataType(), currentProgram, SourceType.USER_DEFINED));
            }
            DataType rt = def.getReturnType();
            ReturnParameterImpl ret = custom && storage.containsKey("return")
                ? new ReturnParameterImpl(rt, storageOf(storage.get("return")), currentProgram)
                : new ReturnParameterImpl(rt, currentProgram);
            fn.updateFunction(cc, ret, params,
                custom ? Function.FunctionUpdateType.CUSTOM_STORAGE
                       : Function.FunctionUpdateType.DYNAMIC_STORAGE_ALL_PARAMS,
                true, SourceType.USER_DEFINED);
            fn.setVarArgs(def.hasVarArgs());
        }
    }

    /** `EDX:EAX` -> the two registers, most significant first, as Ghidra joins them. */
    private VariableStorage storageOf(String spec) throws Exception {
        String[] names = spec.split(":");
        Register[] regs = new Register[names.length];
        for (int i = 0; i < names.length; i++) {
            regs[i] = currentProgram.getRegister(names[i]);
            if (regs[i] == null) throw new IllegalArgumentException("no register " + names[i]);
        }
        return new VariableStorage(currentProgram, regs);
    }

    /** The inverse of {@link #storageOf}; registers only, which is all a row can say. */
    private String specOf(Variable v) {
        StringBuilder sb = new StringBuilder();
        for (Varnode vn : v.getVariableStorage().getVarnodes()) {
            Register r = currentProgram.getRegister(vn.getAddress(), vn.getSize());
            if (sb.length() > 0) sb.append(':');
            sb.append(r != null ? r.getName() : vn.getAddress().toString());
        }
        return sb.length() == 0 ? "void" : sb.toString();
    }

    /** What the database says, in the shape a row is compared in. */
    private String canon(Function fn) {
        StringBuilder sb = new StringBuilder();
        List<String> ps = new ArrayList<>();
        for (Parameter p : fn.getParameters())
            ps.add(p.getDataType().getName() + " " + p.getName());
        if (fn.hasVarArgs()) ps.add("...");
        sb.append(fn.getReturnType().getName()).append(' ').append(fn.getCallingConventionName())
          .append(" (").append(String.join(", ", ps)).append(')');
        if (fn.hasCustomVariableStorage()) {
            sb.append(" return@").append(specOf(fn.getReturn()));
            for (Parameter p : fn.getParameters())
                sb.append(' ').append(p.getName()).append('@').append(specOf(p));
        }
        return sb.toString();
    }

    private void applyPrototypes(File f) throws Exception {
        if (!f.isFile()) { println("[hotd2] missing " + f); return; }
        FunctionSignatureParser parser =
            new FunctionSignatureParser(currentProgram.getDataTypeManager(), null);
        Listing lst = currentProgram.getListing();
        int shown = 0;
        try (BufferedReader r = new BufferedReader(new FileReader(f))) {
            String line;
            while ((line = r.readLine()) != null) {
                String[] c = split(line);
                if (c == null) continue;
                Function fn = lst.getFunctionAt(toAddr(Long.parseLong(c[0], 16)));
                if (fn == null) {
                    pMissing++;
                    notes.add("[hotd2] prototype " + c[0] + " missing: no function there");
                    continue;
                }
                Row row;
                try {
                    row = new Row(c[1], c.length > 2 ? c[2] : "-", parser);
                } catch (Exception ex) {
                    pFailed++;
                    notes.add("[hotd2] prototype " + c[0] + " failed: " + ex.getMessage());
                    continue;
                }
                if (row.noReturn != null && fn.hasNoReturn() != row.noReturn) {
                    pFlags++;
                    notes.add("[hotd2] prototype " + c[0] + " " + fn.getName() + " flag: noreturn "
                        + fn.hasNoReturn() + " -> " + row.noReturn);
                    if (apply) fn.setNoReturn(row.noReturn);
                }
                if (row.def == null) continue;
                String have = canon(fn), want = row.canon();
                if (have.equals(want)) { pSame++; continue; }
                boolean kept = fn.getSignatureSource() == SourceType.USER_DEFINED;
                if (kept) pKept++; else pApplied++;
                if (shown++ < 40) {
                    notes.add("[hotd2] prototype " + c[0] + " " + fn.getName()
                        + (kept ? " kept (set by hand; export it, or reconcile the row)" : " changed")
                        + ": have `" + have + "` want `" + want + "`");
                }
                if (!apply || kept) continue;
                try {
                    row.applyTo(fn);
                    log.append("proto ").append(c[0]).append(' ').append(want).append('\n');
                } catch (Exception ex) {
                    pApplied--;
                    pFailed++;
                    notes.add("[hotd2] prototype " + c[0] + " failed: " + ex.getMessage());
                }
            }
        }
    }

    /**
     * A name Ghidra generated, i.e. one this script is allowed to replace.
     *
     * The same prefixes ExportAnnotations.isAuto refuses to export, matched
     * the same way (case-insensitively). This list used to stop at FUN_/DAT_
     * and friends, so a global whose address carried an analyser label --
     * `PTR_DAT_005696e0`, `s_Very_Easy_00569758` -- was counted as "named by
     * someone" and never got its curated name: five rows of globals.tsv, on
     * every rebuild. Keep the two lists together.
     */
    private static final String[] AUTO_PREFIX = {
        "FUN_", "SUB_", "LAB_", "DAT_", "UNK_", "EXT_", "_DAT_", "__DAT_",
        "Catch@", "Unwind@", "switchd", "switchdata", "cased", "casedata",
        "jumptable", "PTR_", "s_", "u_", "ADDR_",
        "thunk_", "Rsrc_", "AddressOfEntryPoint", "entry",
        "RTTI_", "vftable", "vbtable",
    };
    private static final String[] AUTO_EXACT = { "default", "vftable", "switch", "case" };

    private static boolean isDefaultName(String n) {
        String l = n.toLowerCase();
        for (String p : AUTO_PREFIX) if (l.startsWith(p.toLowerCase())) return true;
        for (String e : AUTO_EXACT) if (l.equals(e)) return true;
        return false;
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
