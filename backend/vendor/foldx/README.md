# FoldX binary vendoring

Drop the **Linux x86_64** FoldX binary here as `foldx` (chmod +x), plus
`rotabase.txt` if your FoldX version requires it.

## Why this is here

FoldX BuildModel is what computes the ΔΔG column in the matrix and rebuilds
mutant receptor structures before docking. It's license-restricted (academic
free, commercial paid), so we can't fetch it in a `RUN apt-get install` — the
binary has to come with the build context.

## Where to get it

Sign in at https://foldxsuite.crg.eu/ → Downloads → pick the Linux build
matching your license. Untar and copy the binary into this directory:

```bash
cp ~/Downloads/foldx_*/foldx ./foldx
chmod +x ./foldx
# rotabase only ships with some versions:
[ -f ~/Downloads/foldx_*/rotabase.txt ] && cp ~/Downloads/foldx_*/rotabase.txt .
```

Then `fly deploy` from the repo root and the Dockerfile will pick it up.

## Platform note

The binary your Mac uses (`/Users/arash/.local/bin/foldx`) is **Mach-O
x86_64** — macOS. The container is Linux. The Linux FoldX binary is a
separate download from the same vendor with the same license.

## When this directory is empty

The `foldx` ENV var still gets set in the Docker image, but the file won't
exist. The runner detects this at job time and skips FoldX BuildModel; the
ΔΔG column reads `null` and the mutant docking falls back to the WT
structure. Everything else (docking, pose viewer, ProLIF, PoseBusters)
keeps working.

## What lives here

* `foldx` — the binary itself (Linux). Not committed (in .gitignore).
* `rotabase.txt` — energy parameter file, if your FoldX version needs it.
  Not committed.
* `README.md` — this file. Committed.
