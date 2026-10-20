KaTeX 0.16.11 (MIT, https://katex.org). Vendored from cdnjs: katex.min.css and the woff2 fonts it references.
assemble.py inlines them as data URIs, because an Artifact cannot load stylesheets or fonts from a CDN.
