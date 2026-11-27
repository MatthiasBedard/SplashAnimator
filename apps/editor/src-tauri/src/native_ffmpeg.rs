use crate::{err, no_links, Result};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    fs::{self, File, OpenOptions},
    io::{self, BufReader, Read, Seek, SeekFrom, Write},
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::State;
use tempfile::{NamedTempFile, TempDir};
use uuid::Uuid;

mod avi;

const LIMIT: u64 = 512 * 1024 * 1024;
const WAV_LIMIT: u64 = 64 * 1024 * 1024;
const AUDIO_RATE: u32 = 48_000;
const AUDIO_FILE: &str = "audio.wav";
const OUTPUT: &str = "result.mkv";
const MPEG_PACK_BYTES: usize = 2048;
const WHITE_MATTE_FILTER: &str = concat!(
    "format=rgba,split[art][matte];",
    "[matte]lutrgb=r=maxval:g=maxval:b=maxval:a=maxval[white];",
    "[white][art]overlay=format=yuv420:shortest=1",
);
const MANIFEST_LIMIT: u64 = 256 * 1024;
const TIME_LIMIT: Duration = Duration::from_secs(60);
const PROBE_TIME_LIMIT: Duration = Duration::from_secs(5);
const ENCODER_LIST_LIMIT: u64 = 256 * 1024;

#[derive(Clone, Copy, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OutputFormat {
    #[default]
    Matroska,
    QuickTime,
    Avi,
    Mpeg,
    Hevc,
}

impl OutputFormat {
    fn destination(self) -> (&'static str, &'static str, &'static str, &'static str) {
        match self {
            Self::Matroska => (
                "Save lossless Matroska video",
                "Splash video.mkv",
                "Matroska video",
                "mkv",
            ),
            Self::QuickTime => (
                "Save QuickTime MOV video",
                "Splash video.mov",
                "QuickTime MOV video",
                "mov",
            ),
            Self::Avi => ("Save lossless AVI video", "Splash video.avi", "AVI video", "avi"),
            Self::Mpeg => ("Save MPEG-2 video", "Splash video.mpg", "MPEG-2 video", "mpg"),
            Self::Hevc => (
                "Save HEVC MP4 video",
                "Splash video.mp4",
                "HEVC MP4 video",
                "mp4",
            ),
        }
    }

    fn validate_video(self, video: &Video) -> Result<()> {
        if matches!(self, Self::Hevc)
            && (video.width < 16
                || video.height < 16
                || video.width % 2 != 0
                || video.height % 2 != 0)
        {
            return Err("HEVC MP4 needs even dimensions of at least 16 × 16 pixels. Change the export scale or choose another format.".into());
        }
        if !matches!(self, Self::Mpeg) {
            return Ok(());
        }
        if video.width % 2 != 0
            || video.height % 2 != 0
            || video.width > 16_382
            || video.height > 16_382
        {
            return Err("MPEG-2 requires even output dimensions below 16,384 pixels per side. Change the export scale or choose another format.".into());
        }
        let FrameRate { numerator, denominator } = video.frame_rate;
        let standard_rates = [
            (24_000, 1001), (24, 1), (25, 1), (30_000, 1001),
            (30, 1), (50, 1), (60_000, 1001), (60, 1),
        ];
        if !standard_rates.into_iter().any(|(n, d)| {
            u64::from(numerator) * d == u64::from(denominator) * n
        }) {
            return Err("MPEG-2 needs 24, 25, 30, 50 or 60 fps, or an exact NTSC rate. Choose a supported frame rate or another format.".into());
        }
        Ok(())
    }
}

#[derive(Default)]
pub struct FFmpeg(Mutex<Slot>);

#[derive(Default)]
struct Slot {
    picking: Option<Arc<AtomicBool>>,
    closing: bool,
    waiting: Option<Job>,
    running: Option<(Uuid, Arc<AtomicBool>)>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Manifest {
    version: u32,
    kind: String,
    video: Video,
    audio: Option<Audio>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Audio {
    file: String,
    format: String,
    sample_rate: u32,
    start: u64,
    end: u64,
    frames: u64,
    channels: u16,
}

impl Audio {
    fn data_bytes(&self) -> u64 {
        self.frames * u64::from(self.channels) * 2
    }

    fn validate(&self, video: &Video) -> Result<()> {
        // These are the browser mixer's absolute integer-frame boundaries.
        let fps = f64::from(video.frame_rate.numerator) / f64::from(video.frame_rate.denominator);
        let start_frame = video.first_number - 1;
        let boundary = |frame| (f64::from(frame) * f64::from(AUDIO_RATE) / fps).round();
        let start = boundary(start_frame);
        let end = boundary(start_frame + video.frame_count);
        if self.file != AUDIO_FILE
            || !matches!(self.format.as_str(), "pcm_s16le" | "pcm-s16le")
            || self.sample_rate != AUDIO_RATE
            || !matches!(self.channels, 1 | 2)
            || end > ((1u64 << 53) - 1) as f64
            || (self.start, self.end) != (start as u64, end as u64)
            || self.end.checked_sub(self.start) != Some(self.frames)
            || self.frames == 0
            || self.frames > (WAV_LIMIT - 44) / (u64::from(self.channels) * 2)
        {
            return Err("Invalid mixed WAV metadata or sample range.".into());
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Video {
    pattern: String,
    first_number: u32,
    frame_count: u32,
    width: u32,
    height: u32,
    frame_rate: FrameRate,
    buttons: String,
}

#[derive(Deserialize)]
struct FrameRate {
    numerator: u32,
    denominator: u32,
}

struct Job {
    id: Uuid,
    input: PathBuf,
    program: PathBuf,
    fingerprint: [u8; 32],
    destination: PathBuf,
    format: OutputFormat,
    video: Video,
    audio: Option<Audio>,
    capture: Option<Capture>,
    stage: Option<TempDir>,
    cancel: Arc<AtomicBool>,
}

struct Capture {
    directory: TempDir,
    frames: u32,
    bytes: u64,
    audio_ready: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Selection {
    id: Uuid,
    frame_count: u32,
    width: u32,
    height: u32,
    audio_channels: Option<u16>,
    format: OutputFormat,
}

fn main_only(window: &tauri::WebviewWindow) -> Result<()> {
    if window.label() == "main" {
        Ok(())
    } else {
        Err("FFmpeg export is available in the main editor.".into())
    }
}

fn fingerprint(path: &Path) -> Result<[u8; 32]> {
    no_links(path)?;
    let file = File::open(path).map_err(err)?;
    let metadata = file.metadata().map_err(err)?;
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > LIMIT {
        return Err("Invalid FFmpeg executable size.".into());
    }
    let mut hash = Sha256::new();
    let mut input = file.take(LIMIT + 1);
    let (mut count, mut buffer) = (0, [0; 64 * 1024]);
    loop {
        let size = input.read(&mut buffer).map_err(err)?;
        if size == 0 {
            break;
        }
        count += size as u64;
        hash.update(&buffer[..size]);
    }
    if count != metadata.len() {
        return Err("FFmpeg executable changed during selection.".into());
    }
    Ok(hash.finalize().into())
}

fn read_manifest(path: &Path) -> Result<Manifest> {
    no_links(path)?;
    let mut bytes = Vec::new();
    File::open(path)
        .map_err(err)?
        .take(MANIFEST_LIMIT + 1)
        .read_to_end(&mut bytes)
        .map_err(err)?;
    if bytes.len() as u64 > MANIFEST_LIMIT {
        return Err("FFmpeg manifest is too large.".into());
    }
    let m: Manifest = serde_json::from_slice(&bytes).map_err(err)?;
    if m.version != 1 || m.kind != "splash-ffmpeg-inputs" {
        return Err("Invalid Splash FFmpeg input manifest.".into());
    }
    validate_video(&m.video)?;
    if let Some(audio) = &m.audio {
        audio.validate(&m.video)?;
    }
    Ok(m)
}

fn validate_video(v: &Video) -> Result<()> {
    if v.pattern != "frame-%06d.png"
        || v.buttons != "Up"
        || v.frame_count == 0
        || v.frame_count > 65532
        || v.first_number == 0
        || u64::from(v.first_number) + u64::from(v.frame_count) - 1 > i32::MAX as u64
        || v.width == 0
        || v.height == 0
        || v.width > 16384
        || v.height > 16384
        || u64::from(v.width) * u64::from(v.height) > 64 * 1024 * 1024
        || v.frame_rate.numerator == 0
        || v.frame_rate.denominator == 0
        || v.frame_rate.numerator > i32::MAX as u32
        || v.frame_rate.denominator > i32::MAX as u32
    {
        return Err("Invalid Splash FFmpeg input manifest.".into());
    }
    Ok(())
}

fn choose_job(
    window: &tauri::WebviewWindow,
    request: Option<(Video, Option<Audio>)>,
    format: OutputFormat,
    cancel: Arc<AtomicBool>,
) -> Result<Option<Job>> {
    let (input, video, audio, capture) = if let Some((video, audio)) = request {
        validate_video(&video)?;
        format.validate_video(&video)?;
        if let Some(audio) = &audio {
            audio.validate(&video)?;
        }
        let directory = new_stage()?;
        let input = directory.path().to_owned();
        (
            input,
            video,
            audio,
            Some(Capture {
                directory,
                frames: 0,
                bytes: 0,
                audio_ready: false,
            }),
        )
    } else {
        let Some(manifest) = rfd::FileDialog::new()
            .set_parent(window)
            .set_title("Choose the extracted ffmpeg.json")
            .add_filter("Splash FFmpeg manifest", &["json"])
            .pick_file()
        else {
            return Ok(None);
        };
        let inputs = read_manifest(&manifest)?;
        format.validate_video(&inputs.video)?;
        (
            manifest.parent().ok_or("Missing input folder.")?.to_owned(),
            inputs.video,
            inputs.audio,
            None,
        )
    };
    let Some(program) = rfd::FileDialog::new()
        .set_parent(window)
        .set_title("Choose your FFmpeg executable")
        .pick_file()
    else {
        return Ok(None);
    };
    #[cfg(windows)]
    if !program
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case("exe"))
    {
        return Err("Select an FFmpeg .exe file.".into());
    }
    no_links(&program)?;
    let program = fs::canonicalize(program).map_err(err)?;
    let fingerprint = fingerprint(&program)?;
    if matches!(format, OutputFormat::Hevc) {
        probe_hevc(&program, &cancel)?;
    }
    active(&cancel, Instant::now() + PROBE_TIME_LIMIT)?;
    let (title, name, label, extension) = format.destination();
    let Some(destination) = rfd::FileDialog::new()
        .set_parent(window)
        .set_title(title)
        .set_file_name(name)
        .add_filter(label, &[extension])
        .save_file()
    else {
        return Ok(None);
    };
    if !destination
        .extension()
        .and_then(|s| s.to_str())
        .is_some_and(|s| s.eq_ignore_ascii_case(extension))
    {
        return Err(format!(
            "Choose a destination with a .{extension} extension."
        ));
    }
    no_links(&destination)?;
    if destination.exists() {
        return Err("Choose a new file name. Existing files are preserved.".into());
    }
    Ok(Some(Job {
        id: Uuid::new_v4(),
        input,
        program,
        fingerprint,
        destination,
        format,
        video,
        audio,
        capture,
        stage: None,
        cancel,
    }))
}

fn lists_hevc_encoder(bytes: &[u8]) -> bool {
    String::from_utf8_lossy(bytes).lines().any(|line| {
        let mut columns = line.split_ascii_whitespace();
        columns
            .next()
            .is_some_and(|flags| flags.len() == 6 && flags.starts_with('V'))
            && columns.next() == Some("libx265")
    })
}

fn probe_hevc(program: &Path, cancel: &AtomicBool) -> Result<()> {
    let deadline = Instant::now() + PROBE_TIME_LIMIT;
    active(cancel, deadline)?;
    let mut command = Command::new(program);
    command
        .current_dir(program.parent().ok_or("Missing FFmpeg program folder.")?)
        .args(["-hide_banner", "-encoders"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    let mut child = command.spawn().map_err(err)?;
    let stdout = child
        .stdout
        .take()
        .expect("Encoder capability probe pipes stdout");
    let reader = thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout.take(ENCODER_LIST_LIMIT + 1).read_to_end(&mut bytes)?;
        Ok::<_, io::Error>(bytes)
    });
    let result = loop {
        if let Err(error) = active(cancel, deadline) {
            break Err(error);
        }
        match child.try_wait() {
            Ok(Some(status)) if !status.success() => break Ok(false),
            Ok(Some(_)) if reader.is_finished() => {
                let bytes = reader
                    .join()
                    .map_err(|_| "FFmpeg encoder probe stopped.")?
                    .map_err(err)?;
                if bytes.len() as u64 > ENCODER_LIST_LIMIT {
                    return Err("FFmpeg encoder list exceeded its byte budget.".into());
                }
                break Ok(lists_hevc_encoder(&bytes));
            }
            Ok(_) => thread::sleep(Duration::from_millis(25)),
            Err(error) => break Err(err(error)),
        }
    };
    if result.is_err() {
        let _ = child.kill();
        child.wait().map_err(err)?;
    }
    if result? {
        Ok(())
    } else {
        Err("The selected FFmpeg does not provide the libx265 encoder for HEVC MP4. Choose a compatible FFmpeg build or another format.".into())
    }
}

fn new_stage() -> Result<TempDir> {
    tempfile::Builder::new()
        .prefix("splash-ffmpeg-")
        .tempdir()
        .map_err(err)
}

fn png_header(bytes: &[u8], video: &Video) -> bool {
    &bytes[..16] == b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR"
        && bytes[16..20] == video.width.to_be_bytes()
        && bytes[20..24] == video.height.to_be_bytes()
}

fn push_capture(job: &mut Job, frame: u32, bytes: &[u8]) -> Result<()> {
    let capture = job
        .capture
        .as_mut()
        .ok_or("This FFmpeg job does not accept captured frames.")?;
    let size = bytes.len() as u64;
    let reserved = job.audio.as_ref().map_or(0, |audio| 44 + audio.data_bytes());
    if capture.frames >= job.video.frame_count
        || (job.audio.is_some() && !capture.audio_ready)
        || frame != job.video.first_number + capture.frames
        || size < 45
        || size > LIMIT - reserved - capture.bytes
        || !png_header(bytes, &job.video)
        || !bytes.ends_with(b"\0\0\0\0IEND\xaeB\x60\x82")
    {
        return Err("Invalid, out-of-order or over-budget desktop PNG frame.".into());
    }
    let path = capture
        .directory
        .path()
        .join(format!("frame-{frame:06}.png"));
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)
        .map_err(err)?
        .write_all(bytes)
        .map_err(err)?;
    capture.frames += 1;
    capture.bytes += size;
    Ok(())
}

fn push_capture_audio(job: &mut Job, bytes: &[u8]) -> Result<()> {
    let audio = job.audio.as_ref().ok_or("This capture is silent.")?;
    let capture = job.capture.as_mut().ok_or("This job uses extracted audio.")?;
    if capture.audio_ready || capture.frames != 0 || bytes.len() as u64 != 44 + audio.data_bytes() {
        return Err("Invalid, duplicate or out-of-order desktop WAV input.".into());
    }
    validate_mix_header(&bytes[..44], audio)?;
    OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(capture.directory.path().join(AUDIO_FILE))
        .map_err(err)?
        .write_all(bytes)
        .map_err(err)?;
    capture.audio_ready = true;
    Ok(())
}

fn active(cancel: &AtomicBool, deadline: Instant) -> Result<()> {
    if cancel.load(Ordering::Relaxed) {
        return Err("FFmpeg export cancelled.".into());
    }
    if Instant::now() >= deadline {
        return Err("FFmpeg export timed out.".into());
    }
    Ok(())
}

fn stage_frames(job: &Job, directory: &Path, deadline: Instant) -> Result<()> {
    let mut total = 0;
    let audio_bytes = job
        .audio
        .as_ref()
        .map_or(0, |audio| 44 + audio.data_bytes());
    let mut buffer = [0; 64 * 1024];
    for index in 0..job.video.frame_count {
        active(&job.cancel, deadline)?;
        let name = format!("frame-{:06}.png", job.video.first_number + index);
        let path = job.input.join(&name);
        no_links(&path)?;
        let mut png = File::open(path).map_err(err)?;
        let meta = png.metadata().map_err(err)?;
        if !meta.is_file() || meta.len() < 45 || meta.len() > LIMIT - audio_bytes - total {
            return Err("FFmpeg PNG input exceeds its size budget or is incomplete.".into());
        }
        let mut head = [0u8; 24];
        png.read_exact(&mut head).map_err(err)?;
        if !png_header(&head, &job.video) {
            return Err(format!("{name} has unexpected dimensions or is not a PNG."));
        }
        let mut end = [0u8; 12];
        png.seek(SeekFrom::End(-12)).map_err(err)?;
        png.read_exact(&mut end).map_err(err)?;
        if &end != b"\0\0\0\0IEND\xaeB\x60\x82" {
            return Err(format!("{name} is incomplete."));
        }
        png.seek(SeekFrom::Start(head.len() as u64)).map_err(err)?;
        let mut staged = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(directory.join(name))
            .map_err(err)?;
        staged.write_all(&head).map_err(err)?;
        copy_input(
            &mut png,
            &mut staged,
            meta.len() - head.len() as u64,
            &mut buffer,
            job,
            deadline,
        )?;
        total += meta.len();
    }
    if let Some(audio) = &job.audio {
        stage_audio(job, audio, directory, deadline, &mut buffer)?;
    }
    Ok(())
}

fn copy_input(
    source: &mut File,
    staged: &mut File,
    mut remaining: u64,
    buffer: &mut [u8],
    job: &Job,
    deadline: Instant,
) -> Result<()> {
    while remaining > 0 {
        active(&job.cancel, deadline)?;
        let count = remaining.min(buffer.len() as u64) as usize;
        source.read_exact(&mut buffer[..count]).map_err(err)?;
        staged.write_all(&buffer[..count]).map_err(err)?;
        remaining -= count as u64;
    }
    if source.read(&mut buffer[..1]).map_err(err)? != 0 {
        return Err("FFmpeg input changed while staging.".into());
    }
    Ok(())
}

fn stage_audio(
    job: &Job,
    audio: &Audio,
    directory: &Path,
    deadline: Instant,
    buffer: &mut [u8],
) -> Result<()> {
    active(&job.cancel, deadline)?;
    let path = job.input.join(AUDIO_FILE);
    no_links(&path)?;
    let mut wav = File::open(path).map_err(err)?;
    let meta = wav.metadata().map_err(err)?;
    let bytes = audio.data_bytes();
    if !meta.is_file() || meta.len() != 44 + bytes {
        return Err("Mixed WAV length does not match the declared sample range.".into());
    }
    let mut header = [0; 44];
    wav.read_exact(&mut header).map_err(err)?;
    validate_mix_header(&header, audio)?;
    let mut staged = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(directory.join(AUDIO_FILE))
        .map_err(err)?;
    staged.write_all(&header).map_err(err)?;
    copy_input(&mut wav, &mut staged, bytes, buffer, job, deadline)
}

fn validate_mix_header(header: &[u8], audio: &Audio) -> Result<()> {
    let pair = |at| u16::from_le_bytes(header[at..at + 2].try_into().unwrap());
    let word = |at| u32::from_le_bytes(header[at..at + 4].try_into().unwrap());
    let stride = audio.channels * 2;
    let bytes = audio.data_bytes();
    if &header[..4] != b"RIFF"
        || &header[8..16] != b"WAVEfmt "
        || &header[36..40] != b"data"
        || u64::from(word(4)) != 36 + bytes
        || word(16) != 16
        || pair(20) != 1
        || pair(22) != audio.channels
        || word(24) != AUDIO_RATE
        || word(28) != AUDIO_RATE * u32::from(stride)
        || pair(32) != stride
        || pair(34) != 16
        || u64::from(word(40)) != bytes
    {
        return Err("Expected the canonical Splash 48 kHz PCM16 WAV header.".into());
    }
    Ok(())
}

fn encoder_command(job: &Job, directory: &Path) -> Command {
    let video = &job.video;
    let mut command = Command::new(&job.program);
    command
        .current_dir(directory)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .args([
            "-hide_banner",
            "-nostdin",
            "-nostats",
            "-loglevel",
            "error",
            "-xerror",
            "-n",
            "-protocol_whitelist",
            "file,pipe",
            "-framerate",
        ])
        .arg(format!(
            "{}/{}",
            video.frame_rate.numerator, video.frame_rate.denominator
        ))
        .args(["-pattern_type", "sequence", "-start_number"])
        .arg(video.first_number.to_string())
        .args(["-start_number_range", "1", "-i", "frame-%06d.png"]);
    if job.audio.is_some() {
        command.args(["-protocol_whitelist", "file,pipe", "-i", AUDIO_FILE]);
    }
    command.args(["-map", "0:v:0"]);
    if job.audio.is_some() {
        // Both exact-length staged inputs run to EOF, including a final audio packet.
        let codec = if matches!(job.format, OutputFormat::Mpeg) {
            "pcm_dvd"
        } else {
            "pcm_s16le"
        };
        command.args(["-map", "1:a:0", "-c:a", codec]);
    } else {
        command.arg("-frames:v").arg(video.frame_count.to_string());
    }
    match job.format {
        OutputFormat::Matroska => command.args([
            "-c:v", "ffv1", "-pix_fmt", "bgra", "-f", "matroska", "pipe:1",
        ]),
        OutputFormat::QuickTime => command.args([
            "-c:v",
            "qtrle",
            "-pix_fmt",
            "argb",
            "-movflags",
            "+frag_keyframe+empty_moov",
            "-f",
            "mov",
            "pipe:1",
        ]),
        OutputFormat::Avi => command.args([
            "-c:v", "ffv1", "-pix_fmt", "bgra", "-g", "1", "-f", "avi", "pipe:1",
        ]),
        OutputFormat::Mpeg => command.args([
            "-vf", WHITE_MATTE_FILTER,
            "-c:v", "mpeg2video", "-pix_fmt", "yuv420p", "-q:v", "2", "-bf", "0",
            "-fps_mode", "passthrough", "-packetsize", "2048", "-f", "vob", "pipe:1",
        ]),
        OutputFormat::Hevc => command.args([
            "-vf", WHITE_MATTE_FILTER, "-c:v", "libx265", "-pix_fmt", "yuv420p",
            "-preset", "fast", "-crf", "18", "-bf", "0", "-x265-params", "log-level=error",
            "-tag:v", "hvc1", "-fps_mode", "passthrough", "-movflags", "+frag_keyframe+delay_moov",
            "-use_editlist", "1", "-brand", "isom", "-f", "mp4", "pipe:1",
        ]),
    };
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    command
}

fn encode(job: &mut Job) -> Result<()> {
    let deadline = Instant::now() + TIME_LIMIT;
    let stage = if let Some(capture) = job.capture.take() {
        if capture.frames != job.video.frame_count || capture.audio_ready != job.audio.is_some() {
            return Err("Desktop capture is incomplete.".into());
        }
        capture.directory
    } else {
        let stage = new_stage()?;
        stage_frames(job, stage.path(), deadline)?;
        stage
    };
    if fingerprint(&job.program)? != job.fingerprint {
        return Err("The selected FFmpeg executable changed.".into());
    }
    active(&job.cancel, deadline)?;
    let output = stage.path().join(OUTPUT);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&output)
        .map_err(err)?;
    let mut child = encoder_command(job, stage.path()).spawn().map_err(err)?;
    let mut stdout = child
        .stdout
        .take()
        .expect("The encoder command always pipes stdout");
    let writer = thread::spawn(move || -> Result<()> {
        let count = io::copy(&mut Read::by_ref(&mut stdout).take(LIMIT), &mut file).map_err(err)?;
        if count == LIMIT && stdout.read(&mut [0]).map_err(err)? != 0 {
            return Err("FFmpeg output exceeds its byte budget.".into());
        }
        Ok(())
    });
    let mut writer = Some(writer);
    let finished = loop {
        if let Err(error) = active(&job.cancel, deadline) {
            break Err(error);
        }
        if writer.as_ref().is_some_and(|pipe| pipe.is_finished()) {
            if let Err(error) = writer
                .take()
                .unwrap()
                .join()
                .unwrap_or_else(|_| Err("FFmpeg output writer stopped.".into()))
            {
                break Err(error);
            }
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => break Ok(()),
            Ok(Some(_)) => break Err(match job.format {
                OutputFormat::Hevc => "FFmpeg could not encode HEVC MP4. Confirm it supports libx265 and, for audio, PCM in MP4.",
                _ => "FFmpeg did not finish successfully.",
            }.into()),
            Err(error) => break Err(err(error)),
            Ok(None) => thread::sleep(Duration::from_millis(25)),
        }
    };
    if finished.is_err() {
        let _ = child.kill();
        child.wait().map_err(err)?;
    }
    let written = writer
        .map(|pipe| {
            pipe.join()
                .unwrap_or_else(|_| Err("FFmpeg output writer stopped.".into()))
        })
        .transpose();
    finished?;
    written?;
    active(&job.cancel, deadline)?;
    if matches!(job.format, OutputFormat::Avi) {
        avi::finish(job, &output, deadline)?;
    }
    check_output(job, &output, deadline)?;
    job.stage = Some(stage);
    Ok(())
}

fn check_output(job: &Job, path: &Path, deadline: Instant) -> Result<(File, u64)> {
    no_links(path)?;
    let mut input = File::open(path).map_err(err)?;
    let meta = input.metadata().map_err(err)?;
    let size = meta.len();
    if !meta.is_file() || size <= 4 || size > LIMIT {
        return Err("FFmpeg returned an invalid output size.".into());
    }
    match job.format {
        OutputFormat::Matroska => {
            let mut prefix = [0; 4];
            input.read_exact(&mut prefix).map_err(err)?;
            if prefix != [0x1a, 0x45, 0xdf, 0xa3] {
                return Err("FFmpeg returned invalid Matroska output.".into());
            }
        }
        OutputFormat::QuickTime | OutputFormat::Hevc => {
            check_fragmented_movie(job, &mut input, size, deadline)?
        }
        OutputFormat::Avi => avi::check(job, &mut input, size, deadline)?,
        OutputFormat::Mpeg => check_mpeg(job, &mut input, size, deadline)?,
    }
    input.seek(SeekFrom::Start(0)).map_err(err)?;
    Ok((input, size))
}

fn check_mpeg(job: &Job, input: &mut File, size: u64, deadline: Instant) -> Result<()> {
    let bad = || String::from("FFmpeg returned an invalid MPEG-2 program stream.");
    if size == 0 || size % MPEG_PACK_BYTES as u64 != 0 {
        return Err(bad());
    }
    let mut packs = BufReader::with_capacity(64 * 1024, input);
    let mut pack = [0; MPEG_PACK_BYTES];
    let mut saw_system = false;
    let mut saw_video = false;
    let mut saw_audio = false;
    for _ in 0..size / MPEG_PACK_BYTES as u64 {
        active(&job.cancel, deadline)?;
        packs.read_exact(&mut pack).map_err(err)?;
        if pack[..4] != [0, 0, 1, 0xba] || pack[4] & 0xc4 != 0x44 {
            return Err(bad());
        }
        let mut offset = 14 + usize::from(pack[13] & 7);
        while offset < pack.len() {
            let Some(packet) = pack.get(offset..offset + 6) else {
                return Err(bad());
            };
            if packet[..3] != [0, 0, 1] {
                return Err(bad());
            }
            match packet[3] {
                0xbb => saw_system = true,
                0xe0 => saw_video = true,
                0xbd => saw_audio = true,
                0xbe => {} // padding
                _ => return Err(bad()),
            }
            offset += 6 + usize::from(u16::from_be_bytes([packet[4], packet[5]]));
        }
        if offset != pack.len() {
            return Err(bad());
        }
    }
    if saw_system && saw_video && saw_audio == job.audio.is_some() {
        Ok(())
    } else {
        Err(bad())
    }
}

fn check_fragmented_movie(job: &Job, input: &mut File, size: u64, deadline: Instant) -> Result<()> {
    let (expected_brand, format) = if matches!(job.format, OutputFormat::Hevc) {
        (b"isom", "HEVC MP4")
    } else {
        (b"qt  ", "QuickTime MOV")
    };
    let invalid = || format!("FFmpeg returned invalid {format} output.");
    let mut next = 0;
    let mut read_box = || -> Result<([u8; 4], u64)> {
        active(&job.cancel, deadline)?;
        if size - next < 8 {
            return Err(invalid());
        }
        input.seek(SeekFrom::Start(next)).map_err(err)?;
        let mut header = [0; 8];
        input.read_exact(&mut header).map_err(err)?;
        let length = u64::from(u32::from_be_bytes(header[..4].try_into().unwrap()));
        // The fixed pipe muxer writes bounded, ordinary-length top-level boxes.
        if length <= 8 || length > size - next {
            return Err(invalid());
        }
        next += length;
        let kind = header[4..].try_into().unwrap();
        if &kind == b"ftyp" {
            let mut brand = [0; 4];
            if length < 16 {
                return Err(invalid());
            }
            input.read_exact(&mut brand).map_err(err)?;
            if &brand != expected_brand {
                return Err(invalid());
            }
        }
        Ok((kind, next))
    };
    if read_box()?.0 != *b"ftyp" || read_box()?.0 != *b"moov" || read_box()?.0 != *b"moof" {
        return Err(invalid());
    }
    // At most one fragment can start at each video keyframe.
    for _ in 0..job.video.frame_count {
        if read_box()?.0 != *b"mdat" {
            return Err(invalid());
        }
        let (kind, end) = read_box()?;
        if kind == *b"mfra" && end == size {
            return Ok(());
        }
        if kind != *b"moof" {
            return Err(invalid());
        }
    }
    Err(invalid())
}

fn copy_publication(
    mut input: impl Read,
    mut output: impl Write,
    mut remaining: u64,
    cancel: &AtomicBool,
    deadline: Instant,
) -> Result<()> {
    let mut buffer = [0u8; 64 * 1024];
    while remaining != 0 {
        active(cancel, deadline)?;
        let length = remaining.min(buffer.len() as u64) as usize;
        input.read_exact(&mut buffer[..length]).map_err(err)?;
        active(cancel, deadline)?;
        output.write_all(&buffer[..length]).map_err(err)?;
        remaining -= length as u64;
    }
    active(cancel, deadline)?;
    if input.read(&mut [0]).map_err(err)? != 0 {
        return Err("The staged FFmpeg output grew while saving.".into());
    }
    Ok(())
}

fn publish(job: Job) -> Result<()> {
    let deadline = Instant::now() + TIME_LIMIT;
    active(&job.cancel, deadline)?;
    let output = job
        .stage
        .as_ref()
        .ok_or("FFmpeg output is not ready.")?
        .path()
        .join(OUTPUT);
    let (input, size) = check_output(&job, &output, deadline)?;
    no_links(&job.destination)?;
    let folder = job
        .destination
        .parent()
        .ok_or("Missing FFmpeg destination folder.")?;
    let mut file = NamedTempFile::new_in(folder).map_err(err)?;
    copy_publication(input, &mut file, size, &job.cancel, deadline)?;
    file.as_file().sync_all().map_err(err)?;
    no_links(&job.destination)?;
    active(&job.cancel, deadline)?;
    file.persist_noclobber(&job.destination).map_err(|error| {
        if error.error.kind() == io::ErrorKind::AlreadyExists || job.destination.exists() {
            "The destination now exists. Choose a new filename. The existing file was preserved."
                .into()
        } else {
            err(error)
        }
    })?;
    Ok(())
}

#[tauri::command]
pub async fn ffmpeg_choose(
    window: tauri::WebviewWindow,
    state: State<'_, FFmpeg>,
    format: Option<OutputFormat>,
) -> Result<Option<Selection>> {
    main_only(&window)?;
    choose(window, state, None, format.unwrap_or_default()).await
}

#[tauri::command]
pub async fn ffmpeg_choose_capture(
    window: tauri::WebviewWindow,
    state: State<'_, FFmpeg>,
    video: Video,
    audio: Option<Audio>,
    format: Option<OutputFormat>,
) -> Result<Option<Selection>> {
    main_only(&window)?;
    choose(
        window,
        state,
        Some((video, audio)),
        format.unwrap_or_default(),
    )
    .await
}

#[tauri::command]
pub async fn ffmpeg_push_audio(
    window: tauri::WebviewWindow,
    state: State<'_, FFmpeg>,
    request: tauri::ipc::Request<'_>,
) -> Result<()> {
    main_only(&window)?;
    let header = request
        .headers()
        .get("x-splash-job")
        .and_then(|value| value.to_str().ok())
        .ok_or("Missing capture owner.")?;
    let id = Uuid::parse_str(header).map_err(err)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected binary WAV input.".into());
    };
    let mut slot = state.0.lock().map_err(err)?;
    let job = slot
        .waiting
        .as_mut()
        .filter(|job| job.id == id)
        .ok_or("Desktop capture is closed.")?;
    push_capture_audio(job, bytes)
}

#[tauri::command]
pub fn ffmpeg_push_frame(
    window: tauri::WebviewWindow,
    state: State<'_, FFmpeg>,
    request: tauri::ipc::Request<'_>,
) -> Result<()> {
    main_only(&window)?;
    let header = |key| {
        request
            .headers()
            .get(key)
            .and_then(|value| value.to_str().ok())
    };
    let id =
        Uuid::parse_str(header("x-splash-job").ok_or("Missing capture owner.")?).map_err(err)?;
    let frame = header("x-splash-frame")
        .ok_or("Missing capture frame.")?
        .parse()
        .map_err(err)?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err("Expected binary PNG input.".into());
    };
    let mut slot = state.0.lock().map_err(err)?;
    let job = slot
        .waiting
        .as_mut()
        .filter(|job| job.id == id)
        .ok_or("Desktop capture is closed.")?;
    push_capture(job, frame, bytes)
}

async fn choose(
    window: tauri::WebviewWindow,
    state: State<'_, FFmpeg>,
    request: Option<(Video, Option<Audio>)>,
    format: OutputFormat,
) -> Result<Option<Selection>> {
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut slot = state.0.lock().map_err(err)?;
        if slot.closing || slot.picking.is_some() || slot.waiting.is_some() || slot.running.is_some() {
            return Err("An FFmpeg export already owns this window.".into());
        }
        slot.picking = Some(Arc::clone(&cancel));
    }
    let owner = Arc::clone(&cancel);
    let result =
        tauri::async_runtime::spawn_blocking(move || choose_job(&window, request, format, owner))
            .await;
    let mut slot = state.0.lock().map_err(err)?;
    if !slot
        .picking
        .as_ref()
        .is_some_and(|owner| Arc::ptr_eq(owner, &cancel))
    {
        return Ok(None);
    }
    slot.picking = None;
    let Some(job) = result.map_err(err)?? else {
        return Ok(None);
    };
    let result = Selection {
        id: job.id,
        frame_count: job.video.frame_count,
        width: job.video.width,
        height: job.video.height,
        audio_channels: job.audio.as_ref().map(|audio| audio.channels),
        format: job.format,
    };
    slot.waiting = Some(job);
    Ok(Some(result))
}

#[tauri::command]
pub async fn ffmpeg_encode(
    window: tauri::WebviewWindow,
    state: State<'_, FFmpeg>,
    id: Uuid,
) -> Result<()> {
    main_only(&window)?;
    let mut job = {
        let mut slot = state.0.lock().map_err(err)?;
        if !slot
            .waiting
            .as_ref()
            .is_some_and(|job| job.id == id && job.stage.is_none())
        {
            return Err("No matching FFmpeg inputs are ready.".into());
        }
        let job = slot.waiting.take().unwrap();
        slot.running = Some((id, Arc::clone(&job.cancel)));
        job
    };
    let result = tauri::async_runtime::spawn_blocking(move || -> Result<Job> {
        encode(&mut job)?;
        Ok(job)
    })
    .await;
    let mut slot = state.0.lock().map_err(err)?;
    let was_cancelled = slot
        .running
        .take()
        .is_some_and(|(_, cancel)| cancel.load(Ordering::Relaxed));
    let job = result.map_err(err)??;
    if was_cancelled {
        return Err("FFmpeg export cancelled.".into());
    }
    slot.waiting = Some(job);
    Ok(())
}

#[tauri::command]
pub async fn ffmpeg_publish(
    window: tauri::WebviewWindow,
    state: State<'_, FFmpeg>,
    id: Uuid,
) -> Result<()> {
    main_only(&window)?;
    let job = {
        let mut slot = state.0.lock().map_err(err)?;
        if !slot
            .waiting
            .as_ref()
            .is_some_and(|job| job.id == id && job.stage.is_some())
        {
            return Err("No matching FFmpeg output is ready.".into());
        }
        let job = slot.waiting.take().unwrap();
        slot.running = Some((id, Arc::clone(&job.cancel)));
        job
    };
    let result = tauri::async_runtime::spawn_blocking(move || publish(job)).await;
    state.0.lock().map_err(err)?.running = None;
    result.map_err(err)?
}

#[tauri::command]
pub fn ffmpeg_cancel(
    window: tauri::WebviewWindow,
    state: State<'_, FFmpeg>,
    id: Uuid,
) -> Result<()> {
    main_only(&window)?;
    let mut slot = state.0.lock().map_err(err)?;
    if slot.waiting.as_ref().is_some_and(|job| job.id == id) {
        slot.waiting = None;
    }
    if let Some((owner, cancel)) = &slot.running {
        if *owner == id {
            cancel.store(true, Ordering::Relaxed);
        }
    }
    Ok(())
}

impl FFmpeg {
    pub fn defer_close(&self) -> Option<bool> {
        let mut slot = self.0.lock().ok()?;
        let (_, cancel) = slot.running.as_ref()?;
        cancel.store(true, Ordering::Relaxed);
        let first = !slot.closing;
        slot.closing = true;
        Some(first)
    }

    pub fn running(&self) -> bool {
        self.0.lock().is_ok_and(|slot| slot.running.is_some())
    }

    pub fn close(&self) {
        if let Ok(mut slot) = self.0.lock() {
            if let Some(cancel) = slot.picking.take() {
                cancel.store(true, Ordering::Relaxed);
            }
            slot.waiting = None;
            if let Some((_, cancel)) = &slot.running {
                cancel.store(true, Ordering::Relaxed);
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (TempDir, Job) {
        let root = crate::test_tempdir().unwrap();
        let input = root.path().join("input");
        fs::create_dir(&input).unwrap();
        let manifest = input.join("ffmpeg.json");
        fs::write(&manifest, br#"{
            "version":1,"kind":"splash-ffmpeg-inputs",
            "video":{"pattern":"frame-%06d.png","firstNumber":3,"frameCount":2,
                "width":2,"height":3,"frameRate":{"numerator":2997,"denominator":100},"buttons":"Up"},
            "audio":null,"suggestedArguments":["-i","https://example.invalid","other-output.mkv"]
        }"#).unwrap();
        let job = Job {
            id: Uuid::new_v4(),
            input,
            program: std::env::current_exe().unwrap(),
            fingerprint: [0; 32],
            destination: root.path().join("out.mkv"),
            format: OutputFormat::Matroska,
            video: read_manifest(&manifest).unwrap().video,
            audio: None,
            capture: None,
            stage: None,
            cancel: Arc::default(),
        };
        (root, job)
    }

    // An envelope fixture for staging tests only.
    fn png() -> Vec<u8> {
        let mut png = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR".to_vec();
        png.extend(2u32.to_be_bytes());
        png.extend(3u32.to_be_bytes());
        png.extend([0; 9]);
        png.extend(b"\0\0\0\0IEND\xaeB\x60\x82");
        png
    }

    fn mixed(job: &mut Job, channels: u16) -> PathBuf {
        let manifest = job.input.join("ffmpeg.json");
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
        value["audio"] = serde_json::json!({
            "file": "audio.wav", "format": "pcm_s16le", "sampleRate": 48000,
            "start": 3203, "end": 6406, "frames": 3203, "channels": channels,
        });
        fs::write(&manifest, serde_json::to_vec(&value).unwrap()).unwrap();
        job.audio = read_manifest(&manifest).unwrap().audio;
        manifest
    }

    fn wav(channels: u16) -> Vec<u8> {
        let bytes = 3203 * u32::from(channels) * 2;
        let mut output = b"RIFF".to_vec();
        output.extend((36 + bytes).to_le_bytes());
        output.extend(b"WAVEfmt ");
        output.extend(16u32.to_le_bytes());
        output.extend(1u16.to_le_bytes());
        output.extend(channels.to_le_bytes());
        output.extend(48_000u32.to_le_bytes());
        output.extend((48_000u32 * u32::from(channels) * 2).to_le_bytes());
        output.extend((channels * 2).to_le_bytes());
        output.extend(16u16.to_le_bytes());
        output.extend(b"data");
        output.extend(bytes.to_le_bytes());
        output.extend((0..bytes).map(|index| (index % 251) as u8));
        output
    }

    #[test]
    #[ignore = "requires explicitly selected FFmpeg and FFprobe executables"]
    fn real_matroska_preserves_frames_timestamps_alpha_and_pcm() {
        verify_real_export(OutputFormat::Matroska);
    }

    #[test]
    #[ignore = "requires explicitly selected FFmpeg and FFprobe executables"]
    fn real_quicktime_preserves_frames_timestamps_alpha_and_pcm() {
        verify_real_export(OutputFormat::QuickTime);
    }

    #[test]
    #[ignore = "requires explicitly selected FFmpeg and FFprobe executables"]
    fn real_avi_preserves_frames_timestamps_alpha_and_pcm() {
        verify_real_export(OutputFormat::Avi);
    }

    fn verify_real_export(format: OutputFormat) {
        let program = fs::canonicalize(std::env::var_os("SPLASH_QA_FFMPEG").unwrap()).unwrap();
        let probe = fs::canonicalize(std::env::var_os("SPLASH_QA_FFPROBE").unwrap()).unwrap();
        let frames = [[255, 0, 0, 255].repeat(6), [0, 64, 255, 128].repeat(6)];
        let expected_pixels = frames.concat();

        for has_audio in [false, true] {
            let (_root, mut job) = fixture();
            job.format = format;
            job.destination.set_extension(format.destination().3);
            job.fingerprint = fingerprint(&program).unwrap();
            job.program = program.clone();
            for (index, frame) in frames.iter().enumerate() {
                let mut png = Command::new(&program)
                    .args([
                        "-v",
                        "error",
                        "-f",
                        "rawvideo",
                        "-pixel_format",
                        "rgba",
                        "-video_size",
                        "2x3",
                        "-i",
                        "pipe:0",
                        "-frames:v",
                        "1",
                        "-update",
                        "1",
                    ])
                    .arg(job.input.join(format!("frame-{:06}.png", 3 + index)))
                    .stdin(Stdio::piped())
                    .stderr(Stdio::piped())
                    .spawn()
                    .unwrap();
                png.stdin.take().unwrap().write_all(frame).unwrap();
                assert_success(png.wait_with_output().unwrap());
            }
            let mut expected_pcm = Vec::new();
            if has_audio {
                mixed(&mut job, 2);
                let pcm = wav(2);
                expected_pcm.extend_from_slice(&pcm[44..]);
                fs::write(job.input.join(AUDIO_FILE), pcm).unwrap();
            }
            encode(&mut job).unwrap();
            let stage = job.stage.as_ref().unwrap().path().to_owned();
            let destination = job.destination.clone();
            assert!(!destination.exists());
            publish(job).unwrap();
            assert!(!stage.exists());
            let mut header = [0; 128];
            File::open(&destination)
                .unwrap()
                .read_exact(&mut header)
                .unwrap();
            let (container, codec, pixel_format) = match format {
                OutputFormat::Matroska => {
                    let doc_type = b"\x42\x82\x88matroska";
                    assert!(header
                        .windows(doc_type.len())
                        .any(|field| field == doc_type));
                    ("matroska", "ffv1", "bgra")
                }
                OutputFormat::QuickTime => {
                    assert_eq!(&header[4..12], b"ftypqt  ");
                    ("mov", "qtrle", "argb")
                }
                OutputFormat::Avi => {
                    assert_eq!(&header[..4], b"RIFF");
                    assert_eq!(&header[8..12], b"AVI ");
                    assert_eq!(u64::from(u32::from_le_bytes(header[4..8].try_into().unwrap())) + 8,
                        fs::metadata(&destination).unwrap().len());
                    ("avi", "ffv1", "bgra")
                }
                OutputFormat::Mpeg | OutputFormat::Hevc => {
                    unreachable!("Lossy formats use a separate color fixture")
                }
            };

            let metadata: serde_json::Value = serde_json::from_slice(&assert_success(
                Command::new(&probe)
                    .args([
                        "-v",
                        "error",
                        "-show_streams",
                        "-show_packets",
                        "-show_format",
                        "-of",
                        "json",
                    ])
                    .arg(&destination)
                    .output()
                    .unwrap(),
            ))
            .unwrap();
            assert!(metadata["format"]["format_name"]
                .as_str()
                .unwrap()
                .contains(container));
            let streams = metadata["streams"].as_array().unwrap();
            assert_eq!(streams.len(), if has_audio { 2 } else { 1 });
            assert_eq!(streams[0]["codec_name"], codec);
            assert_eq!(streams[0]["pix_fmt"], pixel_format);
            assert_eq!(streams[0]["width"], 2);
            assert_eq!(streams[0]["height"], 3);
            let packet_times = |stream: &str| -> Vec<f64> {
                metadata["packets"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .filter(|packet| packet["codec_type"] == stream)
                    .map(|packet| packet["pts_time"].as_str().unwrap().parse().unwrap())
                    .collect()
            };
            let timestamps = packet_times("video");
            assert_eq!(timestamps.len(), 2);
            assert_eq!(timestamps[0], 0.0);
            let tolerance = match format {
                OutputFormat::Matroska => 0.001,
                OutputFormat::QuickTime | OutputFormat::Avi => 0.000001,
                OutputFormat::Mpeg | OutputFormat::Hevc => unreachable!(),
            };
            assert!((timestamps[1] - 100.0 / 2997.0).abs() <= tolerance);
            let decode = |args: &[&str]| {
                assert_success(
                    Command::new(&program)
                        .args(["-v", "error", "-i"])
                        .arg(&destination)
                        .args(args)
                        .arg("pipe:1")
                        .output()
                        .unwrap(),
                )
            };
            assert_eq!(
                decode(&["-map", "0:v:0", "-pix_fmt", "rgba", "-f", "rawvideo"]),
                expected_pixels
            );
            if matches!(format, OutputFormat::Avi) {
                let seek = assert_success(Command::new(&program)
                    .args(["-v", "error", "-ss", "0.033", "-i"]).arg(&destination)
                    .args(["-frames:v", "1", "-map", "0:v:0", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"])
                    .output().unwrap());
                assert_eq!(seek, frames[1]);
            }
            if has_audio {
                assert_eq!(streams[1]["codec_name"], "pcm_s16le");
                assert_eq!(streams[1]["sample_rate"], "48000");
                assert_eq!(streams[1]["channels"], 2);
                assert_eq!(packet_times("audio")[0], 0.0);
                assert_eq!(expected_pcm.len(), 3203 * 4);
                assert_eq!(decode(&["-map", "0:a:0", "-f", "s16le"]), expected_pcm);
            }
        }
    }

    #[test]
    fn quicktime_publication_requires_a_complete_bounded_container() {
        let (_root, mut job) = fixture();
        job.format = OutputFormat::QuickTime;
        job.destination.set_extension("mov");
        let stage = crate::test_tempdir().unwrap();
        let path = stage.path().join(OUTPUT);
        let atom = |kind: &[u8; 4], body: &[u8]| {
            let mut bytes = (8 + body.len() as u32).to_be_bytes().to_vec();
            bytes.extend(kind);
            bytes.extend(body);
            bytes
        };
        let mut mov = atom(b"ftyp", b"qt  \0\0\0\0");
        mov.extend(atom(b"moov", b"metadata"));
        for _ in 0..2 {
            mov.extend(atom(b"moof", b"fragment"));
            mov.extend(atom(b"mdat", b"media"));
        }
        fs::write(&path, &mov).unwrap();
        assert!(check_output(&job, &path, Instant::now() + TIME_LIMIT).is_err());

        mov.extend(atom(b"mfra", b"trailer"));
        let mut wrong_brand = mov.clone();
        wrong_brand[8..12].copy_from_slice(b"isom");
        let mut bad_length = mov.clone();
        bad_length[..4].copy_from_slice(&u32::MAX.to_be_bytes());
        for invalid in [&wrong_brand[..], &bad_length[..], &mov[..mov.len() - 1]] {
            fs::write(&path, invalid).unwrap();
            assert!(check_output(&job, &path, Instant::now() + TIME_LIMIT).is_err());
        }
        fs::write(&path, &mov).unwrap();
        let destination = job.destination.clone();
        job.stage = Some(stage);
        publish(job).unwrap();
        assert_eq!(fs::read(destination).unwrap(), mov);
    }

    #[test]
    fn avi_index_finalization_checks_original_packets_and_cancellation() {
        let (root, mut job) = fixture();
        job.format = OutputFormat::Avi;
        let path = root.path().join("capture.avi");
        let chunk = |kind: &[u8; 4], body: &[u8]| {
            let mut bytes = kind.to_vec();
            bytes.extend((body.len() as u32).to_le_bytes());
            bytes.extend(body);
            if body.len() % 2 != 0 { bytes.push(0); }
            bytes
        };
        let mut main = [0; 56];
        main[24] = 1;
        main[32] = 2;
        main[36] = 3;
        let mut stream = [0; 56];
        stream[..8].copy_from_slice(b"vidsFFV1");
        stream[20..24].copy_from_slice(&100u32.to_le_bytes());
        stream[24..28].copy_from_slice(&2997u32.to_le_bytes());
        let mut strl = b"strl".to_vec();
        strl.extend(chunk(b"strh", &stream));
        let mut hdrl = b"hdrl".to_vec();
        hdrl.extend(chunk(b"avih", &main));
        hdrl.extend(chunk(b"LIST", &strl));
        let mut avi = b"RIFF\xff\xff\xff\xffAVI ".to_vec();
        avi.extend(chunk(b"LIST", &hdrl));
        avi.extend(b"LIST\xff\xff\xff\xffmovi");
        avi.extend(chunk(b"00dc", b"first"));
        avi.extend(chunk(b"00dc", b"last"));
        let deadline = || Instant::now() + TIME_LIMIT;
        fs::write(&path, &avi[..avi.len() - 1]).unwrap();
        assert!(avi::finish(&job, &path, deadline()).is_err());
        assert!(check_output(&job, &path, deadline()).is_err());
        fs::write(&path, &avi).unwrap();
        job.cancel.store(true, Ordering::Relaxed);
        assert!(avi::finish(&job, &path, deadline()).is_err());
        assert_eq!(fs::read(&path).unwrap(), avi);
        job.cancel.store(false, Ordering::Relaxed);
        avi::finish(&job, &path, deadline()).unwrap();
        check_output(&job, &path, deadline()).unwrap();
        let indexed = fs::read(&path).unwrap();
        let mut expected = b"idx1\x20\0\0\0".to_vec();
        for (offset, len) in [(4u32, 5u32), (18, 4)] {
            expected.extend(b"00dc\x10\0\0\0");
            expected.extend(offset.to_le_bytes());
            expected.extend(len.to_le_bytes());
        }
        assert_eq!(&indexed[avi.len()..], expected);
    }

    #[test]
    fn mpeg_admits_exact_rates_even_dimensions_and_complete_packs() {
        let (root, mut job) = fixture();
        job.format = OutputFormat::Mpeg;
        assert!(job.format.validate_video(&job.video).unwrap_err().contains("even"));
        job.video.height = 4;
        assert!(job.format.validate_video(&job.video).unwrap_err().contains("frame rate"));
        job.video.frame_rate = FrameRate {
            numerator: 60_000,
            denominator: 2002,
        };
        job.format.validate_video(&job.video).unwrap();

        let path = root.path().join("program.mpg");
        let mut pack = [0; MPEG_PACK_BYTES];
        pack[..5].copy_from_slice(&[0, 0, 1, 0xba, 0x44]);
        pack[14..20].copy_from_slice(&[0, 0, 1, 0xbb, 0, 6]);
        pack[26..32].copy_from_slice(&[0, 0, 1, 0xe0, 7, 224]);
        fs::write(&path, pack).unwrap();
        let deadline = || Instant::now() + TIME_LIMIT;
        check_output(&job, &path, deadline()).unwrap();
        fs::write(&path, &pack[..pack.len() - 1]).unwrap();
        assert!(check_output(&job, &path, deadline()).is_err());
        let mut wrong_header = pack;
        wrong_header[4] = 0x21;
        fs::write(&path, [pack, wrong_header].concat()).unwrap();
        assert!(check_output(&job, &path, deadline()).is_err());
        let mut wrong_packet = pack;
        wrong_packet[31] -= 1;
        fs::write(&path, wrong_packet).unwrap();
        assert!(check_output(&job, &path, deadline()).is_err());
        fs::write(&path, pack).unwrap();
        job.cancel.store(true, Ordering::Relaxed);
        assert!(check_output(&job, &path, deadline()).is_err());
    }

    #[test]
    fn hevc_requires_the_actual_encoder_name_and_mp4_fragments() {
        assert!(lists_hevc_encoder(b"Encoders:\r\n V....D libx265 HEVC\r\n"));
        assert!(!lists_hevc_encoder(b" V..... hevc_nvenc libx265 alternative\n A..... libx265 invalid\n V....D libx265_extra\n"));
        let (root, mut job) = fixture();
        job.format = OutputFormat::Hevc;
        assert!(job.format.validate_video(&job.video).is_err());
        job.video.width = 16;
        job.video.height = 17;
        assert!(job.format.validate_video(&job.video).is_err());
        job.video.height = 16;
        job.format.validate_video(&job.video).unwrap();

        let path = root.path().join("program.mp4");
        let mut mp4 = b"\0\0\0\x10ftypisom\0\0\0\0".to_vec();
        for kind in [b"moov", b"moof", b"mdat", b"mfra"] {
            mp4.extend(9u32.to_be_bytes());
            mp4.extend(kind);
            mp4.push(0);
        }
        fs::write(&path, &mp4).unwrap();
        check_output(&job, &path, Instant::now() + TIME_LIMIT).unwrap();
        mp4[8..12].copy_from_slice(b"qt  ");
        fs::write(&path, &mp4).unwrap();
        assert!(check_output(&job, &path, Instant::now() + TIME_LIMIT).is_err());
        job.cancel.store(true, Ordering::Relaxed);
        assert!(probe_hevc(&job.program, &job.cancel).unwrap_err().contains("cancelled"));
    }

    fn assert_success(output: std::process::Output) -> Vec<u8> {
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        output.stdout
    }

    #[test]
    fn mixed_manifest_requires_original_rounded_sample_bounds() {
        let (_root, mut job) = fixture();
        let path = mixed(&mut job, 2);
        let audio = job.audio.as_ref().unwrap();
        assert_eq!(
            (audio.start, audio.end, audio.frames, audio.data_bytes()),
            (3203, 6406, 3203, 12_812)
        );
        let original: serde_json::Value =
            serde_json::from_slice(&fs::read(&path).unwrap()).unwrap();
        for (field, value) in [
            ("start", serde_json::json!(3204)),
            ("end", serde_json::json!(6407)),
            ("frames", serde_json::json!(3204)),
            ("channels", serde_json::json!(3)),
            ("sampleRate", serde_json::json!(44100)),
            ("file", serde_json::json!("../audio.wav")),
        ] {
            let mut changed = original.clone();
            changed["audio"][field] = value;
            fs::write(&path, serde_json::to_vec(&changed).unwrap()).unwrap();
            assert!(read_manifest(&path).is_err(), "{field}");
        }
    }

    #[test]
    fn stages_and_maps_the_exact_mono_or_stereo_wav() {
        for channels in [1, 2] {
            let (_root, mut job) = fixture();
            mixed(&mut job, channels);
            let bytes = wav(channels);
            fs::write(job.input.join(AUDIO_FILE), &bytes).unwrap();
            for index in [3, 4] {
                fs::write(job.input.join(format!("frame-{index:06}.png")), png()).unwrap();
            }
            let stage = crate::test_tempdir().unwrap();
            stage_frames(&job, stage.path(), Instant::now() + TIME_LIMIT).unwrap();
            assert_eq!(fs::read(stage.path().join(AUDIO_FILE)).unwrap(), bytes);
            let command = encoder_command(&job, stage.path());
            let args: Vec<_> = command
                .get_args()
                .map(|arg| arg.to_str().unwrap())
                .collect();
            assert!(args
                .windows(4)
                .any(|a| a == ["-protocol_whitelist", "file,pipe", "-i", "audio.wav"]));
            assert!(args.windows(8).any(|a| a
                == [
                    "-map",
                    "0:v:0",
                    "-map",
                    "1:a:0",
                    "-c:a",
                    "pcm_s16le",
                    "-c:v",
                    "ffv1"
                ]));
            assert!(!args.contains(&"-frames:v"));
            assert!(!args.contains(&"-shortest"));
        }
    }

    #[test]
    fn rejects_missing_truncated_mismatched_or_over_budget_audio_before_encoding() {
        let (_root, mut job) = fixture();
        mixed(&mut job, 1);
        let mut bytes = wav(1);
        for index in [3, 4] {
            fs::write(job.input.join(format!("frame-{index:06}.png")), png()).unwrap();
        }
        let reject = || {
            let stage = crate::test_tempdir().unwrap();
            stage_frames(&job, stage.path(), Instant::now() + TIME_LIMIT).unwrap_err()
        };
        assert!(!reject().is_empty());
        let path = job.input.join(AUDIO_FILE);
        fs::write(&path, &bytes[..bytes.len() - 1]).unwrap();
        assert!(reject().contains("length"));
        bytes[22] = 2;
        fs::write(&path, &bytes).unwrap();
        assert!(reject().contains("header"));
        bytes[22] = 1;
        fs::write(&path, &bytes).unwrap();
        let file = OpenOptions::new()
            .write(true)
            .open(job.input.join("frame-000003.png"))
            .unwrap();
        file.set_len(LIMIT - bytes.len() as u64 + 1).unwrap();
        assert!(reject().contains("size budget"));
    }

    #[test]
    fn builds_own_fixed_arguments_from_video_settings() {
        let (root, job) = fixture();
        let command = encoder_command(&job, root.path());
        let arguments: Vec<_> = command
            .get_args()
            .map(|arg| arg.to_str().unwrap())
            .collect();
        assert_eq!(
            &arguments[..20],
            [
                "-hide_banner",
                "-nostdin",
                "-nostats",
                "-loglevel",
                "error",
                "-xerror",
                "-n",
                "-protocol_whitelist",
                "file,pipe",
                "-framerate",
                "2997/100",
                "-pattern_type",
                "sequence",
                "-start_number",
                "3",
                "-start_number_range",
                "1",
                "-i",
                "frame-%06d.png",
                "-map",
            ]
        );
        assert_eq!(
            &arguments[20..],
            [
                "0:v:0",
                "-frames:v",
                "2",
                "-c:v",
                "ffv1",
                "-pix_fmt",
                "bgra",
                "-f",
                "matroska",
                "pipe:1",
            ]
        );
    }

    #[test]
    fn stages_ordered_pngs_and_rejects_an_incomplete_or_cancelled_capture() {
        let (_root, job) = fixture();
        let bytes = png();
        fs::write(job.input.join("frame-000003.png"), &bytes).unwrap();
        let stage = crate::test_tempdir().unwrap();
        assert!(stage_frames(&job, stage.path(), Instant::now() + TIME_LIMIT).is_err());
        fs::write(
            job.input.join("frame-000004.png"),
            &bytes[..bytes.len() - 1],
        )
        .unwrap();
        let stage = crate::test_tempdir().unwrap();
        assert!(stage_frames(&job, stage.path(), Instant::now() + TIME_LIMIT).is_err());
        fs::write(job.input.join("frame-000004.png"), &bytes).unwrap();
        let stage = crate::test_tempdir().unwrap();
        stage_frames(&job, stage.path(), Instant::now() + TIME_LIMIT).unwrap();
        assert_eq!(
            fs::read(stage.path().join("frame-000003.png")).unwrap(),
            bytes
        );
        assert_eq!(
            fs::read(stage.path().join("frame-000004.png")).unwrap(),
            bytes
        );
        let stage = crate::test_tempdir().unwrap();
        job.cancel.store(true, Ordering::Relaxed);
        assert!(stage_frames(&job, stage.path(), Instant::now() + TIME_LIMIT).is_err());
        assert_eq!(fs::read_dir(stage.path()).unwrap().count(), 0);
    }

    #[test]
    fn direct_capture_only_accepts_ordered_complete_native_inputs() {
        let (_root, mut job) = fixture();
        let directory = new_stage().unwrap();
        let owned = directory.path().to_owned();
        job.capture = Some(Capture {
            directory,
            frames: 0,
            bytes: 0,
            audio_ready: false,
        });
        assert!(push_capture(&mut job, 4, &png()).is_err());
        let mut malformed = png();
        malformed[19] = 3;
        assert!(push_capture(&mut job, 3, &malformed).is_err());
        push_capture(&mut job, 3, &png()).unwrap();
        assert!(push_capture(&mut job, 3, &png()).is_err());
        assert_eq!(fs::read(owned.join("frame-000003.png")).unwrap(), png());
        assert!(encode(&mut job).unwrap_err().contains("incomplete"));
        assert!(!owned.exists());
        assert!(!job.destination.exists());
    }

    #[test]
    fn direct_mixed_capture_requires_exact_wav_before_pngs_and_reserves_its_bytes() {
        let (_root, mut job) = fixture();
        mixed(&mut job, 2);
        let directory = new_stage().unwrap();
        let owned = directory.path().to_owned();
        job.capture = Some(Capture {
            directory,
            frames: 0,
            bytes: 0,
            audio_ready: false,
        });
        let audio = wav(2);
        assert!(push_capture(&mut job, 3, &png()).is_err());
        assert!(push_capture_audio(&mut job, &audio[..audio.len() - 1]).is_err());
        let mut malformed = audio.clone();
        malformed[22] = 1;
        assert!(push_capture_audio(&mut job, &malformed).is_err());
        assert!(!owned.join(AUDIO_FILE).exists());
        push_capture_audio(&mut job, &audio).unwrap();
        assert_eq!(fs::read(owned.join(AUDIO_FILE)).unwrap(), audio);
        assert!(push_capture_audio(&mut job, &audio).is_err());
        job.capture.as_mut().unwrap().bytes = LIMIT - audio.len() as u64;
        assert!(push_capture(&mut job, 3, &png()).is_err());
        job.capture.as_mut().unwrap().bytes = 0;
        push_capture(&mut job, 3, &png()).unwrap();
        push_capture(&mut job, 4, &png()).unwrap();
        assert!(encode(&mut job).unwrap_err().contains("executable changed"));
        assert!(!owned.exists());
        assert!(!job.destination.exists());
    }

    #[test]
    fn publishes_complete_bytes_and_preserves_destination_collisions() {
        let (_root, mut job) = fixture();
        let stage = crate::test_tempdir().unwrap();
        let output = [0x1a, 0x45, 0xdf, 0xa3, 0x00];
        fs::write(stage.path().join(OUTPUT), output).unwrap();
        let destination = job.destination.clone();
        job.stage = Some(stage);
        publish(job).unwrap();
        assert_eq!(fs::read(&destination).unwrap(), output);

        let (_root, mut job) = fixture();
        fs::write(&job.destination, b"original file").unwrap();
        let stage = crate::test_tempdir().unwrap();
        fs::write(stage.path().join(OUTPUT), output).unwrap();
        let stage_path = stage.path().to_owned();
        let destination = job.destination.clone();
        job.stage = Some(stage);
        assert!(publish(job).unwrap_err().contains("existing file was preserved"));
        assert_eq!(fs::read(destination).unwrap(), b"original file");
        assert!(!stage_path.exists());
    }

    #[test]
    fn publication_stops_after_cancel_and_rejects_output_length_changes() {
        let cancel = AtomicBool::new(false);
        let deadline = Instant::now() + TIME_LIMIT;
        let payload = vec![7; 128 * 1024];
        struct CancelAfterWrite<'a> {
            cancel: &'a AtomicBool,
            written: usize,
        }
        impl Write for CancelAfterWrite<'_> {
            fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
                self.written += bytes.len();
                self.cancel.store(true, Ordering::Relaxed);
                Ok(bytes.len())
            }
            fn flush(&mut self) -> io::Result<()> {
                Ok(())
            }
        }
        let mut output = CancelAfterWrite { cancel: &cancel, written: 0 };
        let result = copy_publication(&payload[..], &mut output, payload.len() as u64, &cancel, deadline);
        assert!(result.unwrap_err().contains("cancelled"));
        assert_eq!(output.written, 64 * 1024);
        cancel.store(false, Ordering::Relaxed);
        assert!(copy_publication(&payload[..], io::sink(), 1, &cancel, deadline)
            .unwrap_err()
            .contains("grew while saving"));
        assert!(copy_publication(&payload[..1], io::sink(), 2, &cancel, deadline).is_err());
    }

    #[test]
    fn preserves_no_output_after_executable_change_or_process_failure() {
        let (_root, mut job) = fixture();
        let bytes = png();
        fs::write(job.input.join("frame-000003.png"), &bytes).unwrap();
        fs::write(job.input.join("frame-000004.png"), &bytes).unwrap();
        assert!(encode(&mut job).unwrap_err().contains("executable changed"));
        job.fingerprint = fingerprint(&job.program).unwrap();
        assert!(encode(&mut job).unwrap_err().contains("did not finish"));
        assert!(job.stage.is_none());
        assert!(!job.destination.exists());
    }
}
