<script lang="ts">
  import { appendHistory, HistoryEntry, moveHistory } from '../../../packages/document/src/history-storage';
  import { onMount, onDestroy, untrack } from 'svelte';
  import type { Point, Vector } from '../../../packages/document/src';
  import {
    matrix,
    multiply,
    inversePoint,
    type Matrix,
  } from '../../../packages/geometry/src/affine';
  import { formatTextRange, type TextStyle } from '../../../packages/geometry/src/rich-text';
  import { textRange } from '../../../packages/geometry/src/text-range';
  import {
    textFieldLayout,
    measureTextField,
    replaceTextContent,
    textCaret,
    textOffsetAt,
    textSelectionRects,
    textWordRange,
    textFormatting,
    textStyleKeys,
    replaceTextSelection,
  } from './text-authoring';
  let {
    shape,
    view,
    width,
    height,
    initialPoint,
    selectAll = false,
    creating = false,
    preview,
    apply,
    cancel,
    outside,
    selection,
    formatting,
  }: {
    shape: Vector;
    view: Matrix;
    width: number;
    height: number;
    initialPoint?: Point;
    selectAll?: boolean;
    creating?: boolean;
    preview: (shape: Vector) => void;
    apply: (shape: Vector, admit: () => void) => string | null;
    cancel: () => void;
    outside?: (e: PointerEvent) => void;
    selection?: (start: number, end: number, content: string) => void;
    formatting?: (style: TextStyle) => void;
  } = $props();
  let value = $state.raw(untrack(() => structuredClone(shape))),
    start = $state(0),
    end = $state(0),
    focus = $state(true),
    blink = $state(true),
    message = $state(''),
    composing = $state(false);
  let root: HTMLDivElement, canvas: HTMLCanvasElement, input: HTMLTextAreaElement;
  let alive = true,
    revision = 0,
    publishing = false,
    completed = false,
    group = '',
    lastTime = 0,
    typing: TextStyle = {};
  let pendingInput:
    | {
        value: Vector;
        revision: number;
        start: number;
        end: number;
        direction: 'forward' | 'backward' | 'none';
      }
    | undefined;
  let preferredX: number | undefined;
  type Snapshot = {
    value: Vector;
    start: number;
    end: number;
    direction: 'forward' | 'backward' | 'none';
    typing: TextStyle;
  };
  function snapshot(): Snapshot {
    return {
      value: structuredClone(value),
      start,
      end,
      direction: input?.selectionDirection ?? 'none',
      typing: { ...typing },
    };
  }
  let past: HistoryEntry<Snapshot>[] = [],
    future: HistoryEntry<Snapshot>[] = [];
  let drag:
    | {
        pointer: number;
        anchor: number;
        resize?: {
          left: boolean;
          original: Vector;
          point: Point;
          revision: number;
          past: HistoryEntry<Snapshot>[];
          future: HistoryEntry<Snapshot>[];
          view: Matrix;
          box: string;
        };
      }
    | undefined;
  const placement = $derived(multiply(view, matrix(value)));
  const metrics = document.createElement('canvas').getContext('2d')!;
  const layout = $derived(textFieldLayout(metrics, value));
  const fieldWidth = $derived(
    Math.max(value.width, creating && !value.text!.content ? value.text!.size : 1),
  );
  function emit() {
    revision++;
    preview(structuredClone(value));
    selection?.(start, end, value.text!.content);
    reportFormatting();
    blink = true;
  }
  function reportFormatting() {
    formatting?.(textFormatting(value, start, end, typing));
  }
  function sync(direction: 'forward' | 'backward' | 'none' = 'forward') {
    if (!alive || !input) return;
    input.value = value.text!.content;
    input.setSelectionRange(start, end, direction);
    selection?.(start, end, input.value);
    reportFormatting();
  }
  function changed(next: Vector, kind = 'format', before?: Snapshot) {
    if (kind === 'format' || kind !== group || performance.now() - lastTime > 750) {
      past = appendHistory(past, new HistoryEntry(before ?? snapshot()), undefined, 100);
    }
    group = kind;
    lastTime = performance.now();
    future = [];
    value = next;
    emit();
  }
  function blurred(e: FocusEvent) {
    focus = false;
    const target = e.relatedTarget as HTMLElement | null;
    if (
      alive &&
      target &&
      !root.contains(target) &&
      !target.closest('#dock-body-text,[data-canvas-text-properties]')
    )
      finish();
  }
  function readSelection() {
    if (!alive || !input) return;
    if (start !== input.selectionStart || end !== input.selectionEnd) {
      typing = {};
      group = '';
    }
    start = input.selectionStart;
    end = input.selectionEnd;
    selection?.(start, end, value.text!.content);
    reportFormatting();
    blink = true;
  }
  export function selectInspectorRange(
    content: string,
    first: number,
    last: number,
    direction: HTMLTextAreaElement['selectionDirection'],
  ) {
    if (!alive || !input || publishing || completed || composing || drag ||
      content !== value.text!.content || input.value !== content) return;
    const range = textRange(content, first, last);
    input.setSelectionRange(range.start, range.end, direction ?? 'none');
    readSelection();
  }
  function edited(event: Event) {
    try {
      const captured = pendingInput;
      pendingInput = undefined;
      const count = captured
        ? input.value.length - (value.text!.content.length - (captured.end - captured.start))
        : -1;
      const exact =
        captured &&
        captured.value === value &&
        captured.revision === revision &&
        count >= 0 &&
        input.value.slice(0, captured.start) === value.text!.content.slice(0, captured.start) &&
        input.value.slice(captured.start + count) === value.text!.content.slice(captured.end);
      const next = exact
        ? replaceTextSelection(
            metrics,
            value,
            captured.start,
            captured.end,
            input.value.slice(captured.start, captured.start + count),
            typing,
          )
        : replaceTextContent(metrics, value, input.value);
      const before = snapshot();
      before.start = captured?.start ?? start;
      before.end = captured?.end ?? end;
      before.direction = captured?.direction ?? 'none';
      start = input.selectionStart;
      end = input.selectionEnd;
      changed(
        next,
        composing
          ? 'composition'
          : (event instanceof InputEvent ? event.inputType : 'typing') || 'typing',
        before,
      );
      message = '';
      preferredX = undefined;
    } catch (cause) {
      message = String(cause);
      sync();
    }
  }
  export function properties(patch: Partial<NonNullable<Vector['text']>>) {
    try {
      if (
        Object.keys(patch).length &&
        Object.keys(patch).every((key) => (textStyleKeys as readonly string[]).includes(key))
      ) {
        format(patch as TextStyle);
        return;
      }
      let next =
        patch.content !== undefined
          ? replaceTextContent(metrics, value, patch.content)
          : structuredClone(value);
      next.text = { ...next.text!, ...patch, content: next.text!.content };
      next = measureTextField(metrics, next);
      const before = snapshot();
      if (patch.content !== undefined) {
        start = Math.min(start, next.text!.content.length);
        end = Math.min(end, next.text!.content.length);
        typing = {};
      }
      changed(next, 'format', before);
      sync();
      message = '';
    } catch (cause) {
      message = String(cause);
    }
  }
  export function format(patch: TextStyle) {
    try {
      // Use the persisted run validator before keeping pending caret attributes.
      formatTextRange('x', [], 0, 1, patch);
      message = '';
      if (start === end) {
        group = '';
        typing = { ...typing, ...patch };
        if (!value.text!.content.length) {
          const next = structuredClone(value);
          for (const key of textStyleKeys)
            if (key !== 'color' && patch[key] !== undefined)
              Object.assign(next.text!, { [key]: patch[key] });
          if (patch.color !== undefined) next.fill = patch.color;
          changed(measureTextField(metrics, next));
        }
        reportFormatting();
        input.focus({ preventScroll: true });
        return;
      }
      const next = structuredClone(value);
      next.text!.runs = formatTextRange(
        next.text!.content,
        next.text!.runs ?? [],
        start,
        end,
        patch,
      );
      changed(measureTextField(metrics, next));
      sync();
      input.focus({ preventScroll: true });
    } catch (cause) {
      message = String(cause);
    }
  }
  export function finish(): boolean {
    if (completed) return true;
    if (drag) {
      message = 'Release or cancel the text selection or resize before leaving the field.';
      return false;
    }
    if (publishing || composing) {
      message = 'Finish the current text composition before leaving the text field.';
      return false;
    }
    publishing = true;
    try {
      const original = value,
        at = revision,
        signature = JSON.stringify(value),
        a = start,
        b = end;
      const admit = () => {
        if (
          !alive ||
          value !== original ||
          revision !== at ||
          JSON.stringify(value) !== signature ||
          composing ||
          start !== a ||
          end !== b
        )
          throw Error('Text input changed during preparation. Try finishing again.');
      };
      const candidate = structuredClone(value);
      admit();
      if (JSON.stringify(candidate) !== signature)
        throw Error('Prepared text copy changed before publication.');
      message = apply(candidate, admit) ?? '';
      completed = !message;
      return completed;
    } catch (cause) {
      message = String(cause);
      return false;
    } finally {
      publishing = false;
    }
  }
  function key(e: KeyboardEvent) {
    e.stopPropagation();
    if (e.isComposing || composing) return;
    if (e.key === 'Escape' && drag) {
      e.preventDefault();
      const pointer = drag.pointer;
      abort({ pointerId: pointer });
      if (root.hasPointerCapture(pointer)) root.releasePointerCapture(pointer);
      if (e.shiftKey) {
        completed = true;
        cancel();
      }
      return;
    }
    if (e.key === 'Escape' || e.key === 'Tab' || ((e.ctrlKey || e.metaKey) && e.key === 'Enter')) {
      e.preventDefault();
      if (e.key === 'Escape' && e.shiftKey) {
        completed = true;
        cancel();
      } else finish();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && ['b', 'i'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const prop = e.key.toLowerCase() === 'b' ? 'bold' : 'italic',
        style = textFormatting(value, start, end, typing);
      format({ [prop]: !style[prop] });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && ['z', 'y'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const redo = e.key.toLowerCase() === 'y' || e.shiftKey,
        stack = redo ? future : past;
      if (stack.length) {
        const destination = redo ? past : future;
        const next = stack.at(-1)!.read();
        const moved = moveHistory(stack, destination, new HistoryEntry(snapshot()), undefined, 100);
        if (stack !== (redo ? future : past) || destination !== (redo ? past : future)) return;
        past = redo ? moved.destination : moved.source;
        future = redo ? moved.source : moved.destination;
        value = next.value;
        start = next.start;
        end = next.end;
        typing = next.typing;
        preferredX = undefined;
        group = '';
        emit();
        sync(next.direction);
      }
      return;
    }
    if (['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(e.key) && !(e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      const ctx = metrics,
        caret = textCaret(
          ctx,
          value,
          layout,
          input.selectionDirection === 'backward' ? start : end,
        ),
        line = layout.find((l) => caret.y === l.top)!;
      const vertical = e.key === 'ArrowUp' || e.key === 'ArrowDown';
      if (vertical) preferredX ??= caret.x;
      else preferredX = undefined;
      const target =
        e.key === 'Home'
          ? line.start
          : e.key === 'End'
            ? line.end
            : textOffsetAt(ctx, value, layout, {
                x: preferredX ?? caret.x,
                y: caret.y + (e.key === 'ArrowUp' ? -1 : caret.height + 1),
              });
      if (e.shiftKey) {
        const anchor = input.selectionDirection === 'backward' ? end : start;
        start = Math.min(anchor, target);
        end = Math.max(anchor, target);
        input.setSelectionRange(start, end, target < anchor ? 'backward' : 'forward');
      } else {
        start = end = target;
        sync();
      }
      readSelection();
      typing = {};
      reportFormatting();
      group = '';
      return;
    }
    if (e.key.startsWith('Arrow')) {
      group = '';
      typing = {};
      preferredX = undefined;
    }
  }
  function local(e: PointerEvent, rect = root.getBoundingClientRect()) {
    const p = inversePoint(placement, {
      x: ((e.clientX - rect.left) * width) / rect.width,
      y: ((e.clientY - rect.top) * height) / rect.height,
    });
    return p;
  }
  function pick(e: PointerEvent) {
    if (drag || e.isPrimary === false) {
      e.preventDefault();
      return;
    }
    if (e.button !== 0 || e.pointerType === 'touch' || composing) return;
    const rect = root.getBoundingClientRect(),
      p = local(e, rect),
      scale = Math.max(0.00001, Math.hypot(placement[0], placement[1])),
      radius = 7 / scale;
    const handle = [
      { x: 0, y: 0, left: true },
      { x: fieldWidth, y: 0, left: false },
      { x: 0, y: value.height, left: true },
      { x: fieldWidth, y: value.height, left: false },
    ].find((h) => Math.hypot(p.x - h.x, p.y - h.y) <= radius);
    if (
      !handle &&
      (p.x < -radius || p.y < -radius || p.x > fieldWidth + radius || p.y > value.height + radius)
    ) {
      e.preventDefault();
      if (finish()) outside?.(e);
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    input.focus({ preventScroll: true });
    group = '';
    typing = {};
    preferredX = undefined;
    if (handle) {
      const source = value,
        sourceStamp = JSON.stringify(value),
        sourceRevision = revision,
        sourcePast = past,
        sourceFuture = future,
        sourceView = [...view] as Matrix,
        box = JSON.stringify([rect.left, rect.top, rect.width, rect.height]);
      const original = structuredClone(value),
        nextPast = appendHistory(sourcePast, new HistoryEntry(snapshot()), undefined, 100),
        fresh = root.getBoundingClientRect();
      if (
        value !== source ||
        revision !== sourceRevision ||
        past !== sourcePast ||
        future !== sourceFuture ||
        JSON.stringify(value) !== sourceStamp ||
        JSON.stringify(original) !== sourceStamp ||
        JSON.stringify(view) !== JSON.stringify(sourceView) ||
        JSON.stringify([fresh.left, fresh.top, fresh.width, fresh.height]) !== box
      ) {
        message = 'Original text or view changed before resize capture.';
        return;
      }
      drag = {
        pointer: e.pointerId,
        anchor: start,
        resize: {
          left: handle.left,
          original,
          point: p,
          revision: sourceRevision,
          past: sourcePast,
          future: sourceFuture,
          view: sourceView,
          box,
        },
      };
      past = nextPast;
      future = [];
    } else {
      const at = textOffsetAt(metrics, value, layout, {
        x: p.x / (value.text!.scaleX || 1),
        y: p.y / (value.text!.scaleY || 1),
      });
      const selectionAnchor = e.shiftKey
        ? input.selectionDirection === 'backward'
          ? end
          : start
        : at;
      if (e.detail === 2) {
        const range = textWordRange(value.text!.content, at);
        start = range.start;
        end = range.end;
      } else if (e.detail >= 3) {
        start = value.text!.content.lastIndexOf('\n', Math.max(0, at - 1)) + 1;
        const next = value.text!.content.indexOf('\n', at);
        end = next < 0 ? value.text!.content.length : next;
      } else {
        const anchor = selectionAnchor;
        start = Math.min(anchor, at);
        end = Math.max(anchor, at);
      }
      const anchor = selectionAnchor;
      sync(at < selectionAnchor ? 'backward' : 'forward');
      drag = { pointer: e.pointerId, anchor };
    }
    root.setPointerCapture(e.pointerId);
  }
  function doubleClick(e: MouseEvent) {
    e.preventDefault();
    const rect = root.getBoundingClientRect(),
      p = inversePoint(placement, {
        x: ((e.clientX - rect.left) * width) / rect.width,
        y: ((e.clientY - rect.top) * height) / rect.height,
      }),
      radius = 7 / Math.max(0.00001, Math.hypot(placement[0], placement[1]));
    if (
      [0, fieldWidth].some((x) =>
        [0, value.height].some((y) => Math.hypot(p.x - x, p.y - y) < radius),
      )
    ) {
      const next = structuredClone(value);
      next.text!.wrapWidth = next.text!.wrapWidth
        ? 0
        : Math.max(1, next.width / (next.text!.scaleX || 1));
      changed(measureTextField(metrics, next));
    } else {
      const at = textOffsetAt(metrics, value, layout, {
          x: p.x / (value.text!.scaleX || 1),
          y: p.y / (value.text!.scaleY || 1),
        }),
        range = textWordRange(value.text!.content, at);
      start = range.start;
      end = range.end;
      typing = {};
      sync();
    }
  }
  function click(e: MouseEvent) {
    if (e.detail !== 3) return;
    const p = local(e as PointerEvent),
      at = textOffsetAt(metrics, value, layout, {
        x: p.x / (value.text!.scaleX || 1),
        y: p.y / (value.text!.scaleY || 1),
      });
    start = value.text!.content.lastIndexOf('\n', Math.max(0, at - 1)) + 1;
    const next = value.text!.content.indexOf('\n', at);
    end = next < 0 ? value.text!.content.length : next;
    typing = {};
    sync();
  }
  function move(e: PointerEvent) {
    if (drag?.pointer !== e.pointerId) return;
    const p = local(e);
    if (drag.resize) {
      const r = drag.resize,
        rect = root.getBoundingClientRect(),
        point = inversePoint(multiply(view, matrix(r.original)), {
          x: ((e.clientX - rect.left) * width) / rect.width,
          y: ((e.clientY - rect.top) * height) / rect.height,
        });
      const next = structuredClone(r.original),
        basis = matrix(r.original),
        delta = point.x - r.point.x,
        left = r.left ? Math.min(r.original.width - 1, delta) : 0;
      if (revision !== r.revision) {
        drag = undefined;
        message = 'Text changed during resizing; the resize was cancelled.';
        return;
      }
      if (
        JSON.stringify(view) !== JSON.stringify(r.view) ||
        JSON.stringify([rect.left, rect.top, rect.width, rect.height]) !== r.box
      ) {
        value = structuredClone(r.original);
        past = r.past;
        future = r.future;
        emit();
        drag = undefined;
        if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
        message = 'Text view changed; the resize was cancelled.';
        return;
      }
      if (Math.abs(delta) < 0.0000001) {
        if (JSON.stringify(value) !== JSON.stringify(r.original)) {
          value = structuredClone(r.original);
          emit();
          r.revision = revision;
        }
        return;
      }
      next.text!.wrapWidth = Math.max(
        1,
        (r.left ? r.original.width - left : r.original.width + delta) / (next.text!.scaleX || 1),
      );
      next.x += basis[0] * left;
      next.y += basis[1] * left;
      try {
        value = measureTextField(metrics, next);
        emit();
        r.revision = revision;
      } catch (cause) {
        value = structuredClone(r.original);
        past = r.past;
        future = r.future;
        emit();
        drag = undefined;
        if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
        message = String(cause);
      }
    } else {
      const at = textOffsetAt(metrics, value, layout, {
        x: p.x / (value.text!.scaleX || 1),
        y: p.y / (value.text!.scaleY || 1),
      });
      start = Math.min(at, drag.anchor);
      end = Math.max(at, drag.anchor);
      sync(at < drag.anchor ? 'backward' : 'forward');
    }
  }
  function release(e: PointerEvent) {
    if (drag?.pointer !== e.pointerId) return;
    move(e);
    if (drag?.resize && JSON.stringify(value) === JSON.stringify(drag.resize.original)) {
      past = drag.resize.past;
      future = drag.resize.future;
    }
    drag = undefined;
    if (root.hasPointerCapture(e.pointerId)) root.releasePointerCapture(e.pointerId);
  }
  function abort(e: Pick<PointerEvent, 'pointerId'>) {
    if (drag?.pointer !== e.pointerId) return;
    if (drag.resize && revision === drag.resize.revision) {
      value = drag.resize.original;
      past = drag.resize.past;
      future = drag.resize.future;
      emit();
    }
    drag = undefined;
  }
  function paint() {
    if (!canvas || !layout.length) return;
    const dpr = devicePixelRatio || 1,
      ctx = canvas.getContext('2d')!;
    const w = Math.max(1, Math.round(width * dpr)),
      h = Math.max(1, Math.round(height * dpr));
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    } else {
      ctx.resetTransform();
      ctx.clearRect(0, 0, w, h);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.transform(...placement);
    ctx.strokeStyle = '#1284c4';
    ctx.lineWidth = 1 / Math.max(0.00001, Math.hypot(placement[0], placement[1]));
    ctx.strokeRect(0, 0, fieldWidth, value.height);
    const size = 6 / Math.max(0.00001, Math.hypot(placement[0], placement[1]));
    ctx.fillStyle = '#ffffff';
    for (const x of [0, fieldWidth])
      for (const y of [0, value.height]) {
        ctx.beginPath();
        if (value.text!.wrapWidth) ctx.rect(x - size / 2, y - size / 2, size, size);
        else ctx.arc(x, y, size / 2, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    ctx.scale(value.text!.scaleX ?? 1, value.text!.scaleY ?? 1);
    if (start !== end) {
      ctx.fillStyle = '#1389e549';
      for (const rect of textSelectionRects(ctx, value, layout, start, end))
        ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    } else if (focus && blink) {
      const c = textCaret(ctx, value, layout, end);
      ctx.strokeStyle = '#172538';
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(c.x, c.y + c.height);
      ctx.stroke();
    }
  }
  $effect(() => {
    void value;
    void start;
    void end;
    void width;
    void height;
    void view;
    void focus;
    void blink;
    paint();
  });
  onMount(() => {
    if (selectAll) {
      start = 0;
      end = value.text!.content.length;
    } else if (initialPoint) {
      const p = inversePoint(matrix(value), initialPoint);
      start = end = textOffsetAt(metrics, value, layout, {
        x: p.x / (value.text!.scaleX || 1),
        y: p.y / (value.text!.scaleY || 1),
      });
    } else start = end = value.text!.content.length;
    sync();
    input.focus({ preventScroll: true });
    preview(structuredClone(value));
    paint();
    const clicked = (e: PointerEvent) => {
      if (
        !root.contains(e.target as Node) &&
        !(e.target as HTMLElement)?.closest('#dock-body-text,[data-canvas-text-properties]')
      ) {
        if (!finish()) {
          e.preventDefault();
          e.stopImmediatePropagation();
        }
      }
    };
    const focused = (e: FocusEvent) => {
      const target = e.target as HTMLElement;
      if (
        alive &&
        !root.contains(target) &&
        !target.closest('#dock-body-text,[data-canvas-text-properties]')
      )
        finish();
    };
    window.addEventListener('focusin', focused, true);
    window.addEventListener('pointerdown', clicked, true);
    const timer = setInterval(() => (blink = !blink), 530);
    return () => {
      window.removeEventListener('pointerdown', clicked, true);
      window.removeEventListener('focusin', focused, true);
      clearInterval(timer);
    };
  });
  onDestroy(() => {
    alive = false;
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_noninteractive_element_interactions (The native textarea provides keyboard character and paragraph selection.) -->
<div
  class="text-editing"
  bind:this={root}
  role="region"
  aria-label="On-canvas text editing"
  onpointerdown={pick}
  ondblclick={doubleClick}
  onclick={click}
  onpointermove={move}
  onpointerup={release}
  onpointercancel={abort}
  onlostpointercapture={abort}
>
  <canvas bind:this={canvas} style:width="100%" style:height="100%" aria-hidden="true"></canvas>
  <textarea
    bind:this={input}
    aria-label="Edit text on canvas"
    dir={value.text?.direction ?? 'ltr'}
    data-canvas-text-input
    spellcheck="false"
    oninput={edited}
    onbeforeinput={() => {
      pendingInput = {
        value,
        revision,
        start: input.selectionStart,
        end: input.selectionEnd,
        direction: input.selectionDirection,
      };
    }}
    onselect={readSelection}
    onkeyup={readSelection}
    onkeydown={key}
    onfocus={() => (focus = true)}
    onblur={blurred}
    oncompositionstart={() => {
      composing = true;
      group = '';
    }}
    oncompositionend={() => {
      composing = false;
      group = '';
    }}></textarea>
  {#if message}<p role="alert">{message}</p>{/if}
</div>

<style>
  .text-editing {
    position: absolute;
    inset: 0;
    overflow: hidden;
    cursor: text;
    touch-action: none;
  }
  canvas {
    position: absolute;
    inset: 0;
    pointer-events: none;
  }
  textarea {
    position: absolute;
    left: 0;
    top: 0;
    width: 1px;
    height: 1px;
    opacity: 0;
    padding: 0;
    border: 0;
    resize: none;
    pointer-events: none;
  }
  p {
    position: absolute;
    bottom: 10px;
    left: 10px;
    max-width: 80%;
    padding: 8px;
    background: #482b30;
    color: #ffd5d5;
  }
</style>
