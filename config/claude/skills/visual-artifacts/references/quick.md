# Quick: the answer, fast

Sean wants the point and the key numbers, then to move on. Start from
`templates/quick.src.html`.

Declare `<meta name="va:format" content="quick">` and pick a size:

| `va:size` | Use for | Limit |
|---|---|---|
| `concept` (default) | one idea, one mechanism, one problem | one screen (900 px tall at every width of 700 px or more), 150 words |
| `landscape` | a comparison, a vendor map, a whole field | three screens, 400 words |

`render_check.py` counts words statically, and it measures the height in a browser
(`quick-long`, `quick-tall`). Over the limit means cut the content. Never shrink
the type, and never move content into tabs or a collapsed block.

Order: an `h1`, one lede that states the answer, then the single best
representation (a map, a table or a chart) and at most three key numbers. No
sidebar, no ladder, no worked steps and no sources section; cite inline.

Offer a Guide or Learn page in one line of chat when more depth may help. Never
offer it on the page.
