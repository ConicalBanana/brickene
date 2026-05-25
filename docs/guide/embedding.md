# Embedding & Scaling

brickene ships two HTML host pages that demonstrate embedding the editor in an
`<iframe>`.  Both pages accept URL parameters that let you control the rendered
size of the UI without touching any source files.

## Pages

| File | Description |
|------|-------------|
| `iframe-example.html` | Full-width reference embedding example with a result panel on the right. |
| `iframe-example-small.html` | Compact half-width version — the editor column is fixed to `50 vw`; useful for previews, dashboards, and low-resolution embeds. |

Serve the `brickene/frontend/` directory with any static HTTP server (e.g.
`http-server`) or use `./start.sh` which starts both the render backend and the
frontend together.

## `?scale=<ratio>` — uniform component scaling

Append `?scale=<ratio>` to any of the three HTML pages to resize **all UI
components proportionally**.

| URL | Effect |
|-----|--------|
| `iframe-example.html?scale=0.5` | Renders the host page at 50 % of its normal size. |
| `iframe-example-small.html?scale=0.4` | Compact page at 40 % scale. |
| `index.html?scale=0.75` | Editor alone at 75 % scale (useful when the editor is embedded in a third-party host page). |

`scale=1` (or omitting the parameter entirely) is a no-op — the layout is left
untouched.

### How it works

The scaling is implemented with a CSS `transform` applied to `document.body`
immediately after page load:

```js
body.style.transform       = `scale(${scale})`;
body.style.transformOrigin = "top left";
body.style.width           = `${100 / scale}%`;
body.style.height          = `${100 / scale}vh`;
```

Expanding the logical width and height by `1 / scale` compensates for the
fact that `transform: scale()` shrinks the visual rendering while leaving the
layout box unchanged — without the compensation, scaled-down content would
leave blank space at the right and bottom of the viewport.

> **Note on pointer events and canvas interactions**
>
> CSS `transform: scale()` is applied to the whole document, so pointer
> coordinates reported by the browser are already in the scaled coordinate
> space.  brickene's canvas uses `getBoundingClientRect()` for hit-testing,
> which reflects the transform, so mouse interactions behave correctly at any
> scale value.

### `iframe-example-small.html` — parameter forwarding

`iframe-example-small.html` automatically forwards the active `scale` value
into the embedded `index.html` via the iframe `src` attribute:

```
index.html?scale=0.5
```

This means the editor's own UI shrinks to fit the narrower `50 vw` column,
rather than being clipped at the edge.

## Additional parameters (`iframe-example-small.html` only)

| Parameter | Default | Description |
|-----------|---------|-------------|
| `scale` | `0.5` | Uniform scale ratio for both the host page and the embedded editor. |
| `editorWidth` | — | Override the editor column width in pixels. When set, the `50 vw` CSS variable is replaced with an inline pixel value (e.g. `?editorWidth=700`). |

### Examples

```
# Default half-width view (scale 0.5)
http://127.0.0.1:8081/iframe-example-small.html

# 40 % scale
http://127.0.0.1:8081/iframe-example-small.html?scale=0.4

# Fixed 700 px editor column at default scale
http://127.0.0.1:8081/iframe-example-small.html?editorWidth=700

# 700 px column at 60 % scale
http://127.0.0.1:8081/iframe-example-small.html?editorWidth=700&scale=0.6
```

## Embedding in a third-party host page

When you embed `index.html` inside your own `<iframe>`, pass the `scale`
parameter in the `src` URL to pre-scale the editor to fit your layout:

```html
<iframe
  src="http://127.0.0.1:8081/index.html?scale=0.6&renderApiUrl=http://127.0.0.1:8765"
  width="800"
  height="600"
  title="Brickene editor"
  allow="clipboard-write"
></iframe>
```

The `renderApiUrl` search parameter (separate from `scale`) tells the editor
where the Python render backend is listening.
