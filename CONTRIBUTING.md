# Contributing to Splash Animator

Use the [README](README.md) to start the editor. This guide explains where to make changes and how to check them.

## Where to start

| To change | Start here |
| --- | --- |
| A stage tool, shortcut, dialog, or timeline control | [Editor](apps/editor/src), starting at `App.svelte` for command wiring |
| A saved field, schema migration, or project revision | [Document model and storage](packages/document/src) and the [.spl format](docs/SPL_FORMAT.md) |
| A brush stroke, editable curve, selection, or paint cut | [Geometry](packages/geometry/src), with editor worker calls in [geometry-worker.ts](apps/editor/src/geometry-worker.ts) |
| A tween, held drawing, or Movie Clip clock | [Animation](packages/animation/src) |
| Rendering one shape or compositing a layer | [Stage renderer](packages/stage/src) |
| A frame script or its preview | [Scripting](packages/scripting/src) and the [scripting guide](apps/editor/public/docs/scripting.html) |
| A Web folder export or standalone player | [Web exporter](packages/export-web/src), [editor publication](apps/editor/src/export-web-folder.ts), and [native folder writer](apps/editor/src-tauri/src/web_folder_export.rs) |
| Audio mixing, video encoding, or packaged app exports | [Audio](packages/audio/src), [video export](packages/export-video/src), and [app export](packages/export-app/src) |
| A desktop file dialog, storage adapter, or OS integration | [Desktop shell](apps/editor/src-tauri/src) and [editor storage](apps/editor/src/storage.ts) |

## Working in the code

- Keep reusable model, geometry and playback logic in `packages/`. The editor owns the current document, selection and UI state.
- A document edit should publish one complete result and create a coherent Undo entry. Async drawing and motion operations prepare a candidate, then confirm that the original project and editing context still own the result before applying it.
- Match the surrounding coordinate system and frame numbering. Document frames are zero based. The timeline and Export fields display one-based frame numbers. A Movie Clip can keep advancing while the parent timeline is stopped.
- Start from existing validation when adding saved data. Preserve older projects through migrations and keep immutable components separate from the published manifest.
- Prefer names that identify the domain object. Comment ownership, coordinate spaces, ordering requirements and why a limit or validation exists. Avoid comments that repeat the next line.

## Tests

Run from the repository root using the Node and pnpm versions in [package.json](package.json).

```sh
pnpm check
pnpm lint:changed
pnpm exec vitest run tests/<relevant-test>.test.ts
pnpm exec playwright install chromium
pnpm test:iterate tests/e2e/<relevant-spec>.spec.ts
pnpm test:licensing tests/e2e/export-window.spec.ts
cargo test --locked --manifest-path apps/editor/src-tauri/Cargo.toml
```

The focused browser runner uses port 1423 and an isolated project folder. Use `pnpm test:production` for changes that need verification against rebuilt bundles. The production browser suite uses port 1422.

Saving and exporting require a save-capable license in the editor. `pnpm test:licensing` generates a temporary fixture license for browser tests. On Windows, `pnpm test:native-project` builds a separate acceptance executable with a fixture license and exercises native project workflows. Production signing credentials are unnecessary for either fixture.

For drawing changes, verify the saved vector geometry as well as the rendered result. For storage, verify that a rejected write leaves the previous revision readable. Use small synthetic fixtures that can be shared with the repository.

In a review, describe the user-visible change, the checks you ran, and any remaining limitations. Keep mechanical formatting separate from behavior changes when possible.
