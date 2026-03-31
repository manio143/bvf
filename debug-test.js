import { parseBvfFile } from './dist/parser.js';
import { resolveReferences } from './dist/resolver.js';
import { computeSpecHash, computeDependencyHash } from './dist/manifest.js';
import { defaultConfig } from './dist/config.js';

const specContent = `#decl surface my-surface
  Test.
#end

#decl feature auth on @{my-surface}
  #decl behavior login-test
    Test login.
  #end
#end
`;

const config = defaultConfig();
const parseResult = parseBvfFile(specContent, config);

console.log('Parse result:', JSON.stringify(parseResult, null, 2));

if (parseResult.ok && parseResult.value) {
  const entities = parseResult.value;
  const resolveResult = resolveReferences(entities, config);
  const resolved = resolveResult.ok ? resolveResult.value : entities;
  
  console.log('\nResolved entities:', JSON.stringify(resolved, null, 2));
  
  // Flatten behaviors
  const flatEntities = [];
  for (const entity of resolved) {
    flatEntities.push(entity);
    if (entity.behaviors) {
      for (const behavior of entity.behaviors) {
        flatEntities.push(behavior);
      }
    }
  }
  
  // Compute spec hashes
  const specHashes = new Map();
  for (const entity of flatEntities) {
    const hash = computeSpecHash(entity);
    specHashes.set(entity.name, hash);
    console.log(`\nEntity: ${entity.name} (${entity.type})`);
    console.log(`  specHash: ${hash}`);
  }
  
  // Compute dependency hashes
  for (const entity of flatEntities) {
    const depHash = computeDependencyHash(entity, specHashes);
    console.log(`\nEntity: ${entity.name}`);
    console.log(`  dependencyHash: ${depHash}`);
  }
}
