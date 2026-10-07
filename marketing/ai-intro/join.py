"""Join intro + reel. Usage: join.py intro.mp4 [--overlap 6] [--out path]. overlap 0 = hard cut."""
import argparse
import subprocess

from common import OUT, REEL

ap = argparse.ArgumentParser()
ap.add_argument("intro")
ap.add_argument("--reel", default=str(REEL))
ap.add_argument("--overlap", type=int, default=6, help="crossfade frames at 30fps; 0 = hard cut")
ap.add_argument("--out", default=str(OUT / "joined.mp4"))
a = ap.parse_args()


def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration",
                                          "-of", "csv=p=0", p]).decode())


norm = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p"
d_intro = dur(a.intro)
if a.overlap > 0:
    ov = a.overlap / 30
    fc = (f"[0:v]{norm}[a];[1:v]{norm}[b];"
          f"[a][b]xfade=transition=fade:duration={ov}:offset={d_intro - ov:.4f}[v]")
else:
    fc = f"[0:v]{norm}[a];[1:v]{norm}[b];[a][b]concat=n=2:v=1:a=0[v]"
OUT.mkdir(exist_ok=True)
# Silent stereo audio track so platforms accept the file; length trimmed to video via -shortest.
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", a.intro, "-i", a.reel,
                "-f", "lavfi", "-i", "anullsrc=r=44100:cl=stereo",
                "-filter_complex", fc, "-map", "[v]", "-map", "2:a",
                "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-r", "30",
                "-c:a", "aac", "-shortest", "-movflags", "+faststart", a.out], check=True)
print(a.out, f"duration {dur(a.out):.3f}s expected {d_intro + dur(a.reel) - (a.overlap / 30 if a.overlap else 0):.3f}s")
