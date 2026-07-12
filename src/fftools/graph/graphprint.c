/*
 * Fork stub of fftools/graph/graphprint.c for the ffmpeg.wasm build.
 *
 * Upstream 8.x's graphprint.c renders the filtergraph as text/JSON/Mermaid and,
 * for the Mermaid HTML export, pulls in fftools/resources/resman.c plus a set of
 * build-generated resource blobs (minified + gzipped graph.html / graph.css).
 * That resource-generation pipeline is part of FFmpeg's own make and is not
 * reproduced by this project's hand-rolled build/ffmpeg-wasm.sh.
 *
 * The `-print_graphs*` options are pure diagnostics with no place in a lean
 * WebAssembly transcode/clip core, so rather than vendor graphprint.c + resman.c
 * and replicate the resource bundling, we provide no-op definitions of the two
 * public entry points. The real header (graphprint.h) is kept for signature
 * fidelity, and the `print_graphs*` option variables (fftools/ffmpeg_opt.c) still
 * parse — passing the options simply produces no output. Both call sites
 * (fftools/ffmpeg.c ffmpeg_cleanup, fftools/ffmpeg_filter.c) are gated on those
 * options, which default to off, so these functions are never reached at runtime
 * unless explicitly requested.
 */

#include "graphprint.h"

int print_filtergraphs(FilterGraph **graphs, int nb_graphs,
                       InputFile **ifiles, int nb_ifiles,
                       OutputFile **ofiles, int nb_ofiles)
{
    return 0;
}

int print_filtergraph(FilterGraph *fg, AVFilterGraph *graph)
{
    return 0;
}
