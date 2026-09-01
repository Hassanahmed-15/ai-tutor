# Isolated sign-language accessibility module

This folder is the only owner of the optional signing experience. `LessonPlayer` supplies the
existing current caption and whether teacher narration is active; it does not change, filter, or
replace the transcript.

The pose data and fallback sequencing are derived from Kevin Jose Thomas's MIT-licensed
`sign-language-processing` project:

https://github.com/kevinjosethomas/sign-language-processing

Pose data snapshot: `c292039b77fecfad3821c71bff1de06e3fe559ec`.

The public upstream repository does not contain the PostgreSQL/pgvector database of roughly 9,500
lexical signs described in its README. Consequently this module accurately identifies itself as ASL
fingerspelling support. It uses upstream's published A-Z MediaPipe landmark sequences and the same
letter-by-letter fallback used when no semantic sign is available. `processing.ts` is the boundary
where a licensed lexical lookup can be added if that database or a compatible API becomes available.

The visual renderer is new. None of the upstream avatar, UI, Three.js scene, camera code, or styles
are included.

The feature is dynamically imported and its pose payload is fetched only when enabled. Turning it
off unmounts playback and stops its timers.
