#!/bin/bash
set -e

# Create temp directory
TMPDIR=$(mktemp -d)
echo "Test directory: $TMPDIR"

# Set up project
mkdir -p "$TMPDIR/specs"
mkdir -p "$TMPDIR/.bvf-state"

cat > "$TMPDIR/bvf.config" <<'EOF'
#config
  types: surface, fixture, instrument, behavior, feature
  containment:
    feature: behavior
  file-extension: .bvf
  state-dir: .bvf-state
#end
EOF

cat > "$TMPDIR/specs/test.bvf" <<'EOF'
#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior login-test
    Test login.
  #end
#end
EOF

# Compute real hashes using separate JS file
cat > /tmp/compute-hashes.js <<'JSEOF'
const { parseBvfFile } = require('/home/node/.openclaw/workspace/projects/bvf/dist/parser.js');
const { resolveReferences } = require('/home/node/.openclaw/workspace/projects/bvf/dist/resolver.js');
const { computeSpecHash, computeDependencyHash } = require('/home/node/.openclaw/workspace/projects/bvf/dist/manifest.js');
const { defaultConfig } = require('/home/node/.openclaw/workspace/projects/bvf/dist/config.js');
const { readFileSync, writeFileSync } = require('fs');
const { join } = require('path');

const tmpDir = process.argv[2];
const specContent = readFileSync(join(tmpDir, 'specs/test.bvf'), 'utf-8');

const config = defaultConfig();
const parseResult = parseBvfFile(specContent, config);
const entities = parseResult.value;
const resolveResult = resolveReferences(entities, config);
const resolved = resolveResult.ok ? resolveResult.value : entities;

const flatEntities = [];
for (const entity of resolved) {
  flatEntities.push(entity);
  if (entity.behaviors) {
    for (const behavior of entity.behaviors) {
      flatEntities.push({
        ...behavior,
        type: 'behavior',
        transitiveDependencies: entity.transitiveDependencies || []
      });
    }
  }
}

const specHashes = new Map();
for (const entity of flatEntities) {
  specHashes.set(entity.name, computeSpecHash(entity));
}

const loginTest = flatEntities.find(e => e.name === 'login-test');
const loginTestSpecHash = specHashes.get('login-test');
const loginTestDepHash = computeDependencyHash(loginTest, specHashes);

console.log(`login-test specHash: ${loginTestSpecHash}`);
console.log(`login-test depHash: ${loginTestDepHash}`);

// Create manifest
const manifest = {
  'login-test': {
    type: 'behavior',
    status: 'current',
    reason: 'needs-review',
    specHash: loginTestSpecHash,
    dependencyHash: loginTestDepHash,
    artifact: 'tests/login.test.ts',
    materializedAt: Date.now()
  }
};

writeFileSync(join(tmpDir, '.bvf-state/manifest.json'), JSON.stringify(manifest, null, 2));
console.log('Manifest created');
JSEOF

node /tmp/compute-hashes.js "$TMPDIR"

echo ""
echo "=== Initial manifest ==="
cat "$TMPDIR/.bvf-state/manifest.json"

echo ""
echo "=== Running mark command ==="
cd "$TMPDIR" && node /home/node/.openclaw/workspace/projects/bvf/dist/cli.js mark login-test test-reviewed

echo ""
echo "=== Manifest after mark ==="
cat "$TMPDIR/.bvf-state/manifest.json"

echo ""
echo "=== Running resolve ==="
cd "$TMPDIR" && node /home/node/.openclaw/workspace/projects/bvf/dist/cli.js resolve

# Clean up
rm -rf "$TMPDIR"
rm /tmp/compute-hashes.js
