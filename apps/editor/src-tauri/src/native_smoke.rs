use std::{
    env, fs,
    sync::mpsc,
    time::{Duration, Instant},
};
use tauri::{Manager, Runtime};

const CHECK_EDITOR: &str = r#"
(() => {
    const packaged = location.hostname === 'tauri.localhost'
        || (location.protocol === 'tauri:' && location.hostname === 'localhost');
    if (!packaged) return false;
    const startup = document.querySelector('#startup-screen[data-ready]');
    startup?.shadowRoot?.querySelector('#startup-open')?.click();
    const app = document.getElementById('app');
    const canvas = app?.querySelector('canvas#drawing-stage');
    return !!canvas && !app.inert && canvas.width > 0 && canvas.height > 0
        && !!canvas.getContext('2d');
})()
"#;

const KEYBOARD_STEPS: &[(&str, &str)] = &[
    (
        "stage focused",
        r#"(() => {
        const stage = document.getElementById('drawing-stage');
        window.__splashSmokeRecovery = localStorage.getItem('splash-recovery-v1');
        stage.focus();
        return document.activeElement === stage;
    })()"#,
    ),
    (
        "help action focused",
        r#"document.activeElement?.parentElement?.id === 'application-menu-Help'
        && document.activeElement?.textContent.trim() === 'About'"#,
    ),
    (
        "about dialog focused",
        r#"!!document.activeElement?.closest('dialog[aria-labelledby="about-title"][open]')"#,
    ),
    (
        "help heading restored",
        r#"document.activeElement?.dataset.applicationMenu === 'Help'"#,
    ),
    (
        "stage restored",
        r#"document.activeElement?.id === 'drawing-stage'"#,
    ),
    (
        "timeline focused",
        r#"(() => {
        if (document.activeElement?.id !== 'drawing-stage') return false;
        if (!document.querySelector('[aria-label="Brush"][aria-pressed="true"]')) return false;
        const timeline = document.querySelector('canvas[aria-label="Timeline frames"]');
        timeline.focus();
        return document.activeElement === timeline;
    })()"#,
    ),
    (
        "keyboard verified",
        r#"document.activeElement?.getAttribute('aria-label') === 'Timeline frames'
        && document.getElementById('timeline-panel-position')?.textContent.trim() === 'Frame 2 of 48. Layer Layer 1.'
        && localStorage.getItem('splash-recovery-v1') === window.__splashSmokeRecovery"#,
    ),
];

const PEN_SETUP: &str = r#"
(() => {
    const brush = document.querySelector('[aria-label="Brush"]');
    if (brush?.getAttribute('aria-pressed') !== 'true') brush?.click();
    const separate = [...document.querySelectorAll('label')]
        .find(label => label.textContent.trim() === 'Separate brush objects')?.querySelector('input');
    if (separate && !separate.checked) separate.click();
    const simplify = document.querySelector('[aria-label="Brush simplify amount"]');
    if (window.__splashPenSmokeRequestGap && simplify && simplify.value !== '0') {
        simplify.value = '0';
        simplify.dispatchEvent(new Event('input', { bubbles: true }));
    }
    const stage = document.getElementById('drawing-stage');
    const r = stage.getBoundingClientRect();
    if (!window.__splashPenSmokeTrace) {
        const trace = window.__splashPenSmokeTrace = [];
        const receive = window.__splashLinuxPen;
        window.__splashLinuxPen = sample => { trace.push(['gtk', sample]); receive(sample); };
        let down;
        for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
            stage.addEventListener(type, event => {
                if (event.buttons || type === 'pointerup')
                    trace.push([type, event.clientX, event.clientY, event.pointerType, event.isTrusted]);
                if (type === 'pointerdown') down = event;
                if (!window.__splashPenSmokeRequestGap || type !== 'pointermove' || !event.buttons || !down ||
                    window.__splashPenSmokeGap || event.clientX - down.clientX < 8) return;
                // Model a missing interior packet and a browser-adjusted move summary.
                const init = {
                    clientY: event.clientY,
                    pointerType: 'mouse', pointerId: event.pointerId, buttons: event.buttons,
                };
                const gap = new PointerEvent('pointermove', { ...init, clientX: (down.clientX + event.clientX) / 2 });
                const last = new PointerEvent('pointermove', { ...init, clientX: event.clientX });
                Object.defineProperty(event, 'clientX', { value: event.clientX + 0.5 });
                Object.defineProperty(event, 'getCoalescedEvents', { value: () => [gap, last] });
                window.__splashPenSmokeGap = true;
            }, true);
        }
    }
    return !!separate?.checked && r.width > 400 && r.height > 300
        && r.left < 300 && r.top < 200 && r.right > 600 && r.bottom > 400;
})()
"#;

const PEN_DRAWN: &str = r#"
(() => {
    const strokes = JSON.parse(localStorage.getItem('splash-recovery-v1') || 'null')
        ?.project.layers.flatMap(layer => layer.keys[0].shapes).filter(shape => shape.kind === 'brush');
    if (strokes?.length !== 1) return false;
    const points = strokes[0].points;
    const pressureIsValid = points[0]?.pressure === 0.2 && points.at(-1).pressure === 0.8
        && points.every(({ pressure }) => pressure === 0.2 || pressure === 0.8);
    if (!window.__splashPenSmokeRequestGap) return pressureIsValid;
    const missingAxis = window.__splashPenSmokeTrace.some(([source, sample]) =>
        source === 'gtk' && sample?.[0] === 'move' && sample[3] === null);
    if (!pressureIsValid || !missingAxis || !window.__splashPenSmokeGap || points.length < 5) return false;
    const scale = (points[2].x - points[0].x) / 60;
    return points[1].pressure === 0.2
        && points[0].x < points[1].x && points[1].x < points[2].x
        && Math.abs(points[1].x - (points[0].x + points[2].x) / 2) < 0.001
        && points[2].pressure === 0.8
        && points.slice(3, -1).some(point => point.pressure === 0.8
            && Math.abs(point.x - (points[0].x + 135 * scale)) < 0.001
            && Math.abs(point.y - (points[0].y + 20 * scale)) < 0.001);
})()
"#;

const PEN_ERASER_STEPS: &[(&str, &str)] = &[
    ("eraser ready", r#"(() => {
        if (!window.__splashPenBeforeErase) {
            window.__splashPenBeforeErase = JSON.parse(localStorage.getItem('splash-recovery-v1')).project.layers;
        }
        const brush = document.querySelector('[aria-label="Brush"]');
        const eraser = document.querySelector('[aria-label="Eraser"]');
        if (!window.__splashPenCheckedObjectErase) {
            if (eraser?.getAttribute('aria-pressed') !== 'true') { eraser?.click(); return false; }
            const mode = document.querySelector('[aria-label="Eraser mode"]');
            if (mode?.value !== 'objects') {
                if (mode) {
                    mode.value = 'objects';
                    mode.dispatchEvent(new Event('change', { bubbles: true }));
                }
                return false;
            }
            window.__splashPenCheckedObjectErase = true;
        }
        if (brush?.getAttribute('aria-pressed') !== 'true') { brush?.click(); return false; }
        document.getElementById('drawing-stage')?.focus();
        return document.activeElement?.id === 'drawing-stage';
    })()"#),
    ("eraser verified", r#"(() => {
        const layers = JSON.parse(localStorage.getItem('splash-recovery-v1') || 'null')?.project.layers;
        const trace = window.__splashPenSmokeTrace;
        if (!layers?.every(layer => layer.keys[0].shapes.length === 0) ||
            !document.querySelector('[aria-label="Brush"][aria-pressed="true"]') ||
            document.querySelector('.notice.error') ||
            !['down', 'up'].every(phase => trace.some(([source, sample]) =>
                source === 'gtk' && sample?.[0] === phase && sample[3] === null && sample[4] === 'eraser')) ||
            !['pointerdown', 'pointerup'].every(type => trace.filter(event =>
                event[0] === type && event[4] === true).length === 2)) return false;
        window.__splashPenAfterErase = layers;
        return true;
    })()"#),
    ("eraser undo verified", r#"JSON.stringify(JSON.parse(localStorage.getItem('splash-recovery-v1') || 'null')?.project.layers)
        === JSON.stringify(window.__splashPenBeforeErase)"#),
    ("pen verified", r#"JSON.stringify(JSON.parse(localStorage.getItem('splash-recovery-v1') || 'null')?.project.layers)
        === JSON.stringify(window.__splashPenAfterErase)"#),
];

const OPEN_SCRIPT: &str = r#"
(() => {
    const control = document.querySelector('[data-application-menu="Control"]');
    control?.click();
    const open = [...document.querySelectorAll('button')]
        .find(button => button.textContent.trim() === 'Edit current frame source…');
    open?.click();
    return !!open;
})()
"#;

const SCRIPT_READY: &str = r#"
(() => {
    const input = document.querySelector('[aria-label="Frame source code editor"]');
    if (input && !window.__splashSmokeComposition) {
        const state = window.__splashSmokeComposition = { composing: false, update: '', end: '' };
        document.addEventListener('compositionstart', () => { state.composing = true; }, true);
        document.addEventListener('compositionupdate', event => { state.update = event.data; }, true);
        document.addEventListener('compositionend', event => {
            state.composing = false;
            state.end = event.data;
        }, true);
    }
    input?.focus();
    return !!input && document.activeElement === input;
})()
"#;

const SCRIPT_UNSAVED: &str = r#"
!JSON.parse(localStorage.getItem('splash-recovery-v1') || 'null')?.project.frameScripts
"#;

const DOCK_SCRIPT_IN_CANVAS: &str = r#"
(() => {
    const location = document.querySelector('select[aria-label="Script editor location"]');
    if (location?.value !== 'floating') return false;
    location.value = 'canvas';
    location.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
})()
"#;

const SCRIPT_SAVED: &str = r#"
(() => {
    const entries = JSON.parse(localStorage.getItem('splash-recovery-v1') || 'null')
        ?.project.frameScripts;
    return entries?.length === 1 && entries[0].frame === 0 &&
        entries[0].source === '// ' + 'é😀'.repeat(20000) + '\nconst unfinished =';
})()
"#;

const SCRIPT_SPEECH_SAVED: &str = r#"
(() => {
    const entries = JSON.parse(localStorage.getItem('splash-recovery-v1') || 'null')
        ?.project.frameScripts;
    return entries?.length === 1 && entries[0].frame === 0 && entries[0].source === 'const unfinished =';
})()
"#;

const SCRIPT_SAVE_MESSAGE: &str = r#"
    document.querySelector('[aria-label="Frame save status"]')?.textContent.trim() === 'Frame changes applied.'
"#;

const SCRIPT_SAVE_FOCUS: &str = r#"
    document.activeElement?.getAttribute('aria-label') === 'Frame source code editor'
"#;

const SCRIPT_SPEECH_EDITOR_POINT: &str = r#"
(() => {
    const rect = document.querySelector('.code-editor .monaco-editor')?.getBoundingClientRect();
    return rect?.width ? [Math.round(rect.left + 75), Math.round(rect.top + 25)] : null;
})()
"#;

const PROJECT_PICKER_READY: &str = r#"
(() => {
    const stage = document.getElementById('drawing-stage');
    stage.focus();
    return document.activeElement === stage;
})()
"#;

const PROJECT_OPENED: &str = r#"
(() => {
    const tab = document.querySelector('.document-tab[aria-current="page"]');
    if (tab?.getAttribute('aria-label') !== 'Switch to Portal test') return false;
    const canvas = document.getElementById('drawing-stage');
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    for (let i = 0; i < data.length; i += 4)
        if (data[i] === 255 && data[i + 1] === 0 && data[i + 2] === 0 && data[i + 3] === 255)
            return true;
    return false;
})()
"#;

const PROJECT_LICENSED: &str = r#"
    document.querySelector('button.publish:not(.register-prompt):enabled') !== null
"#;

const SAVE_AS_SUBMIT_FOCUSED: &str = r#"
    document.activeElement?.matches('dialog[open][aria-label="Save project"] button[type="submit"]:enabled')
    && document.querySelector('dialog[open][aria-label="Save project"] input').value === 'Keyboard copy'
"#;

const SAVE_AS_DRAFT_NUDGED: &str = r#"
    JSON.parse(localStorage.getItem('splash-recovery-v1') || 'null')?.project
        .layers[0].keys[0].shapes.find(shape => shape.id === 'art')?.x === 151
"#;

const SAVE_AS_STEPS: &[(&str, &str)] = &[
    ("save as draft ready", SAVE_AS_DRAFT_NUDGED),
    ("save as name focused", r#"
        document.activeElement?.matches('dialog[open][aria-label="Save project"] input:enabled')
        && document.activeElement.value === 'Portal test copy'
    "#),
    ("save as submit focused", SAVE_AS_SUBMIT_FOCUSED),
    ("save as retry focused", SAVE_AS_SUBMIT_FOCUSED),
    ("save as verified", r#"
        !document.querySelector('dialog[open][aria-label="Save project"]')
        && document.activeElement?.id === 'drawing-stage'
        && document.querySelector('.document-tab[aria-current="page"]')?.getAttribute('aria-label')
            === 'Switch to Keyboard copy'
        && document.querySelector('.status-message')?.textContent.startsWith('Saved Keyboard copy.spl')
    "#),
];

const EXPORT_COMMAND_FOCUSED: &str = r#"
    document.activeElement?.matches('#application-menu-File button:enabled')
    && document.activeElement.textContent.trim() === 'Export HTML animation…'
"#;

const EXPORT_FILE_FOCUSED: &str = r#"
    document.activeElement?.matches('button[data-application-menu="File"][aria-expanded="false"]')
"#;

const EXPORT_STEPS: &[(&str, &str, &str)] = &[
    ("export draft ready", SAVE_AS_DRAFT_NUDGED, ""),
    ("export command focused", EXPORT_COMMAND_FOCUSED, ""),
    ("export cancellation focused", EXPORT_FILE_FOCUSED, "export-cancelled"),
    ("export retry focused", EXPORT_COMMAND_FOCUSED, ""),
    ("project export verified", r#"
        document.activeElement?.matches('button[data-application-menu="File"][aria-expanded="false"]')
        && document.querySelector('.status-message')?.textContent.startsWith('Exported self-contained HTML')
    "#, "export-written"),
];

const PROJECT_BRUSH_OBJECTS: &str = r#"
(() => {
    const label = [...document.querySelectorAll('label')].find(label =>
        label.textContent.trim() === 'Separate brush objects');
    const input = label?.querySelector('input');
    if (!input) return false;
    if (!input.checked) input.click();
    return input.checked;
})()
"#;

const PROJECT_RECOVERY_FOCUSED: &str = r#"
    document.activeElement?.matches('[data-project-recovery] button:enabled')
    && document.activeElement?.textContent.trim() === 'Recover changes'
"#;

const PROJECT_RECOVERED: &str = r#"
(() => {
    const recovery = JSON.parse(localStorage.getItem('splash-recovery-v1') || 'null');
    return recovery?.project.name === 'Portal test'
        && recovery.project.layers[0].keys[0].shapes.filter(shape => shape.kind === 'brush').length === 2
        && document.activeElement?.id === 'drawing-stage'
        && !document.querySelector('[data-project-recovery]');
})()
"#;

const PROJECT_CLOSE_POINT: &str = r#"
(() => {
    if (!document.querySelector('.status-message')?.textContent.startsWith('Saved Portal test.spl')) return null;
    const element = document.querySelector('button[aria-label="Close Portal test"]:enabled');
    const rect = element?.getBoundingClientRect();
    return rect ? [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)] : null;
})()
"#;

const PROJECT_TAB_CLOSED: &str = r#"
    !document.querySelector('button[aria-label="Close Portal test"]')
"#;

const PROJECT_INNER_POINT: &str = r#"
(() => {
    const canvas = document.getElementById('drawing-stage');
    const rect = canvas.getBoundingClientRect();
    const { width, height } = canvas;
    const { data } = canvas.getContext('2d').getImageData(0, 0, width, height);
    for (let i = 0; i < data.length; i += 4) {
        if (data[i] === 230 && data[i + 1] === 49 && data[i + 2] === 34 && data[i + 3] === 255) {
            const x = i / 4 % width, y = Math.floor(i / 4 / width);
            return [Math.round(rect.left + (x + 8) * rect.width / width),
                    Math.round(rect.top + (y + 8) * rect.height / height)];
        }
    }
    return null;
})()
"#;

const PROJECT_INNER_TIMELINE_POINT: &str = r#"
(() => {
    if (document.querySelector('nav[aria-label="Symbol edit breadcrumbs"] strong')?.textContent !== 'Nested artwork')
        return null;
    const rect = document.querySelector('canvas[aria-label="Timeline frames"]')?.getBoundingClientRect();
    return rect ? [Math.round(rect.left + 8), Math.round(rect.top + 40)] : null;
})()
"#;

const PROJECT_TWEEN_MENU_POINT: &str = r#"
(() => {
    const action = [...document.querySelectorAll('[role="menuitem"]')].find(item =>
        item.textContent.trim() === 'Convert to motion tween' && !item.disabled);
    const rect = action?.getBoundingClientRect();
    return rect?.width ? [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)] : null;
})()
"#;

const PROJECT_RETURN_POINT: &str = r#"
(() => {
    if ([...document.querySelectorAll('[role="menuitem"]')].some(item =>
        item.textContent.trim() === 'Convert to motion tween')) return null;
    const rect = document.querySelector('nav[aria-label="Symbol edit breadcrumbs"] .scene-breadcrumb')?.getBoundingClientRect();
    return rect ? [Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2)] : null;
})()
"#;

const PROJECT_NESTED_TWEEN_SAVED: &str = r#"
    !document.querySelector('nav[aria-label="Symbol edit breadcrumbs"]')
        && JSON.parse(localStorage.getItem('splash-recovery-v1') || 'null')
            ?.project.symbols?.find(symbol => symbol.id === 'inner')?.timeline.motionSpans?.length === 1
"#;

const PROJECT_TRACE_INPUT: &str = r#"
(() => {
    window.__projectSmokeInput = [];
    for (const type of ['pointerdown', 'dblclick', 'contextmenu'])
        document.addEventListener(type, event => window.__projectSmokeInput.push(
            [type, event.detail, event.clientX, event.clientY, event.target.id]), true);
    return true;
})()
"#;

const PROJECT_BITMAP_RENDERED: &str = r#"
(() => {
    const canvas = document.getElementById('drawing-stage');
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let cyan = 0;
    for (let i = 0; i < data.length; i += 4)
        if (data[i] < 80 && data[i + 1] >= 170 && data[i + 2] > data[i + 1] + 15 && data[i + 3] === 255)
            cyan++;
    return cyan >= 16;
})()
"#;

fn wait_for_value<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    expression: &str,
    deadline: Instant,
    ready: impl Fn(&str) -> bool,
) -> Option<String> {
    while Instant::now() < deadline {
        let (sender, receiver) = mpsc::channel();
        if window
            .eval_with_callback(expression, move |result| {
                let _ = sender.send(result);
            })
            .is_ok()
        {
            if let Ok(result) = receiver.recv_timeout(Duration::from_millis(500)) {
                if ready(&result) {
                    return Some(result);
                }
            }
        }
        std::thread::sleep(Duration::from_millis(100));
    }
    None
}

fn wait_for<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    expression: &str,
    deadline: Instant,
) -> bool {
    wait_for_value(window, expression, deadline, |value| value == "true").is_some()
}

fn write_point<R: Runtime>(
    window: &tauri::WebviewWindow<R>,
    receipt: &std::path::Path,
    status: &str,
    expression: &str,
    deadline: Instant,
) -> bool {
    let Some(value) = wait_for_value(window, expression, deadline, |value| {
        serde_json::from_str::<[u32; 2]>(value).is_ok()
    }) else {
        eprintln!("Native project smoke did not reach {status}");
        if let Some(value) = wait_for_value(window, "window.__projectSmokeInput || []",
            Instant::now() + Duration::from_secs(1), |_| true) {
            eprintln!("Last native input: {value}");
        }
        return false;
    };
    let [x, y] = serde_json::from_str::<[u32; 2]>(&value).expect("validated coordinates");
    fs::write(receipt, format!("{status}\n{x}\n{y}\n")).is_ok()
}

pub fn attach<R: Runtime>(builder: tauri::Builder<R>) -> tauri::Builder<R> {
    builder.setup(|app| {
        #[cfg(target_os = "linux")]
        crate::setup_linux_editor(app)?;
        let Some(receipt) = env::var_os("SPLASH_NATIVE_SMOKE_RECEIPT") else {
            return Ok(());
        };
        let window = app
            .get_webview_window("main")
            .ok_or("Missing main WebView")?;
        let app = app.handle().clone();
        let keyboard = env::var_os("SPLASH_NATIVE_SMOKE_KEYBOARD").is_some();
        let pen_mode = env::var_os("SPLASH_NATIVE_SMOKE_PEN");
        let pen = cfg!(target_os = "linux") && pen_mode.is_some();
        let pen_gap = pen_mode.as_deref() == Some(std::ffi::OsStr::new("gap"));
        let pen_eraser = pen_mode.as_deref() == Some(std::ffi::OsStr::new("eraser"));
        let clipboard = cfg!(target_os = "linux") &&
            env::var_os("SPLASH_NATIVE_SMOKE_SCRIPT_CLIPBOARD").is_some();
        let ime = cfg!(target_os = "linux") && env::var_os("SPLASH_NATIVE_SMOKE_IME").is_some();
        let anthy_ime = ime && env::var_os("SPLASH_NATIVE_SMOKE_IME").as_deref()
            == Some(std::ffi::OsStr::new("anthy"));
        let docked_ime = anthy_ime && env::var_os("SPLASH_NATIVE_SMOKE_IME_DOCKED").is_some();
        let speech = cfg!(target_os = "linux") && env::var_os("SPLASH_NATIVE_SMOKE_SCRIPT_SPEECH").is_some();
        let save_announcement = speech && env::var_os("SPLASH_NATIVE_SMOKE_SCRIPT_SPEECH").as_deref()
            == Some(std::ffi::OsStr::new("save"));
        let project_picker = cfg!(target_os = "linux") &&
            env::var_os("SPLASH_NATIVE_SMOKE_PROJECT_PICKER").is_some();
        let project_save_as = project_picker && env::var_os("SPLASH_NATIVE_SMOKE_PROJECT_PICKER").as_deref()
            == Some(std::ffi::OsStr::new("save-as"));
        let project_export = project_picker && env::var_os("SPLASH_NATIVE_SMOKE_PROJECT_PICKER").as_deref()
            == Some(std::ffi::OsStr::new("export"));
        let project_recovery = env::var("SPLASH_NATIVE_SMOKE_PROJECT_RECOVERY").ok();
        std::thread::spawn(move || {
            let deadline = Instant::now() + Duration::from_secs(45);
            if !wait_for(&window, CHECK_EDITOR, deadline) {
                app.exit(1);
                return;
            }
            if project_picker {
                let passed = ((project_recovery.is_none() && !project_save_as && !project_export) || wait_for(&window, PROJECT_LICENSED, deadline))
                    && wait_for(&window, PROJECT_PICKER_READY, deadline)
                    && fs::write(&receipt, "project picker ready\n").is_ok()
                    && wait_for(&window, PROJECT_OPENED, deadline)
                    && fs::write(&receipt, "project picker verified\n").is_ok();
                if !passed {
                    app.exit(1);
                    return;
                }
                if project_save_as {
                    for (status, expression) in SAVE_AS_STEPS {
                        if *status == "save as retry focused" {
                            // The native chooser owns the UI thread until it closes.
                            let cancellation = std::path::Path::new(&receipt).with_extension("save-as-cancelled");
                            while Instant::now() < deadline && !cancellation.is_file() {
                                std::thread::sleep(Duration::from_millis(100));
                            }
                        }
                        if !wait_for(&window, expression, deadline)
                            || (*status == "save as retry focused" && !wait_for(&window, SAVE_AS_DRAFT_NUDGED, deadline))
                            || fs::write(&receipt, format!("{status}\n")).is_err()
                        {
                            eprintln!("Native Save As did not reach {status}");
                            app.exit(1);
                            return;
                        }
                    }
                }
                if project_export {
                    for (status, expression, marker) in EXPORT_STEPS {
                        if !marker.is_empty() {
                            let completion = std::path::Path::new(&receipt).with_extension(marker);
                            while Instant::now() < deadline && !completion.is_file() {
                                std::thread::sleep(Duration::from_millis(100));
                            }
                        }
                        if !wait_for(&window, expression, deadline)
                            || !wait_for(&window, SAVE_AS_DRAFT_NUDGED, deadline)
                            || fs::write(&receipt, format!("{status}\n")).is_err()
                        {
                            eprintln!("Native HTML export did not reach {status}");
                            app.exit(1);
                            return;
                        }
                    }
                }
                if project_recovery.as_deref() == Some("reopen") {
                    let path = std::path::Path::new(&receipt);
                    if !wait_for(&window, PROJECT_BITMAP_RENDERED, deadline)
                        || !wait_for(&window, PROJECT_RECOVERY_FOCUSED, deadline)
                        || fs::write(path, "project recovery focused\n").is_err()
                        || !wait_for(&window, PROJECT_RECOVERED, deadline)
                        || !wait_for(&window, PROJECT_BITMAP_RENDERED, deadline)
                        || fs::write(path, "project recovered\n").is_err()
                        || !write_point(&window, path, "project close point", PROJECT_CLOSE_POINT, deadline)
                        || !wait_for(&window, PROJECT_TAB_CLOSED, deadline)
                        || fs::write(path, "project tab closed\n").is_err()
                        || !wait_for(&window, PROJECT_OPENED, deadline)
                        || !wait_for(&window, PROJECT_BITMAP_RENDERED, deadline)
                        || fs::write(path, "project reopened after close\n").is_err() {
                        app.exit(1);
                    }
                    return;
                }
                if project_recovery.is_some() {
                    let outer_open = format!(r#"
                        document.querySelector('nav[aria-label="Symbol edit breadcrumbs"] strong')?.textContent === 'Outer artwork'
                            ? ({PROJECT_INNER_POINT})?.map(coordinate => coordinate + 8) ?? null : null
                    "#);
                    let path = std::path::Path::new(&receipt);
                    let authored = wait_for(&window, PROJECT_BITMAP_RENDERED, deadline)
                        && wait_for(&window, PROJECT_TRACE_INPUT, deadline)
                        && [("outer artwork point", PROJECT_INNER_POINT),
                            ("inner artwork point", outer_open.as_str()),
                            ("inner first key point", PROJECT_INNER_TIMELINE_POINT),
                            ("inner motion tween action", PROJECT_TWEEN_MENU_POINT),
                            ("return to scene point", PROJECT_RETURN_POINT)]
                            .into_iter().all(|(status, expression)| write_point(&window, path, status, expression, deadline))
                        && wait_for(&window, PROJECT_NESTED_TWEEN_SAVED, deadline)
                        && fs::write(path, "nested tween authored\n").is_ok();
                    if !authored || !wait_for(&window, PROJECT_BRUSH_OBJECTS, deadline)
                        || fs::write(&receipt, "project brush ready\n").is_err() {
                        app.exit(1);
                    }
                    return;
                }
            } else if clipboard || ime || speech {
                let passed = wait_for(&window, OPEN_SCRIPT, deadline) && loop {
                    if Instant::now() >= deadline { break false; }
                    if let Some((_, panel)) = app.webview_windows().into_iter()
                        .find(|(label, _)| label.starts_with("script-panel-")) {
                        if !wait_for(&panel, SCRIPT_READY, deadline) { break false; }
                        if speech {
                            let path = std::path::Path::new(&receipt);
                            let output = path.with_extension("speech");
                            if !write_point(&panel, path, "script speech ready", SCRIPT_SPEECH_EDITOR_POINT, deadline)
                                || !wait_for(&window, SCRIPT_SPEECH_SAVED, deadline)
                                || !wait_for(&panel, SCRIPT_SAVE_MESSAGE, deadline)
                                || (save_announcement && !wait_for(&panel, SCRIPT_SAVE_FOCUS, deadline))
                                || fs::write(&receipt, "script source saved\n").is_err() {
                                if let Some(trace) = wait_for_value(&panel,
                                    "document.querySelector('[aria-label=\\\"Frame save status\\\"]')?.outerHTML ?? null",
                                    Instant::now() + Duration::from_secs(1), |_| true) {
                                    eprintln!("Native frame save feedback: {trace}");
                                }
                                break false;
                            }
                            while Instant::now() < deadline && !output.is_file() {
                                std::thread::sleep(Duration::from_millis(100));
                            }
                            break output.is_file() && fs::write(&receipt, "script speech verified\n").is_ok();
                        }
                        if ime {
                            let editor = if docked_ime {
                                if !wait_for(&panel, DOCK_SCRIPT_IN_CANVAS, deadline)
                                    || !wait_for(&window, r#"document.querySelector('#canvas-script-tab[aria-selected="true"]') !== null"#, deadline)
                                    || !wait_for(&window, SCRIPT_READY, deadline) {
                                    eprintln!("Native Script Editor did not reach the canvas dock");
                                    break false;
                                }
                                &window
                            } else {
                                &panel
                            };
                            let (preedit, source) = if anthy_ime { ("日本", "日本") } else { ("304b", "か") };
                            let preedit = format!(r#"
                                window.__splashSmokeComposition?.composing &&
                                window.__splashSmokeComposition.update.includes({preedit:?}) &&
                                !!document.querySelector('[aria-label="Frame save status"]')
                            "#);
                            let committed = format!(r#"
                                window.__splashSmokeComposition?.composing === false &&
                                window.__splashSmokeComposition.end === {source:?}
                            "#);
                            let saved = format!(r#"
                                (() => {{
                                    const entries = JSON.parse(localStorage.getItem('splash-recovery-v1') || 'null')
                                        ?.project.frameScripts;
                                    return entries?.length === 1 && entries[0].frame === 0 && entries[0].source === {source:?};
                                }})()
                            "#);
                            let passed = fs::write(&receipt, "script ime ready\n").is_ok()
                                && wait_for(editor, &preedit, deadline)
                                && wait_for(&window, SCRIPT_UNSAVED, deadline)
                                && fs::write(&receipt, "script ime preedit\n").is_ok()
                                && wait_for(editor, &committed, deadline)
                                && fs::write(&receipt, "script ime committed\n").is_ok()
                                && wait_for(&window, &saved, deadline)
                                && fs::write(&receipt, "script ime verified\n").is_ok();
                            if !passed {
                                if let Some(state) = wait_for_value(editor,
                                    "JSON.stringify(window.__splashSmokeComposition ?? null)",
                                    Instant::now() + Duration::from_secs(1), |_| true) {
                                    eprintln!("Native script IME state: {state}");
                                }
                            }
                            break passed;
                        }
                        break fs::write(&receipt, "script clipboard ready\n").is_ok()
                            && wait_for(&window, SCRIPT_SAVED, deadline)
                            && fs::write(&receipt, "script clipboard verified\n").is_ok();
                    }
                    std::thread::sleep(Duration::from_millis(100));
                };
                if !passed {
                    if ime {
                        if let Some((_, panel)) = app.webview_windows().into_iter()
                            .find(|(label, _)| label.starts_with("script-panel-")) {
                            let (sender, receiver) = mpsc::channel();
                            let _ = panel.eval_with_callback(
                                "JSON.stringify({state: window.__splashSmokeComposition, source: document.querySelector('.view-lines')?.textContent})",
                                move |value| { let _ = sender.send(value); });
                            if let Ok(trace) = receiver.recv_timeout(Duration::from_secs(1)) {
                                eprintln!("Native script IME trace: {trace}");
                            }
                        }
                    }
                    let (sender, receiver) = mpsc::channel();
                    let _ = window.eval_with_callback(
                        "document.body.textContent.includes('Script windows belong to the local editor')",
                        move |value| { let _ = sender.send(value); });
                    if receiver.recv_timeout(Duration::from_secs(1)).as_deref() == Ok("true") {
                        eprintln!("The packaged editor rejected its own Script Editor window origin.");
                    }
                    app.exit(1);
                    return;
                }
            } else if pen {
                let setup = format!("window.__splashPenSmokeRequestGap = {pen_gap}; {PEN_SETUP}");
                let mut steps = vec![("pen ready", setup.as_str())];
                if pen_eraser {
                    steps.push(("pen drawn", PEN_DRAWN));
                    steps.extend_from_slice(PEN_ERASER_STEPS);
                } else {
                    steps.push(("pen verified", PEN_DRAWN));
                }
                for (status, expression) in steps {
                    if !wait_for(&window, expression, deadline)
                        || fs::write(&receipt, format!("{status}\n")).is_err()
                    {
                        let (sender, receiver) = mpsc::channel();
                        let _ = window.eval_with_callback(r#"
                            JSON.stringify({
                                trace: window.__splashPenSmokeTrace,
                                notice: document.querySelector('.notice.error')?.textContent.trim(),
                                status: document.querySelector('.status-message')?.textContent.trim(),
                                shapes: JSON.parse(localStorage.getItem('splash-recovery-v1') || 'null')
                                    ?.project.layers.flatMap(l => l.keys[0].shapes)
                                    .map(s => [s.kind, s.points.map(p => p.pressure)])
                            })
                        "#, move |result| { let _ = sender.send(result); });
                        if let Ok(trace) = receiver.recv_timeout(Duration::from_secs(1)) {
                            eprintln!("Linux pen smoke stopped at {status}: {trace}");
                        }
                        app.exit(1);
                        return;
                    }
                }
            } else if keyboard {
                for (status, expression) in KEYBOARD_STEPS {
                    if !wait_for(&window, expression, deadline)
                        || fs::write(&receipt, format!("{status}\n")).is_err()
                    {
                        app.exit(1);
                        return;
                    }
                }
            } else if fs::write(&receipt, "editor ready\n").is_err() {
                app.exit(1);
                return;
            }
            app.exit(0);
        });
        Ok(())
    })
}
