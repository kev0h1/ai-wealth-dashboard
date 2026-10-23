"""Original restrained editorial sound, deterministically synthesised locally.

Five soft impacts mark cuts; arithmetic gets small tactile clicks. No voice,
licensed recording or external service. Render once before freezing the media.
"""
import math
import random
import struct
import subprocess
import tempfile
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/public/design-media/c22/features"
RATE = 44100
DURATION = 15

def render(story):
    audio = [0.0] * (RATE * DURATION)
    rng = random.Random(22 + ("movement", "month", "spend", "split", "penny", "aside").index(story))
    def pluck(at, note, volume=.12, duration=.5):
        start = int(at * RATE)
        for i in range(min(int(duration * RATE), len(audio) - start)):
            t = i / RATE
            envelope = (1 - math.exp(-t * 180)) * math.exp(-t * 8) * min(1, (duration - t) * 40)
            # Felt-like fundamental, very little high-frequency energy.
            value = math.sin(math.tau * note * t) + .22 * math.sin(math.tau * note * 2 * t) * math.exp(-t * 10)
            audio[start + i] += value * envelope * volume
    def click(at, volume=.035):
        start = int(at * RATE)
        previous = 0
        for i in range(min(int(.08 * RATE), len(audio) - start)):
            previous = .75 * previous + .25 * rng.uniform(-1, 1)
            audio[start + i] += previous * math.exp(-i / RATE * 65) * volume
    # A single quiet recurring motif, not a relentless UI ping on every element.
    for at, note in [(0, 164.81), (65/30, 220), (140/30, 246.94), ((260 if story == "penny" else 225)/30, 329.63), (355/30, 164.81)]:
        pluck(at, note, .105, .8)
        click(at, .09)
    for at in ([76/30, 93/30, 110/30] if story != "penny" else [157/30, 200/30, 260/30]):
        click(at, .12)
    # Brand resolution: a quiet two-note chord with a soft decay.
    pluck(12.15, 246.94, .045, 1.7)
    pluck(12.15, 329.63, .045, 1.7)
    with tempfile.TemporaryDirectory(prefix="c22-sound-") as temp:
        raw = Path(temp) / "raw.wav"
        with wave.open(str(raw), "wb") as wav:
            wav.setnchannels(1)
            wav.setsampwidth(2)
            wav.setframerate(RATE)
            wav.writeframes(b"".join(struct.pack("<h", max(-32767, min(32767, int(sample * 32767)))) for sample in audio))
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(raw), "-af", "loudnorm=I=-20:TP=-2:LRA=8", "-ar", str(RATE), "-ac", "1", "-c:a", "pcm_s16le", str(OUT / f"{story}-sound.wav")], check=True)
    print(story, "sound design exported")

if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for story in ("movement", "month", "spend", "split", "penny", "aside"):
        render(story)
