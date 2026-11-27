import { captureDimensions } from '../../../packages/export-web/src';
import { audioSampleRange } from '../../../packages/audio/src/pcm';
import type { Project } from '../../../packages/document/src';

export function ffmpegFrameRate(fps: number) {
  if (!Number.isFinite(fps) || fps <= 0) throw Error('Invalid FFmpeg frame rate.');
  const [digits, exponent = '0'] = String(fps).toLowerCase().split('e'),
    [integer, fraction = ''] = digits.split('.'),
    power = Number(exponent);
  let numerator = BigInt(integer + fraction),
    denominator = 10n ** BigInt(fraction.length);
  if (power > 0) numerator *= 10n ** BigInt(power);
  else denominator *= 10n ** BigInt(-power);
  const gcd = (a: bigint, b: bigint): bigint => (b ? gcd(b, a % b) : a),
    divisor = gcd(numerator, denominator);
  numerator /= divisor;
  denominator /= divisor;
  if (numerator > 2147483647n || denominator > 2147483647n)
    throw Error('Source frame rate cannot be represented exactly by FFmpeg.');
  return { numerator: Number(numerator), denominator: Number(denominator) };
}
export function ffmpegBundlePlan(
  project: Project,
  range: { start: number; end: number } | undefined,
  scale: number,
  transparent: boolean,
  includeAudio: boolean,
) {
  const { duration, fps, width, height, background } = project,
    start = range?.start ?? 0,
    end = range?.end ?? duration - 1;
  if (
    !Number.isSafeInteger(duration) ||
    duration < 1 ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    end < start ||
    end >= duration ||
    end + 1 > 2147483647 ||
    typeof transparent !== 'boolean' ||
    typeof includeAudio !== 'boolean'
  )
    throw Error('Invalid FFmpeg bundle range or flags.');
  const count = end - start + 1;
  if (count > 65534 - 2 - (includeAudio ? 1 : 0))
    throw Error('FFmpeg bundle exceeds the existing ZIP entry limit.');
  const size = captureDimensions(width, height, scale),
    rate = ffmpegFrameRate(fps);
  const inputArguments = [
    '-framerate',
    `${rate.numerator}/${rate.denominator}`,
    '-pattern_type',
    'sequence',
    '-start_number',
    String(start + 1),
    '-start_number_range',
    '1',
    '-i',
    'frame-%06d.png',
  ];
  if (includeAudio) inputArguments.push('-i', 'audio.wav');
  const arguments_ = [
    '-hide_banner',
    '-n',
    ...inputArguments,
    '-map',
    '0:v:0',
    ...(includeAudio ? ['-map', '1:a:0'] : []),
    '-frames:v',
    String(count),
    '-c:v',
    'ffv1',
    '-pix_fmt',
    'bgra',
    ...(includeAudio ? ['-c:a', 'pcm_s16le'] : []),
    'output.mkv',
  ];
  return {
    version: 1,
    kind: 'splash-ffmpeg-inputs',
    video: {
      pattern: 'frame-%06d.png',
      firstNumber: start + 1,
      frameCount: count,
      width: size.width,
      height: size.height,
      frameRate: rate,
      sourceStartFrame: start,
      sourceEndFrameExclusive: end + 1,
      timelineFrames: duration,
      sourceWidth: width,
      sourceHeight: height,
      scale,
      background: transparent ? 'transparent' : background,
      buttons: 'Up',
    },
    audio: includeAudio
      ? {
          file: 'audio.wav',
          format: 'pcm_s16le',
          sampleRate: 48000,
          ...audioSampleRange(start, end + 1, fps, 48000),
        }
      : null,
    executable: 'ffmpeg',
    inputArguments,
    suggestedArguments: arguments_,
    output: 'output.mkv',
    references: [
      'https://ffmpeg.org/ffmpeg-formats.html#image2',
      'https://ffmpeg.org/ffmpeg.html#Stream-selection',
    ],
    notice:
      'Extract to an empty folder. Nothing runs automatically. The Matroska example needs FFmpeg with FFV1 and PCM audio support.',
  };
}
