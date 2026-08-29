/* Name and tag the DX7 SDK d3du/D3DX utility-library functions.
 *
 * The library is stock Microsoft sample code compiled into the game. Its
 * diagnostic strings carry the literal "Class::Method - message" text, so the
 * owning function can be named exactly rather than guessed.
 *
 * Every function touched is tagged D3DX_LIB so library noise can be filtered
 * out of function listings later.
 *
 * Idempotent: re-running renames nothing that already has a non-default name.
 *
 * @category HOTD2
 */

import java.io.File;
import java.io.PrintWriter;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Data;
import ghidra.program.model.listing.DataIterator;
import ghidra.program.model.listing.Function;
import ghidra.program.model.symbol.Reference;
import ghidra.program.model.symbol.ReferenceIterator;
import ghidra.program.model.symbol.SourceType;

public class TagLibraryFunctions extends GhidraScript {

    /** "CD3duContext::Resize - ...", "D3DXInitialize - ...", "_ChooseZBuffer - ..." */
    private static final Pattern DIAG = Pattern.compile(
        "^B?((?:CD3du\\w*|CHelInfo|CD3DX\\w*)(?:::\\w+)?|_?[dD]3[dD][xX]\\w*|_Choose\\w+)\\s*-\\s+.*");

    private static final String TAG = "D3DX_LIB";

    private String sanitise(String s) {
        return s.replace("::", "__").replaceAll("[^A-Za-z0-9_]", "_");
    }

    @Override
    public void run() throws Exception {
        // function entry -> candidate name -> hit count
        Map<Address, Map<String, Integer>> votes = new LinkedHashMap<>();
        int stringsMatched = 0;

        DataIterator it = currentProgram.getListing().getDefinedData(true);
        while (it.hasNext()) {
            Data d = it.next();
            Object v = d.getValue();
            if (!(v instanceof String)) continue;

            Matcher m = DIAG.matcher(((String) v).trim());
            if (!m.matches()) continue;
            stringsMatched++;

            String name = sanitise(m.group(1));

            ReferenceIterator refs =
                currentProgram.getReferenceManager().getReferencesTo(d.getAddress());
            while (refs.hasNext()) {
                Reference r = refs.next();
                Function f = getFunctionContaining(r.getFromAddress());
                if (f == null) continue;
                votes.computeIfAbsent(f.getEntryPoint(), k -> new HashMap<>())
                     .merge(name, 1, Integer::sum);
            }
        }

        // Apply: each function takes its most-voted name; collisions get suffixed.
        Map<String, Integer> used = new HashMap<>();
        List<String> renamed = new ArrayList<>();
        int tagged = 0, skipped = 0;

        for (Map.Entry<Address, Map<String, Integer>> e : votes.entrySet()) {
            Function f = getFunctionAt(e.getKey());
            if (f == null) continue;

            try {
                f.addTag(TAG);
                tagged++;
            } catch (Exception ex) {
                // tag already present
            }

            boolean isDefault = f.getSymbol() == null
                || f.getSymbol().getSource() == SourceType.DEFAULT;
            if (!isDefault) {
                skipped++;
                continue;
            }

            String best = null;
            int bestN = -1;
            for (Map.Entry<String, Integer> c : e.getValue().entrySet()) {
                if (c.getValue() > bestN) { bestN = c.getValue(); best = c.getKey(); }
            }
            if (best == null) continue;

            int n = used.merge(best, 1, Integer::sum);
            String finalName = (n == 1) ? best : best + "_" + n;

            try {
                f.setName(finalName, SourceType.ANALYSIS);
                renamed.add(String.format("%s  %s", f.getEntryPoint(), finalName));
            } catch (Exception ex) {
                println("[hotd2] could not rename " + f.getEntryPoint() + ": " + ex.getMessage());
            }
        }

        String out = System.getenv("HOTD2_OUT");
        if (out == null || out.isEmpty()) out = "/tmp";
        File dir = new File(out);
        dir.mkdirs();
        PrintWriter pw = new PrintWriter(new File(dir, "d3dx_lib.txt"));
        pw.println("DX7 SDK d3du/D3DX library functions identified from diagnostic strings");
        pw.println("tag: " + TAG);
        pw.println();
        for (String s : renamed) pw.println(s);
        pw.close();

        println("[hotd2] diagnostic strings matched : " + stringsMatched);
        println("[hotd2] library functions tagged   : " + tagged);
        println("[hotd2] renamed                    : " + renamed.size());
        println("[hotd2] already named, left alone  : " + skipped);
    }
}
