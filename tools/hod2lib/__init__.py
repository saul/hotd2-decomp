"""
hod2lib - parsers for The House of the Dead 2 (PC) asset formats.

Pure Python, no Blender dependency. Format specifications live in
``docs/formats/``; each module here implements exactly one of them.

Modules
-------
container   pol/ and tex/ outer wrapper: 0x800 offset table + transparent
            decompression                                    [Phase 3]
lz          the compression codec (LZSS, 8 KB window)          [Phase 2]
nl1         NaomiLib NL1 model parser                          [Phase 3]
texbank     tex/ texture bank layout + PowerVR2 decoding        [Phase 4]
exetab      descriptor / scene / route tables compiled into Hod2.exe
cam         camera and object paths: cubic Hermite curves       [Phase 6]
evt         event tables: pointer fixup + 96-opcode bytecode VM [Phase 6]
coli        collision meshes: AABB groups of planar quads       [Phase 6]
gltf        glTF 2.0 writer
png         minimal PNG writer
schema      the digest that ties a bundle to the TypeScript reading it

The character half is a small DAG rather than one module, and nothing in it
imports upwards::

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

Not yet implemented: ``mot`` (motion) -- the last unsolved format.

See ``docs/PROGRESS.md`` for phase status and ``docs/re/session-log.md`` for
where the last session stopped.
"""

__version__ = "0.6.0"
__all__ = []
