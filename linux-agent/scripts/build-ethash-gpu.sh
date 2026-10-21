#!/bin/sh
# Build scdo-ethash-gpu. This binary is not part of the reproducible
# SHA256SUMS set: it links libOpenCL and is uploaded as its own CI artifact.
set -eu
cd "$(dirname "$0")/.."
src=cmd/scdo-ethash-gpu
out=${1:-dist/scdo-ethash-gpu}
mkdir -p "$(dirname "$out")" dist
python3 - "$src/ethash_search.cl" > dist/ethash_kernel_src.c <<'PY'
import pathlib, sys
data = pathlib.Path(sys.argv[1]).read_bytes()
print("const unsigned char ethash_kernel_src[] = {")
line = []
for i, b in enumerate(data):
    line.append(str(b))
    if len(line) == 16:
        print(",".join(line) + ",")
        line = []
if line:
    print(",".join(line) + ",")
print("};")
print("const unsigned int ethash_kernel_len = %d;" % len(data))
PY
cc -O2 -std=c11 -Wall -Wextra -o "$out" "$src/main.c" dist/ethash_kernel_src.c -lOpenCL
rm -f dist/ethash_kernel_src.c
echo "wrote $out"
