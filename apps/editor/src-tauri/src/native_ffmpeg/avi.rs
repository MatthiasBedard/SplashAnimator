use super::{active, err, no_links, Job, Result, LIMIT};
use std::{
    fs::{File, OpenOptions},
    io::{BufWriter, Read, Seek, SeekFrom, Write},
    path::Path,
    time::Instant,
};

const STREAM_SIZE: u32 = u32::MAX;
const STREAM_LENGTH: u32 = 0x4000_0000;
const HAS_INDEX: u32 = 0x10;
const KEYFRAME: u32 = 0x10;

struct AviHeader {
    main: u64,
    video: u64,
    audio: Option<u64>,
    movi: u64,
    movi_size: u32,
}

fn invalid() -> String {
    "FFmpeg returned invalid or incomplete AVI output.".into()
}

fn read_at<const N: usize>(input: &mut File, offset: u64) -> Result<[u8; N]> {
    input.seek(SeekFrom::Start(offset)).map_err(err)?;
    let mut bytes = [0; N];
    input.read_exact(&mut bytes).map_err(err)?;
    Ok(bytes)
}

fn word(bytes: &[u8], offset: usize) -> u32 {
    u32::from_le_bytes(bytes[offset..offset + 4].try_into().unwrap())
}

fn chunk(input: &mut File, start: u64, limit: u64) -> Result<([u8; 4], u32)> {
    if start + 8 > limit {
        return Err(invalid());
    }
    let bytes = read_at::<8>(input, start)?;
    Ok((bytes[..4].try_into().unwrap(), word(&bytes, 4)))
}

fn chunk_end(start: u64, size: u32, limit: u64) -> Result<u64> {
    let end = start + 8 + u64::from(size) + u64::from(size % 2);
    if end > limit {
        return Err(invalid());
    }
    Ok(end)
}

fn header(
    job: &Job,
    input: &mut File,
    size: u64,
    streamed: bool,
    deadline: Instant,
) -> Result<AviHeader> {
    let riff = read_at::<12>(input, 0)?;
    let riff_size = if streamed {
        STREAM_SIZE
    } else {
        (size - 8) as u32
    };
    if &riff[..4] != b"RIFF" || &riff[8..] != b"AVI " || word(&riff, 4) != riff_size {
        return Err(invalid());
    }

    let mut main = None;
    let mut video = None;
    let mut audio = None;
    let mut at = 12;
    while at < size {
        active(&job.cancel, deadline)?;
        let (kind, len) = chunk(input, at, size)?;
        if &kind == b"LIST" && len >= 4 {
            match &read_at::<4>(input, at + 8)? {
                b"movi" => {
                    if streamed != (len == STREAM_SIZE) {
                        return Err(invalid());
                    }
                    return Ok(AviHeader {
                        main: main.ok_or_else(invalid)?,
                        video: video.ok_or_else(invalid)?,
                        audio,
                        movi: at,
                        movi_size: len,
                    });
                }
                b"hdrl" if main.is_none() => {
                    let stop = chunk_end(at, len, size)? - u64::from(len % 2);
                    let mut child = at + 12;
                    while child < stop {
                        active(&job.cancel, deadline)?;
                        let (kind, len) = chunk(input, child, stop)?;
                        let end = chunk_end(child, len, stop)?;
                        if &kind == b"avih" && len == 56 && main.is_none() {
                            main = Some(child + 8);
                        } else if &kind == b"LIST"
                            && len >= 68
                            && read_at::<12>(input, child + 8)? == *b"strlstrh\x38\0\0\0"
                        {
                            let stream = child + 20;
                            match &read_at::<8>(input, stream)? {
                                b"vidsFFV1" if video.is_none() && audio.is_none() => {
                                    video = Some(stream)
                                }
                                b"auds\x01\0\0\0" if video.is_some() && audio.is_none() => {
                                    audio = Some(stream)
                                }
                                _ => return Err(invalid()),
                            }
                        }
                        child = end;
                    }
                }
                _ => {}
            }
        }
        at = chunk_end(at, len, size)?;
    }
    Err(invalid())
}

fn validate_headers(job: &Job, input: &mut File, h: &AviHeader, streamed: bool) -> Result<u32> {
    let main = read_at::<40>(input, h.main)?;
    let expected_frames = if streamed { 0 } else { job.video.frame_count };
    let flags = word(&main, 12);
    if (flags & HAS_INDEX == 0) != streamed
        || word(&main, 16) != expected_frames
        || word(&main, 24) != 1 + u32::from(job.audio.is_some())
        || word(&main, 32) != job.video.width
        || word(&main, 36) != job.video.height
    {
        return Err(invalid());
    }
    let video = read_at::<36>(input, h.video)?;
    let scale = word(&video, 20);
    // FFmpeg leaves an unknown stream length on a non-seekable destination.
    let expected_length = |value, actual| {
        if streamed {
            matches!(value, 0 | STREAM_LENGTH)
        } else {
            value == actual
        }
    };
    if scale == 0
        || u64::from(word(&video, 24)) * u64::from(job.video.frame_rate.denominator)
            != u64::from(scale) * u64::from(job.video.frame_rate.numerator)
        || !expected_length(word(&video, 32), job.video.frame_count)
    {
        return Err(invalid());
    }
    match (h.audio, &job.audio) {
        (Some(at), Some(audio)) => {
            let stream = read_at::<48>(input, at)?;
            if word(&stream, 20) != 1
                || word(&stream, 24) != audio.sample_rate
                || !expected_length(word(&stream, 32), audio.frames as u32)
                || word(&stream, 44) != u32::from(audio.channels) * 2
            {
                return Err(invalid());
            }
        }
        (None, None) => {}
        _ => return Err(invalid()),
    }
    Ok(flags)
}

pub(super) fn finish(job: &Job, path: &Path, deadline: Instant) -> Result<()> {
    no_links(path)?;
    let mut input = File::open(path).map_err(err)?;
    let size = input.metadata().map_err(err)?.len();
    if !(12..=LIMIT).contains(&size) {
        return Err(invalid());
    }
    let h = header(job, &mut input, size, true, deadline)?;
    let flags = validate_headers(job, &mut input, &h, true)?;
    let mut output = OpenOptions::new().write(true).open(path).map_err(err)?;
    output.seek(SeekFrom::Start(size)).map_err(err)?;
    let mut index = BufWriter::new(output);
    if size + 8 > LIMIT {
        return Err("AVI index exceeds the FFmpeg output byte budget.".into());
    }
    index.write_all(b"idx1\0\0\0\0").map_err(err)?;
    let mut entries = 0u32;
    let mut frames = 0;
    let mut audio_bytes = 0;
    let expected_audio = job.audio.as_ref().map_or(0, |audio| audio.data_bytes());
    let mut at = h.movi + 12;
    while at < size {
        active(&job.cancel, deadline)?;
        let (kind, len) = chunk(&mut input, at, size)?;
        let end = chunk_end(at, len, size)?;
        let flags = match &kind {
            b"00dc" if len != 0 && frames < job.video.frame_count => {
                frames += 1;
                KEYFRAME // The fixed FFV1 profile makes every video packet intra-coded.
            }
            b"01wb"
                if job.audio.as_ref().is_some_and(|audio| {
                    len != 0 && len % (u32::from(audio.channels) * 2) == 0
                }) =>
            {
                audio_bytes += u64::from(len);
                if audio_bytes > expected_audio {
                    return Err(invalid());
                }
                KEYFRAME
            }
            _ => return Err(invalid()),
        };
        entries += 1;
        if size + 8 + 16 * u64::from(entries) > LIMIT {
            return Err("AVI index exceeds the FFmpeg output byte budget.".into());
        }
        index.write_all(&kind).map_err(err)?;
        index.write_all(&flags.to_le_bytes()).map_err(err)?;
        index
            .write_all(&((at - h.movi - 8) as u32).to_le_bytes())
            .map_err(err)?;
        index.write_all(&len.to_le_bytes()).map_err(err)?;
        at = end;
    }
    if frames != job.video.frame_count || audio_bytes != expected_audio {
        return Err(invalid());
    }
    let index_size = entries * 16;
    let mut output = index.into_inner().map_err(err)?;
    let mut patch = |at, value: u32| -> Result<()> {
        output.seek(SeekFrom::Start(at)).map_err(err)?;
        output.write_all(&value.to_le_bytes()).map_err(err)
    };
    active(&job.cancel, deadline)?;
    patch(4, size as u32 + index_size)?;
    patch(h.main + 12, flags | HAS_INDEX)?;
    patch(h.main + 16, frames)?;
    patch(h.video + 32, frames)?;
    if let (Some(at), Some(audio)) = (h.audio, &job.audio) {
        patch(at + 32, audio.frames as u32)?;
    }
    patch(h.movi + 4, (size - h.movi - 8) as u32)?;
    patch(size + 4, index_size)?;
    Ok(())
}

pub(super) fn check(job: &Job, input: &mut File, size: u64, deadline: Instant) -> Result<()> {
    if size < 12 {
        return Err(invalid());
    }
    let h = header(job, input, size, false, deadline)?;
    validate_headers(job, input, &h, false)?;
    let index = chunk_end(h.movi, h.movi_size, size)?;
    let (kind, len) = chunk(input, index, size)?;
    if &kind != b"idx1"
        || len % 16 != 0
        || len / 16 < job.video.frame_count
        || chunk_end(index, len, size)? != size
    {
        return Err(invalid());
    }
    Ok(())
}
