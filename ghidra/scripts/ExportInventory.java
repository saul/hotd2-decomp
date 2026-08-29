/* Export a function + symbol inventory from the analysed HOTD2 program.
 *
 * Reproducible Phase 1 baseline. Writes CSV/TXT into the directory given by the
 * HOTD2_OUT environment variable so progress can be diffed between sessions.
 *
 * Run via ghidra/run.sh, or directly:
 *   support/analyzeHeadless <proj> HOTD2 -process Hod2.exe -noanalysis \
 *       -scriptPath ghidra/scripts -postScript ExportInventory.java
 *
 * @category HOTD2
 */

import java.io.File;
import java.io.PrintWriter;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;
import ghidra.program.model.listing.FunctionIterator;
import ghidra.program.model.mem.MemoryBlock;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.Symbol;

public class ExportInventory extends GhidraScript {

    private String out() {
        String o = System.getenv("HOTD2_OUT");
        return (o == null || o.isEmpty()) ? "/tmp" : o;
    }

    @Override
    public void run() throws Exception {
        File dir = new File(out());
        dir.mkdirs();

        PrintWriter fn = new PrintWriter(new File(dir, "functions.csv"));
        fn.println("addr,name,section,size,params,calling_conv,is_thunk,source,xrefs_to");

        int total = 0, named = 0, thunks = 0;
        long bytes = 0;

        FunctionIterator it = currentProgram.getFunctionManager().getFunctions(true);
        while (it.hasNext()) {
            Function f = it.next();
            Address ep = f.getEntryPoint();
            MemoryBlock blk = currentProgram.getMemory().getBlock(ep);
            Symbol sym = f.getSymbol();

            int xrefs = 0;
            if (sym != null) {
                for (Reference r : sym.getReferences()) {
                    xrefs++;
                }
            }

            String source = (sym == null) ? "" : sym.getSource().toString();
            long size = f.getBody().getNumAddresses();

            total++;
            bytes += size;
            if (f.isThunk()) thunks++;
            if (!"DEFAULT".equals(source) && !source.isEmpty()) named++;

            fn.printf("0x%s,%s,%s,%d,%d,%s,%d,%s,%d%n",
                ep,
                f.getName().replace(",", "_"),
                blk == null ? "" : blk.getName(),
                size,
                f.getParameterCount(),
                f.getCallingConventionName() == null ? "" : f.getCallingConventionName(),
                f.isThunk() ? 1 : 0,
                source,
                xrefs);
        }
        fn.close();

        PrintWriter s = new PrintWriter(new File(dir, "summary.txt"));
        s.println("HOTD2 Hod2.exe - Ghidra inventory");
        s.println("==============================================");
        s.printf("image base        : 0x%s%n", currentProgram.getImageBase());
        s.printf("language          : %s%n", currentProgram.getLanguageID());
        s.printf("compiler spec     : %s%n", currentProgram.getCompilerSpec().getCompilerSpecID());
        s.printf("functions total   : %d%n", total);
        s.printf("  non-default name: %d%n", named);
        s.printf("  thunks          : %d%n", thunks);
        s.printf("bytes in functions: %d%n", bytes);
        s.println();
        s.println("memory blocks:");
        for (MemoryBlock b : currentProgram.getMemory().getBlocks()) {
            s.printf("  %-10s %s - %s  (%d bytes)%n",
                b.getName(), b.getStart(), b.getEnd(), b.getSize());
        }
        s.close();

        println("[hotd2] wrote functions.csv (" + total + " functions) and summary.txt to " + dir);
    }
}
