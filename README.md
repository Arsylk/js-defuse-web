# js-defuse-web

The single-page front end for [js-defuser](https://github.com/Arsylk/js-defuser):
paste obfuscated JavaScript, get the source back. Live at
**https://arsylk.github.io/js-defuse-web/**.

Everything runs in your browser. The engine is the same package the CLI and the test
suite use, loaded in a Web Worker; the slices it has to evaluate (string decoders,
state-array helpers) run on QuickJS compiled to WebAssembly, a separate engine with its
own heap and a time budget. Nothing you paste leaves the page.

The layout: pass menu on the left (every pass with a one-line description, the default
set pre-selected), input and output editors in the middle, the AST of the output on
the right, and the engine's live pass log at the bottom. *Examples* loads js-confuser
and obfuscator.io samples, including js-confuser's editor demo at its maximum settings
with all locks on — that one takes a minute or two and comes back as `greet("Internet User")`.

## Development

```sh
npm install
npm run dev      # http://localhost:5173/js-defuse-web/
npm run build    # typecheck + static build into dist/
```

`#example=<id>&run` in the URL preloads an example and starts it, which is what the
smoke test uses. Deployed by `.github/workflows/pages.yml` on every push to `main`.

MIT © Krzysztof Iwaniuk (Arsylk)
