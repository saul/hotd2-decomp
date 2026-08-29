"""
hod2lib - parsers for The House of the Dead 2 (PC) asset formats.

Pure Python, no Blender dependency. Format specifications live in
``docs/formats/``; each module here implements exactly one of them.

Planned modules
---------------
container   pol/ and tex/ outer wrapper: 0x800 offset table + transparent
            decompression                                    [Phase 3]
lz          the compression codec                            [Phase 2, UNSOLVED]
nl1         NaomiLib NL1 model parser                        [Phase 3]
texbank     tex/ texture bank layout + PowerVR2 decoding      [Phase 4]
material    PowerVR2 ISP/TSP/TCT -> portable material state   [Phase 5]
cam         camera paths                                      [Phase 6]
mot         motion data                                       [Phase 6]
coli        collision data                                    [Phase 6]
evt         event tables                                       [Phase 6]

Nothing is implemented yet. Phase 0 established the baseline only; see
``docs/PROGRESS.md``.
"""

__version__ = "0.0.0"
__all__ = []
