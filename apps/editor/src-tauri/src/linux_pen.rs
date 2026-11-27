use gtk::{gdk, gio, glib, prelude::*};
use std::cell::Cell;
use tauri::{Manager, Runtime};
use webkit2gtk::WebViewExt;

pub fn attach<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let Some(window) = app.get_webview_window("main") else {
        return Ok(());
    };
    window.with_webview(|platform| {
        let view = platform.inner();
        let pen_stream = Cell::new(false);
        #[cfg(feature = "native-smoke")]
        let smoke_eraser = std::env::var_os("SPLASH_NATIVE_SMOKE_PEN").is_some_and(|mode| mode == "eraser");
        #[cfg(feature = "native-smoke")]
        let smoke_stroke_finished = Cell::new(false);
        // The generic GTK event signal runs before WebKit's event-specific handler.
        // Keep WebKit in charge of dispatch, hit testing, and real pointer capture.
        view.connect_event(move |view, event| {
            let phase = match event.event_type() {
                gdk::EventType::ButtonPress if event.button() == Some(1) => "down",
                gdk::EventType::ButtonRelease if event.button() == Some(1) => "up",
                gdk::EventType::MotionNotify
                    if event.state().is_some_and(|state| {
                        state.contains(gdk::ModifierType::BUTTON1_MASK)
                    }) =>
                {
                    "move"
                }
                _ => return glib::Propagation::Proceed,
            };
            let source = event.source_device().map(|device| device.source());
            let eraser = source == Some(gdk::InputSource::Eraser);
            #[cfg(feature = "native-smoke")]
            let eraser = eraser || (smoke_eraser && smoke_stroke_finished.get());
            let (pen, pressure) =
                pen_pressure(event, phase, eraser || source == Some(gdk::InputSource::Pen));
            #[cfg(feature = "native-smoke")]
            let pressure = if smoke_eraser && eraser { None } else { pressure };
            #[cfg(feature = "native-smoke")]
            if smoke_eraser && phase == "up" {
                smoke_stroke_finished.set(true);
            }
            let data = if pen {
                let Some((x, y)) = event.coords() else {
                    return glib::Propagation::Proceed;
                };
                // A known pen move can have coordinates but no usable pressure axis.
                if !eraser && pressure.is_none() && (phase != "move" || !pen_stream.get()) {
                    return glib::Propagation::Proceed;
                }
                let zoom = view.zoom_level();
                pen_stream.set(true);
                if eraser {
                    serde_json::json!([phase, x / zoom, y / zoom, pressure, "eraser"])
                } else {
                    serde_json::json!([phase, x / zoom, y / zoom, pressure])
                }
            } else if pen_stream.replace(false) {
                serde_json::Value::Null
            } else {
                return glib::Propagation::Proceed;
            };
            let script = format!("window.__splashLinuxPen?.({data}); void 0");
            #[allow(deprecated)]
            view.run_javascript(&script, None::<&gio::Cancellable>, |_| {});
            glib::Propagation::Proceed
        });
    })
}

fn pen_pressure(event: &gdk::Event, phase: &str, pen: bool) -> (bool, Option<f64>) {
    #[cfg(feature = "native-smoke")]
    if let Some(mode) = std::env::var_os("SPLASH_NATIVE_SMOKE_PEN") {
        // Exercise actual GTK-to-WebKit ordering on the isolated Xvfb mouse.
        // The gap driver moves to x=495 with a distinct y so the point survives finishing.
        if mode == "gap"
            && phase == "move"
            && event.coords().is_some_and(|(x, _)| (x - 495.0).abs() < 1.0)
        {
            return (true, None);
        }
        return (true, Some(if phase == "down" { 0.2 } else { 0.8 }));
    }
    if !pen {
        return (false, None);
    }
    let pressure = if phase == "up" {
        Some(0.0)
    } else {
        event
            .axis(gdk::AxisUse::Pressure)
            .filter(|p| (0.0..=1.0).contains(p))
    };
    (pen, pressure)
}
