"""Extract reel frame 0 and 1 (1080x1920) as the join anchor."""
import subprocess
import sys

from common import OUT, REEL

d = OUT / "handoff"
d.mkdir(parents=True, exist_ok=True)
frames = [int(x) for x in sys.argv[1:]] or [0, 1]
for n in frames:
    p = d / f"reel-f{n}.png"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(REEL), "-vf",
                    f"select=eq(n\\,{n}),scale=1080:1920", "-frames:v", "1", str(p)], check=True)
    print(p)
