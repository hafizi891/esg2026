"""Optional "someone is talking" sensor, wired to an INMP441 mic on the Pi's
sound card — adapted from a standalone WebRTC-VAD speech detector script into
a background listener that plugs into app.py the same way listen_pir() does:
own a persistent stream, and only report real state transitions (talking
started/stopped) rather than every audio frame.

Split into two layers on purpose:
  - Pure DSP + state machine (convert_inmp441/calculate_rms/rms_to_dbfs/
    convert_to_pcm16, BandpassFilter, TalkingDetector) — no device I/O, so it
    can be driven with synthetic frames and unit-tested without real mic
    hardware.
  - listen_mic() — the actual sd.InputStream ownership, calibration, and
    reconnect-on-error loop. This part needs real hardware and the
    sounddevice/webrtcvad/scipy packages (see requirements.txt) — app.py
    imports this module in a try/except so a Pi without this mic attached,
    or a dev machine missing those optional packages, still runs everything
    else fine.
"""
import queue
import time
from collections import deque

import numpy as np
import sounddevice as sd
import webrtcvad
from scipy.signal import butter, sosfilt, sosfilt_zi

# Imported eagerly (not lazily inside functions) so a missing optional
# package fails right here, at `import mic_listener` — which is exactly what
# app.py's own try/except around that import is watching for. A lazy import
# deep inside listen_mic()'s reconnect loop would instead get silently
# swallowed by that loop's own broad except-and-retry, spamming "module not
# found" every 5 seconds forever instead of cleanly disabling the sensor once.

# ============================================================
# CONFIG — tuned against the actual wired INMP441 + room, not guessed
# ============================================================

DEVICE_INDEX = 1
SAMPLE_RATE = 48000
CHANNELS = 2
MIC_CHANNEL = 0
DTYPE = "int32"

# WebRTC VAD supports 10, 20, or 30 ms
FRAME_MS = 30
FRAME_SAMPLES = int(SAMPLE_RATE * FRAME_MS / 1000)

# 0 = least aggressive, 3 = most aggressive — mode 3 was rejecting normal
# conversational speech during testing.
VAD_MODE = 2

# How many dB above the measured noise floor before we count it as "loud enough"
NOISE_MARGIN_DB = 15.0
DEFAULT_MIN_DBFS = -55.0  # fallback if calibration doesn't run / fails
CALIBRATION_SECONDS = 2.0

# 20 frames x 30 ms = 600 ms rolling window; need >=8 speech-positive frames
# inside it before declaring TALKING.
START_WINDOW_FRAMES = 20
START_REQUIRED_SPEECH = 8

# Once talking, require ~2s without speech before declaring it stopped.
STOP_SILENCE_SECONDS = 2.0
STOP_SILENCE_FRAMES = int(STOP_SILENCE_SECONDS * 1000 / FRAME_MS)

INT24_MAX = 8388608.0  # signed 24-bit full scale, after the INMP441's >>8

# Bandpass ~250Hz-4000Hz: a proper causal IIR filter with state carried across
# blocks. A per-block FFT rectangular mask (the original approach) recomputes
# independently every 30ms with no windowing, which injects fake broadband
# energy at block edges (spectral leakage / Gibbs ringing) — that fake energy
# is what was tripping both the dBFS threshold and the VAD on silence. 250Hz
# (raised from 100Hz) cuts AC turbulence rumble, which sits mostly below that
# and was part of the noise floor spikes; human voice fundamentals are
# 85-255Hz (male) to 165-255Hz (female), but the energy that matters for
# VAD/loudness detection is in the harmonics above that anyway.
LOWCUT = 250.0
HIGHCUT = 4000.0
FILTER_ORDER = 4


def convert_inmp441(raw_samples):
    """This mic's data has its lower 8 bits unused — int32 container -> signed 24-bit sample."""
    return raw_samples >> 8


def calculate_rms(samples):
    samples = samples.astype(np.float64)
    return np.sqrt(np.mean(samples ** 2))


def rms_to_dbfs(rms):
    if rms <= 0:
        return -120.0
    return 20 * np.log10(rms / INT24_MAX)


def convert_to_pcm16(samples):
    """WebRTC VAD requires signed 16-bit PCM — approximate signed 24-bit -> signed 16-bit."""
    samples = np.clip(samples, -INT24_MAX, INT24_MAX - 1)
    samples_16 = np.clip(samples / 256.0, -32768, 32767)
    return samples_16.astype(np.int16)


class BandpassFilter:
    """Stateful IIR bandpass — state (zi) carried across calls so consecutive
    frames are filtered as one continuous stream, not independently."""

    def __init__(self):
        self._sos = butter(FILTER_ORDER, [LOWCUT, HIGHCUT], btype="bandpass", fs=SAMPLE_RATE, output="sos")
        self._zi = sosfilt_zi(self._sos)

    def apply(self, samples):
        samples = samples.astype(np.float64)
        samples = samples - np.mean(samples)  # remove DC per-block — cheap, safe
        filtered, self._zi = sosfilt(self._sos, samples, zi=self._zi)
        return filtered


class TalkingDetector:
    """Owns the speech state machine (start/stop smoothing + calibrated
    loudness threshold + WebRTC VAD), decoupled from the audio device itself
    so it can be driven by any frame source — a real mic stream, or synthetic
    frames in a test. Call process_frame() once per FRAME_SAMPLES-sized raw
    int32 block."""

    def __init__(self, min_dbfs=DEFAULT_MIN_DBFS):
        self._vad = webrtcvad.Vad(VAD_MODE)
        self._filter = BandpassFilter()
        self.min_dbfs = min_dbfs
        self.speech_history = deque(maxlen=START_WINDOW_FRAMES)
        self.silence_counter = 0
        self.talking = False

    def calibrate(self, frames):
        """frames: iterable of raw int32 blocks recorded during a silent/
        ambient period. Sets min_dbfs to that measured noise floor + margin,
        replacing the guessed DEFAULT_MIN_DBFS with a value based on the
        actual mic/room/preamp noise floor. Returns (noise_floor, min_dbfs)."""
        dbfs_samples = [rms_to_dbfs(calculate_rms(self._filter.apply(convert_inmp441(raw)))) for raw in frames]
        noise_floor = float(np.median(dbfs_samples))
        self.min_dbfs = noise_floor + NOISE_MARGIN_DB
        return noise_floor, self.min_dbfs

    def process_frame(self, raw):
        """Returns (talking, transitioned, dbfs) — `transitioned` is True only
        on the exact frame that flips `talking`, mirroring listen_pir()'s
        "only report real transitions" behavior rather than every frame."""
        samples = convert_inmp441(raw)
        filtered = self._filter.apply(samples)
        dbfs = rms_to_dbfs(calculate_rms(filtered))
        pcm_bytes = convert_to_pcm16(filtered).tobytes()

        try:
            vad_speech = self._vad.is_speech(pcm_bytes, SAMPLE_RATE)
        except Exception as e:
            print(f"Mic listener: VAD error: {e}")
            vad_speech = False

        is_speech = vad_speech and dbfs > self.min_dbfs
        self.speech_history.append(1 if is_speech else 0)
        speech_votes = sum(self.speech_history)

        transitioned = False
        if not self.talking:
            self.silence_counter = 0
            if len(self.speech_history) == START_WINDOW_FRAMES and speech_votes >= START_REQUIRED_SPEECH:
                self.talking = True
                transitioned = True
        else:
            if is_speech:
                self.silence_counter = 0
            else:
                self.silence_counter += 1
            if self.silence_counter >= STOP_SILENCE_FRAMES:
                self.talking = False
                self.silence_counter = 0
                self.speech_history.clear()
                transitioned = True

        return self.talking, transitioned, dbfs


def listen_mic(sensor_id, on_state_change):
    """Background thread (call via threading.Thread(..., daemon=True)): owns
    the mic's InputStream and drives a TalkingDetector off it, calling
    on_state_change(is_talking: bool) only when the smoothed state actually
    flips. `sensor_id` is accepted (but unused directly here) so a caller can
    close over it in the on_state_change callback — mirrors listen_pir()'s
    per-sensor thread shape in app.py.

    Reconnects on any stream/device error instead of taking the whole app
    down with it — this is one optional sensor among several, not core to
    the app's operation."""
    while True:
        try:
            audio_queue = queue.Queue()

            def callback(indata, frames, time_info, status):
                if status:
                    print(f"Mic listener: audio status: {status}")
                audio_queue.put(indata[:, MIC_CHANNEL].copy())

            detector = TalkingDetector()
            with sd.InputStream(
                device=DEVICE_INDEX,
                channels=CHANNELS,
                samplerate=SAMPLE_RATE,
                blocksize=FRAME_SAMPLES,
                dtype=DTYPE,
                callback=callback,
            ):
                n_frames = int(CALIBRATION_SECONDS * 1000 / FRAME_MS)
                calibration_frames = [audio_queue.get(timeout=5) for _ in range(n_frames)]
                noise_floor, min_dbfs = detector.calibrate(calibration_frames)
                print(f"Mic listener: noise floor {noise_floor:.1f} dBFS, threshold {min_dbfs:.1f} dBFS")

                while True:
                    raw = audio_queue.get(timeout=5)
                    talking, transitioned, dbfs = detector.process_frame(raw)
                    if transitioned:
                        # Printed directly to the console so a transition can
                        # be confirmed at the source — independent of the
                        # dashboard UI, which adds its own network/render lag
                        # and is easy to just not be watching at the right
                        # moment.
                        state = "STARTED talking" if talking else "STOPPED talking"
                        print(f"Mic listener: {state} (dbfs={dbfs:.1f}, threshold={detector.min_dbfs:.1f})")
                        on_state_change(talking)
        except Exception as e:
            print(f"Mic listener error: {e} — retrying in 5s")
            time.sleep(5)
