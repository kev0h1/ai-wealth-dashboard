"""Round 2 story assembly: introA -(4f)- introB -(6f)- REEL -(6f)- outro.
Usage: assemble.py introA.mp4 introB.mp4 outro.mp4 [--out path]
Audio: intro/outro audio kept; the reel section gets a looped, ducked copy of introB's street ambience."""
import argparse
import subprocess

from common import OUT, REEL

ap = argparse.ArgumentParser()
ap.add_argument("a"); ap.add_argument("b"); ap.add_argument("outro")
ap.add_argument("--reel", default=str(REEL))
ap.add_argument("--out", default=str(OUT / "night-out.mp4"))
ap.add_argument("--bed-gain", type=float, default=0.5, help="linear gain of the ambience bed under the reel")
a = ap.parse_args()
F = 1 / 30


def dur(p):
    return float(subprocess.check_output(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", p]).decode())


dA, dB, dR, dO = dur(a.a), dur(a.b), dur(a.reel), dur(a.outro)
x1, x2, x3 = 4 * F, 6 * F, 6 * F
offAB = dA - x1
offBR = offAB + dB - x2   # reel start on the timeline
offRO = offBR + dR - x3   # outro start
total = offRO + dO
norm = "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1,fps=30,format=yuv420p"
v = (f"[0:v]{norm}[a];[1:v]{norm}[b];[2:v]{norm}[r];[3:v]{norm}[o];"
     f"[a][b]xfade=transition=fade:duration={x1:.4f}:offset={offAB:.4f}[ab];"
     f"[ab][r]xfade=transition=fade:duration={x2:.4f}:offset={offBR - 0:.4f}[abr];"
     f"[abr][o]xfade=transition=fade:duration={x3:.4f}:offset={offRO:.4f}[v];")
ms = lambda t: int(round(t * 1000))
bed_start, bed_len = offBR - 0.3, dR + 0.6
au = (f"[0:a]aresample=44100,aformat=channel_layouts=stereo,afade=t=out:st={dA - x1:.4f}:d={x1:.4f}[a0];"
      f"[1:a]aresample=44100,aformat=channel_layouts=stereo,afade=t=in:st=0:d={x1:.4f},afade=t=out:st={dB - x2:.4f}:d={x2:.4f},adelay={ms(offAB)}|{ms(offAB)}[a1];"
      f"[3:a]aresample=44100,aformat=channel_layouts=stereo,afade=t=in:st=0:d={x3:.4f},adelay={ms(offRO)}|{ms(offRO)}[a3];"
      f"[1:a]aresample=44100,aformat=channel_layouts=stereo,aloop=loop=-1:size=2000000,atrim=0:{bed_len:.3f},asetpts=PTS-STARTPTS,"
      f"volume={a.bed_gain},afade=t=in:st=0:d=0.5,afade=t=out:st={bed_len - 0.5:.3f}:d=0.5,adelay={ms(bed_start)}|{ms(bed_start)}[bed];"
      f"[a0][a1][a3][bed]amix=inputs=4:normalize=0:duration=longest,atrim=0:{total:.4f}[aout]")
OUT.mkdir(exist_ok=True)
subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", a.a, "-i", a.b, "-i", a.reel, "-i", a.outro,
                "-filter_complex", v + au, "-map", "[v]", "-map", "[aout]",
                "-c:v", "libx264", "-crf", "16", "-preset", "medium", "-r", "30", "-c:a", "aac", "-b:a", "128k",
                "-movflags", "+faststart", a.out], check=True)
print(a.out, f"duration {dur(a.out):.3f}s expected {total:.3f}s")
print(f"timeline: introA 0-{dA:.3f}  introB {offAB:.3f}-{offAB + dB:.3f}  reel {offBR:.3f}-{offBR + dR:.3f}  outro {offRO:.3f}-{total:.3f}")
