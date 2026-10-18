#!/bin/bash
# Build scdo-clminer for macOS arm64. Needs Xcode command line tools and cmake (pip install cmake==3.27.9 works).
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd); W=${WORK:-$HERE/.build}; CMAKE=${CMAKE:-cmake}
mkdir -p "$W"
if [ ! -f "$W/ethash/build/lib/ethash/libethash.a" ]; then
  rm -rf "$W/ethash"; git clone -q --depth 1 --branch v0.4.3 https://github.com/chfast/ethash.git "$W/ethash"
  (cd "$W/ethash" && mkdir -p build && cd build && "$CMAKE" .. -DETHASH_BUILD_TESTS=OFF -DHUNTER_ENABLED=OFF -DCMAKE_BUILD_TYPE=Release -DCMAKE_OSX_ARCHITECTURES=arm64 -DCMAKE_OSX_DEPLOYMENT_TARGET=12.0 >/dev/null && make -j8 >/dev/null)
fi
python3 - "$HERE/ethash.cl" "$W/kernel.h" <<'PY'
import sys
src = open(sys.argv[1]).read()
open(sys.argv[2], 'w').write('static const char* ETHASH_CL = R"ETHASHCL(' + src + ')ETHASHCL";\n')
PY
clang++ -std=c++17 -O2 -arch arm64 -mmacosx-version-min=12.0 -fobjc-arc -w -I "$W" -I "$W/ethash/include" "$HERE/clminer.mm" \
  $(find "$W/ethash/build" -name "*.a") -framework OpenCL -framework Foundation -o "${OUT:-$HERE/scdo-clminer}"
echo "built ${OUT:-$HERE/scdo-clminer}"
