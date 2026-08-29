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
gltf        glTF 2.0 writer
png         minimal PNG writer

Not yet implemented: ``mot`` (motion), ``coli`` (collision).

See ``docs/PROGRESS.md`` for phase status and ``docs/re/session-log.md`` for
where the last session stopped.
"""

__version__ = "0.6.0"
__all__ = []
