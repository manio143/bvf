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

if (parseResult.ok && parseResult.value) {
  const entities = parseResult.value;
  const resolveResult = resolveReferences(entities, config);
  const resolved = resolveResult.ok ? resolveResult.value : entities;
  
  // Flatten behaviors
  const flatEntities = [];
  for (const entity of resolved) {
    flatEntities.push(entity);
    if (entity.behaviors) {
      for (const behavior of entity.behaviors) {
        // Copy transitiveDependencies from parent if needed
        const enrichedBehavior = {
          ...behavior,
          type: 'behavior',
          transitiveDependencies: entity.transitiveDependencies || []
        };
        flatEntities.push(enrichedBehavior);
      }
    }
  }
  
  // Find login-test
  const loginTest = flatEntities.find(e => e.name === 'login-test');
  console.log('login-test entity:');
  console.log(JSON.stringify(loginTest, null, 2));
  
  // Compute spec hashes
  const specHashes = new Map();
  for (const entity of flatEntities) {
    const hash = computeSpecHash(entity);
    specHashes.set(entity.name, hash);
  }
  
  // Compute dependency hash for login-test
  const depHash = computeDependencyHash(loginTest, specHashes);
  console.log(`\nlogin-test dependencyHash: ${depHash}`);
  console.log(`login-test specHash: ${specHashes.get('login-test')}`);
}
