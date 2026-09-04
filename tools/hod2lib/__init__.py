"""
hod2lib - parsers for The House of the Dead 2 (PC) asset formats.

Pure Python, no Blender dependency. Format specifications live in
``docs/formats/``; each module here implements exactly one of them, and
nothing in the package imports upwards.

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
    bundle      the player bundle writer; owns ``BUNDLE_FORMAT``
    degraded    the record a partial export leaves, so nothing is lost silently
    gltf        glTF 2.0 writer
    png         minimal PNG writer
    schema      the digest that ties a bundle to the TypeScript reading it
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

Versioning: ``__version__`` lands in every bundle manifest as ``tool_version``
and is informational -- the number a reader validates against is
``bundle.BUNDLE_FORMAT``. **Move it when the package gains or loses a module**,
which is the event it failed to record last time.
"""

__version__ = "0.7.0"
__all__ = []
