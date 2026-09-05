"""
hod2lib - parsers for The House of the Dead 2 (PC) asset formats.

Pure Python, no Blender dependency. Format specifications live in
``docs/formats/``; each module here implements exactly one of them, and
nothing in the package imports upwards.

**This package no longer writes the player bundle.** `web/src/hod2lib/` is the
same library in TypeScript and is the only thing that does, because a bundle
has to be buildable inside the browser and two writers of one format is the
drift everything else here exists to prevent. ``bundle`` and ``schema`` went
with that change, once the two agreed byte for byte on all twelve stage
bundles. What is left is the reading half: the twenty ``tools/verify_*.py``
checks read the game through it, ``export_level.py`` writes glTF with it, and
it remains where each format is specified in code. See ``docs/TS_PORT.md``.

Every module is one indented row below, and ``tools/verify_exporters.py``
checks that list against the package on disk in both directions. It is checked
because it announced ``mot`` as "the last unsolved format" for weeks after
``mot.py`` landed, through a bundle format bump, while nine modules it never
mentioned were added around it.

Modules::

    container   pol/ and tex/ outer wrapper: 0x800 offset table, and
                transparent decompression
    lz          the compression codec (LZSS, 8 KB window)
    nl1         NaomiLib NL1 model parser
    texbank     tex/ texture bank layout + PowerVR2 decoding
    exetab      descriptor / scene / route tables compiled into Hod2.exe
    cam         camera and object paths: cubic Hermite curves
    campaths    the per-stage camera path index
    evt         event tables: pointer fixup + 96-opcode bytecode VM
    coli        collision meshes: AABB groups of planar quads
    mot         motion banks: the baked skeleton frames
    script      the event script as the player walks it
    stage       one stage assembled: regions, slots, and the models they name
    props       the breakable prop member records
    rigs        the object-path followers, and which slots each poses
    spawnres    resolving a spawn to a character type and an asset
    degraded    the record a partial export leaves, so nothing is lost silently
    gltf        glTF 2.0 writer
    png         minimal PNG writer
    bams        binary angles and the matrices they build
    arcscript   the twelve-dword three-stage arc motion scripts
    charmotion  which motion a spawn starts in, and the baked frames
    combat      what a shot does: damage, reactions, attacks, gore, death
    approach    the rings an enemy advances through, and the camera on it
    class31     class 0x31's four behaviour sets
    actorscript the bytecode blobs an actor state steps through
    placement   one spawn's descriptor tail, decoded
    charbuild   assembling one character type and its glTF rig
    characters  the two functions that need all of the above, and the
                package's front door for every name they moved out of

The last ten form a small DAG: ``characters`` is the front door, and the rows
above it are what it stands on.

Phase status is in ``docs/PROGRESS.md`` and every count is in
``docs/STATUS.md``; neither is restated here. This docstring says what each
module *is*, which is the part no tool can compute.

Versioning: ``__version__`` is what a bundle manifest names as
``tool_version``. The TypeScript exporter writes it -- it is spelled there as
``TOOL_VERSION`` and `tools/verify_exporters.py` checks the two agree -- and it
is informational either way; the number a reader validates against is
``BUNDLE_FORMAT``, which now has one definition, in `web/src/hod2lib/
bundle.ts`. **Move it when the package gains or loses a module**, which is the
event it failed to record last time.
"""

__version__ = "0.8.0"
__all__ = []
