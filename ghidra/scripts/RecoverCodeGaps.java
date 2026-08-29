/* Recover missed functions in the uncovered parts of .text.
 *
 * Auto-analysis left roughly half of .text outside any function. This script
 * walks the gaps and, where a gap begins with a recognisable MSVC 6.0 function
 * prologue, disassembles it and creates a function.
 *
 * Deliberately conservative: it will not disassemble arbitrary gap bytes,
 * because .text in an MSVC binary also holds jump tables, string literals and
 * alignment padding, and disassembling those produces convincing garbage.
 *
 * Set HOTD2_APPLY=1 to make changes; otherwise it only reports.
 *
 * @category HOTD2
 */

import java.io.File;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.List;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.address.AddressSet;
import ghidra.program.model.address.AddressSetView;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.listing.Instruction;
import ghidra.program.model.mem.MemoryBlock;

public class RecoverCodeGaps extends GhidraScript {

    /** Common MSVC 6.0 x86 entry sequences. */
    private static final int[][] PROLOGUES = {
        {0x55, 0x8B, 0xEC},        // push ebp; mov ebp, esp
        {0x53, 0x8B, 0xDC},        // push ebx; mov ebx, esp
        {0x83, 0xEC},              // sub esp, imm8
        {0x81, 0xEC},              // sub esp, imm32
        {0x56, 0x8B, 0xF1},        // push esi; mov esi, ecx  (thiscall)
        {0x8B, 0xFF, 0x55, 0x8B},  // mov edi, edi; push ebp; mov ebp, esp
    };

    private boolean matches(byte[] b, int[] pat) {
        if (b.length < pat.length) return false;
        for (int i = 0; i < pat.length; i++) {
            if ((b[i] & 0xFF) != pat[i]) return false;
        }
        return true;
    }

    private boolean looksLikeFunction(Address a) {
        byte[] b = new byte[4];
        try {
            if (currentProgram.getMemory().getBytes(a, b) != 4) return false;
        } catch (Exception e) {
            return false;
        }
        for (int[] p : PROLOGUES) {
            if (matches(b, p)) return true;
        }
        return false;
    }

    /** Skip MSVC inter-function padding: 0xCC (int3) and 0x90 (nop). */
    private Address skipPadding(Address a, Address end) {
        try {
            while (a.compareTo(end) < 0) {
                int v = currentProgram.getMemory().getByte(a) & 0xFF;
                if (v != 0xCC && v != 0x90) return a;
                a = a.next();
            }
        } catch (Exception e) {
            return null;
        }
        return null;
    }

    @Override
    public void run() throws Exception {
        boolean apply = "1".equals(System.getenv("HOTD2_APPLY"));

        MemoryBlock text = currentProgram.getMemory().getBlock(".text");
        if (text == null) {
            println("[hotd2] no .text block");
            return;
        }

        // Everything currently inside a function.
        AddressSet covered = new AddressSet();
        FunctionIterator fit = currentProgram.getFunctionManager().getFunctions(true);
        while (fit.hasNext()) covered.add(fit.next().getBody());

        AddressSet textSet = new AddressSet(text.getStart(), text.getEnd());
        AddressSetView gaps = textSet.subtract(covered);

        long gapBytes = gaps.getNumAddresses();
        int gapCount = gaps.getNumAddressRanges();

        List<String> created = new ArrayList<>();
        List<String> failures = new ArrayList<>();
        long instrBytes = 0, dataBytes = 0, padBytes = 0;
        int candidates = 0;

        for (var range : gaps.getAddressRanges()) {
            Address a = range.getMinAddress();
            Address end = range.getMaxAddress();

            // Classify what is already there.
            Instruction ins = getInstructionAt(a);
            if (ins != null) {
                instrBytes += range.getLength();
            } else if (getDataAt(a) != null && getDataAt(a).isDefined()) {
                dataBytes += range.getLength();
            }

            Address p = skipPadding(a, end);
            if (p == null) {
                padBytes += range.getLength();
                continue;
            }

            // Two ways a gap start qualifies:
            //   1. it looks like an MSVC function prologue, or
            //   2. it is already disassembled and sits immediately after
            //      padding, which is exactly how MSVC delimits functions.
            boolean orphanAfterPadding =
                getInstructionAt(p) != null && !p.equals(a);

            if (!looksLikeFunction(p) && !orphanAfterPadding) continue;

            candidates++;
            if (!apply) continue;

            try {
                if (getInstructionAt(p) == null) disassemble(p);
                Function f = createFunction(p, null);
                if (f != null) {
                    created.add(f.getEntryPoint().toString());
                } else if (failures.size() < 10) {
                    failures.add(p + ": createFunction returned null");
                }
            } catch (Exception e) {
                if (failures.size() < 10) failures.add(p + ": " + e);
            }
        }

        String out = System.getenv("HOTD2_OUT");
        if (out == null || out.isEmpty()) out = "/tmp";
        File dir = new File(out);
        dir.mkdirs();
        PrintWriter pw = new PrintWriter(new File(dir, "code_gaps.txt"));
        pw.println("Uncovered .text analysis");
        pw.println("========================");
        pw.printf(".text size            : %d%n", text.getSize());
        pw.printf("covered by functions  : %d%n", text.getSize() - gapBytes);
        pw.printf("uncovered             : %d  (%.1f%%)%n",
            gapBytes, 100.0 * gapBytes / text.getSize());
        pw.printf("uncovered ranges      : %d%n", gapCount);
        pw.printf("  already instructions: %d%n", instrBytes);
        pw.printf("  defined data        : %d%n", dataBytes);
        pw.printf("  pure padding        : %d%n", padBytes);
        pw.printf("prologue candidates   : %d%n", candidates);
        pw.printf("functions created     : %d%n", created.size());
        pw.println();
        for (String s : created) pw.println(s);
        pw.close();

        println("[hotd2] .text uncovered: " + gapBytes + " bytes in " + gapCount + " ranges");
        println("[hotd2]   already instructions: " + instrBytes);
        println("[hotd2]   defined data        : " + dataBytes);
        println("[hotd2]   pure padding        : " + padBytes);
        println("[hotd2] prologue candidates: " + candidates);
        println("[hotd2] functions created  : " + created.size() + (apply ? "" : "  (dry run)"));
        for (String s : failures) println("[hotd2]   fail: " + s);
    }
}
