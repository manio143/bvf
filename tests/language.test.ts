import { describe, it, expect } from 'vitest';
import { parseBvfFile } from '../src/parser.js';
import type { BvfConfig } from '../src/types.js';

/**
 * Helper to parse BVF content directly.
 * This is the @{run-parse} instrument from surfaces.bvf.
 */
function runParse(content: string, config?: BvfConfig) {
  return parseBvfFile(content, config);
}

/**
 * Default config fixture for tests that need type validation.
 */
const defaultConfig: BvfConfig = {
  types: ['feature', 'behavior', 'endpoint', 'surface', 'fixture', 'instrument'],
  containment: new Map([
    ['feature', ['behavior', 'endpoint']]
  ]),
  fileExtension: '.bvf',
  stateDir: '.bvf-state'
};

describe('language-syntax', () => {
  
  // ========================================
  // Section 1: Fenced Code Blocks
  // ========================================
  
  it('fenced-code-ignored', () => {
    const content = `
Some prose.
\`\`\`
#decl example demo
#end
\`\`\`
#decl actual real-entity
#end
    `.trim();
    
    const result = runParse(content);
    
    expect(result.ok).toBe(true);
    expect(result.value?.length).toBe(1);
    expect(result.value![0].name).toBe('real-entity');
    
    // demo not in entities (was inside fence)
    const names = result.value!.map(e => e.name);
    expect(names).not.toContain('demo');
  });

  it('fenced-code-preserves-line-count', () => {
    const content = `Line 1
\`\`\`
Line 3 (in fence)
\`\`\`
#decl feature entity-on-line-5
#end`.trim();
    
    const result = runParse(content);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].line).toBe(5);
  });

  it('multiple-fenced-blocks', () => {
    const content = `
\`\`\`
#decl example first-fence
#end
\`\`\`
Some prose.
\`\`\`
#decl example second-fence
#end
\`\`\`
#decl feature actual-entity
#end
    `.trim();
    
    const result = runParse(content);
    
    expect(result.ok).toBe(true);
    expect(result.value?.length).toBe(1);
    expect(result.value![0].name).toBe('actual-entity');
  });

  // ========================================
  // Section 2: #for Expansion
  // ========================================

  it('for-expansion-basic', () => {
    const content = `
#decl feature api on @{system}
  #for service in [auth, payment, shipping]
    #decl endpoint {service}-health
      Health check for {service}.
    #end
  #end
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].behaviors?.length).toBe(3);
    expect(result.value![0].behaviors![0].name).toBe('auth-health');
    expect(result.value![0].behaviors![1].name).toBe('payment-health');
    expect(result.value![0].behaviors![2].name).toBe('shipping-health');
    expect(result.value![0].behaviors![0].body).toContain('auth');
  });

  it('for-expansion-with-quoted-strings', () => {
    const content = `
#decl feature tests on @{suite}
  #for lang in [python, javascript, rust]
    #decl behavior test-{lang}
      Run tests for {lang}.
    #end
  #end
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].behaviors![0].body).toContain('"python"');
    expect(result.value![0].behaviors![1].body).toContain('"javascript"');
    expect(result.value![0].behaviors![2].body).toContain('"rust"');
  });

  it('for-expansion-multi-variable', () => {
    const content = `
#decl feature matrix on @{ci}
  #for os, version in [(linux, 20.04), (macos, 13), (windows, 2022)]
    #decl behavior test-{os}-{version}
      Test on {os} version {version}.
    #end
  #end
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].behaviors?.length).toBe(3);
    expect(result.value![0].behaviors![0].name).toBe('test-linux-20.04');
    expect(result.value![0].behaviors![1].name).toBe('test-macos-13');
    expect(result.value![0].behaviors![2].name).toBe('test-windows-2022');
  });

  it('for-requires-in-keyword', () => {
    const content = `
#decl feature bad on @{system}
  #for service [auth, payment]
    #decl endpoint {service}-health
    #end
  #end
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toContain('#for requires "in" keyword');
  });

  it('for-requires-array-syntax', () => {
    const content = `
#decl feature bad on @{system}
  #for service in auth, payment
    #decl endpoint {service}-health
    #end
  #end
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toContain('#for requires array syntax [...]');
  });

  it('for-requires-container', () => {
    const content = `
#for service in [auth, payment]
  #decl endpoint {service}-health
  #end
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toContain('#for cannot be used outside a container entity');
  });

  it('for-closes-with-end', () => {
    const content = `
#decl feature api on @{system}
  #for service in [auth, payment]
    #decl endpoint {service}-health
    #end
  #end
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
  });

  it('for-tuple-count-mismatch', () => {
    const content = `
#decl feature bad on @{system}
  #for os, version in [(linux, 20.04), (macos)]
    #decl behavior test-{os}-{version}
    #end
  #end
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toContain('expected 2 values per tuple');
  });

  it('for-single-var-quotes-strings', () => {
    const content = `
#decl feature tests on @{suite}
  #for x in ["auth", "payment"]
    #decl behavior test-{x}
      Testing {x}
    #end
  #end
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].behaviors![0].body).toContain('"auth"');
    expect(result.value![0].behaviors![1].body).toContain('"payment"');
  });

  it('for-multi-var-no-quotes', () => {
    const content = `
#decl feature matrix on @{ci}
  #for x, y in [("auth", 1), ("payment", 2)]
    #decl behavior {x}-{y}
      Service {x} has priority {y}
    #end
  #end
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].behaviors![0].body).toContain('auth');
    expect(result.value![0].behaviors![0].body).toContain('1');
  });

  it('for-nested-loops-supported', () => {
    const content = `
#decl feature matrix on @{platform}
  #for service in ["auth", "payment"]
    #for env in ["dev", "prod"]
      #decl behavior {service}-{env}-test
        Test {service} on {env}
      #end
    #end
  #end
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].behaviors?.length).toBe(4);
    const names = result.value![0].behaviors!.map(b => b.name);
    expect(names).toContain('auth-dev-test');
    expect(names).toContain('auth-prod-test');
    expect(names).toContain('payment-dev-test');
    expect(names).toContain('payment-prod-test');
  });

  it('for-nested-variable-scoping', () => {
    const content = `
#decl feature nested on @{system}
  #for outer in ["a", "b"]
    #for inner in [1, 2]
      #decl behavior {outer}-{inner}
        Content uses {outer} and {inner}
      #end
    #end
  #end
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].behaviors?.length).toBe(4);
    const names = result.value![0].behaviors!.map(b => b.name);
    expect(names).toContain('a-1');
    expect(names).toContain('a-2');
    expect(names).toContain('b-1');
    expect(names).toContain('b-2');
  });

  it('for-validates-template-variables', () => {
    const content = `
#decl feature test on @{api}
  #for service in ["auth"]
    #decl behavior {service}-check
      Content uses {service} and {unknown}
    #end
  #end
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toContain('undefined variable {unknown}');
    expect(result.errors![0].message).toContain('available: service');
  });

  // ========================================
  // Section 3: Parameterized References
  // ========================================

  it('reference-with-single-param', () => {
    const content = `
#decl behavior check-health on @{api}(endpoint="/health")
  Verify the health endpoint.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].clauses.on.name).toBe('api');
    expect(result.value![0].clauses.on.args?.endpoint).toBe('/health');
  });

  it('reference-with-multiple-params', () => {
    const content = `
#decl behavior login using @{auth}(email="test@x.com", password="secret")
  Authenticate user.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].clauses.using.name).toBe('auth');
    expect(result.value![0].clauses.using.args?.email).toBe('test@x.com');
    expect(result.value![0].clauses.using.args?.password).toBe('secret');
  });

  it('bare-reference-valid', () => {
    const content = `
#decl behavior test on @{api}
  Test the API.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].clauses.on.name).toBe('api');
    expect(result.value![0].clauses.on.args).toBeUndefined();
  });

  it('inline-reference-with-params', () => {
    const content = `
#decl behavior test
  Call @{api}(method="GET", path="/users").
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].references.length).toBeGreaterThanOrEqual(1);
    const apiRef = result.value![0].references.find(r => r.name === 'api');
    expect(apiRef).toBeDefined();
    expect(apiRef!.args?.method).toBe('GET');
    expect(apiRef!.args?.path).toBe('/users');
  });

  it('reference-param-from-entity-param', () => {
    const content = `
#decl behavior login(email) using @{auth}(email: {email})
  Authenticate with provided email.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].clauses.using.args?.email).toEqual({ param: 'email' });
  });

  // ========================================
  // Section 4: Optional Parameters
  // ========================================

  it('optional-param-syntax', () => {
    const content = `
#decl endpoint health(timeout?)
  Check system health.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].params.length).toBe(1);
    expect(result.value![0].params[0].name).toBe('timeout');
    expect(result.value![0].params[0].required).toBe(false);
  });

  it('required-param-syntax', () => {
    const content = `
#decl endpoint create-user(email)
  Create a new user.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].params[0].name).toBe('email');
    expect(result.value![0].params[0].required).toBe(true);
  });

  it('param-with-default-value', () => {
    const content = `
#decl endpoint health(timeout="5000")
  Check system health.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].params[0].name).toBe('timeout');
    expect(result.value![0].params[0].required).toBe(false);
    expect(result.value![0].params[0].defaultValue).toBe('5000');
  });

  it('mixed-required-optional-params', () => {
    const content = `
#decl endpoint create-user(email, name?, role="user")
  Create a new user with optional name and default role.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].params.length).toBe(3);
    expect(result.value![0].params[0].name).toBe('email');
    expect(result.value![0].params[0].required).toBe(true);
    expect(result.value![0].params[1].name).toBe('name');
    expect(result.value![0].params[1].required).toBe(false);
    expect(result.value![0].params[2].name).toBe('role');
    expect(result.value![0].params[2].required).toBe(false);
    expect(result.value![0].params[2].defaultValue).toBe('user');
  });

  // ========================================
  // Section 5: Basic Entity Declaration
  // ========================================

  it('decl-basic-syntax', () => {
    const content = `
#decl feature user-auth
  Authentication system.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].type).toBe('feature');
    expect(result.value![0].name).toBe('user-auth');
    expect(result.value![0].body.trim()).toBe('Authentication system.');
  });

  it('decl-with-params', () => {
    const content = `
#decl endpoint health(timeout?, retries="3")
  Health check endpoint.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].params.length).toBe(2);
  });

  it('decl-hyphenated-type-name', () => {
    const config: BvfConfig = {
      types: ['http-endpoint', 'feature', 'behavior'],
      containment: new Map(),
      fileExtension: '.bvf',
      stateDir: '.bvf-state'
    };
    
    const content = `
#decl http-endpoint health
  Health check.
#end
    `.trim();
    
    const result = runParse(content, config);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].type).toBe('http-endpoint');
  });

  it('decl-hyphenated-entity-name', () => {
    const content = `
#decl feature user-auth-system
  Multi-word feature name.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].name).toBe('user-auth-system');
  });

  it('decl-closes-with-end', () => {
    const content = `
#decl feature auth
  Body content.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].body.trim()).toBe('Body content.');
  });

  it('decl-unclosed-error', () => {
    const content = `
#decl feature auth
  Body content.
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toContain('unclosed #decl for auth');
  });

  it('decl-invalid-type-error', () => {
    const content = `
#decl unknown-type entity-name
  Content.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toContain('unknown type "unknown-type"');
  });

  it('decl-nesting-rules', () => {
    const content = `
#decl feature auth
  #decl behavior login
    Login flow.
  #end
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].behaviors?.length).toBe(1);
    expect(result.value![0].behaviors![0].name).toBe('login');
  });

  it('decl-invalid-nesting-error', () => {
    const content = `
#decl behavior outer
  #decl feature inner
    Invalid nesting.
  #end
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toContain('invalid nesting');
    expect(result.errors![0].message).toContain('type "feature" cannot be nested inside "behavior"');
  });

  // ========================================
  // Section 6: Clauses
  // ========================================

  it('clause-on-basic', () => {
    const content = `
#decl behavior check-health on @{api}
  Verify API health.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].clauses.on.name).toBe('api');
  });

  it('clause-using-basic', () => {
    const content = `
#decl behavior login using @{auth}
  Authenticate user.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].clauses.using.name).toBe('auth');
  });

  it('clause-with-params', () => {
    const content = `
#decl behavior test on @{api}(base_url="http://localhost")
  Test API locally.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].clauses.on.args?.base_url).toBe('http://localhost');
  });

  it('multiple-clauses', () => {
    const content = `
#decl behavior secure-check on @{api} using @{auth}
  Authenticated API check.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].clauses.on.name).toBe('api');
    expect(result.value![0].clauses.using.name).toBe('auth');
  });

  // ========================================
  // Section 7: References Extraction
  // ========================================

  it('references-from-body', () => {
    const content = `
#decl behavior integration-test
  First call @{login}.
  Then verify @{user-profile}.
  Finally @{logout}.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].references.length).toBe(3);
    const refNames = result.value![0].references.map(r => r.name);
    expect(refNames).toContain('login');
    expect(refNames).toContain('user-profile');
    expect(refNames).toContain('logout');
  });

  it('references-include-clauses', () => {
    const content = `
#decl behavior test on @{api} using @{auth}
  Call @{health}.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].references.length).toBe(3);
    const refNames = result.value![0].references.map(r => r.name);
    expect(refNames).toContain('api');
    expect(refNames).toContain('auth');
    expect(refNames).toContain('health');
  });

  it('references-deduplicated', () => {
    const content = `
#decl behavior test
  Call @{api}.
  Then call @{api} again.
  Finally @{api} once more.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].references.length).toBe(1);
    expect(result.value![0].references[0].name).toBe('api');
  });

  // ========================================
  // Section 8: Parameter Usages
  // ========================================

  it('param-usage-extraction', () => {
    const content = `
#decl behavior login(email, password)
  Login with {email} and {password}.
  Verify {email} format.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].paramUsages.length).toBe(2);
    expect(result.value![0].paramUsages).toContain('email');
    expect(result.value![0].paramUsages).toContain('password');
  });

  it('param-usage-deduplicated', () => {
    const content = `
#decl behavior test(value)
  Use {value} here.
  And {value} there.
  And {value} everywhere.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].paramUsages.length).toBe(1);
    expect(result.value![0].paramUsages[0]).toBe('value');
  });

  // ========================================
  // Section 9: Template Syntax (for #for expansion)
  // ========================================

  it('template-name-with-placeholders', () => {
    const content = `
#decl feature services on @{platform}
  #for svc in [auth, payment]
    #decl endpoint {svc}-health
      Health check.
    #end
  #end
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value![0].behaviors![0].name).toBe('auth-health');
    expect(result.value![0].behaviors![1].name).toBe('payment-health');
  });

  it('template-body-substitution', () => {
    const content = `
#decl feature tests on @{suite}
  #for lang in [python, rust]
    #decl behavior test-{lang}
      Run {lang} tests using {lang} toolchain.
    #end
  #end
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    const pythonBody = result.value![0].behaviors![0].body;
    const rustBody = result.value![0].behaviors![1].body;
    
    // Single-variable #for quotes string values
    expect(pythonBody).toContain('"python"');
    expect(rustBody).toContain('"rust"');
  });

  // ========================================
  // Section 10: Error Recovery
  // ========================================

  it('invalid-decl-syntax', () => {
    const content = `
#decl feature
  Missing name.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toContain('invalid #decl syntax');
  });

  it('invalid-param-syntax', () => {
    const content = `
#decl endpoint test(bad param name)
  Invalid param.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toContain('invalid parameter syntax');
  });

  it('parser-skips-to-next-decl', () => {
    const content = `
#decl bad-entity
  Unclosed entity.

#decl feature good-entity
  This one is closed.
#end
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.errors!.length).toBeGreaterThanOrEqual(1);
    // Parser should recover and parse good-entity
    if (result.value && result.value.length > 0) {
      const names = result.value.map(e => e.name);
      expect(names).toContain('good-entity');
    }
  });

  // ========================================
  // Section 11: Prose and Comments
  // ========================================

  it('prose-ignored', () => {
    const content = `
This is regular prose explaining the spec.

#decl feature auth
  Authentication.
#end

More prose here.
    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value!.length).toBe(1);
    expect(result.value![0].name).toBe('auth');
  });

  it('empty-lines-ignored', () => {
    const content = `


#decl feature auth
  Authentication.
#end


    `.trim();
    
    const result = runParse(content, defaultConfig);
    
    expect(result.ok).toBe(true);
    expect(result.value!.length).toBe(1);
  });
});
