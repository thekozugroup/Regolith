"""Interleaved import-only benchmark; never invokes either watchdog main()."""

import json
from pathlib import Path
import statistics
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
CODE = (
    "import sys,time; "
    "wall=time.perf_counter(); cpu=time.process_time(); "
    "exec(compile(open(sys.argv[1]).read(), sys.argv[1], 'exec'), "
    "{'__name__':'benchmark_only'}); "
    "print(time.perf_counter()-wall, time.process_time()-cpu)"
)


def main():
    reps = int(sys.argv[1]) if len(sys.argv) > 1 else 15
    if not 1 <= reps <= 100:
        raise SystemExit("repetitions must be between 1 and 100")
    samples = {"original": [], "candidate": []}
    paths = {
        "original": ROOT / "printer-helpers/fixtures/original-light-watchdog.py",
        "candidate": ROOT / "printer-helpers/light-watchdog.py",
    }
    for index in range(reps):
        order = ("original", "candidate") if index % 2 == 0 else ("candidate", "original")
        for name in order:
            started = time.perf_counter()
            result = subprocess.run([sys.executable, "-c", CODE, str(paths[name])],
                                    check=True, capture_output=True, text=True)
            elapsed = time.perf_counter() - started
            import_wall, import_cpu = map(float, result.stdout.split())
            samples[name].append({"process_wall_sec": elapsed,
                                  "import_wall_sec": import_wall,
                                  "import_cpu_sec": import_cpu})
    summary = {}
    for name, values in samples.items():
        summary[name] = {key: statistics.median(item[key] for item in values)
                         for key in values[0]}
    print(json.dumps({"python": sys.executable, "repetitions": reps,
                      "median": summary, "samples": samples}, indent=2))


if __name__ == "__main__":
    main()
