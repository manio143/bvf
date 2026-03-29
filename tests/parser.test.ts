import { describe, it, expect } from 'vitest';
import { parseEntity, parseBvfFile } from '../src/parser.js';

// Type definitions for test expectations
interface Param {
  name: string;
  required: boolean;
  defaultValue?: string;
}

interface Reference {
  name: string;
  args?: Record<string, string | { param: string }>;
}

interface Entity {
  type: string;
  name: string;
  params: Param[];
  clauses: Record<string, Reference>;
  body: string;
  references: Reference[];
  paramUsages: string[];
  behaviors?: Behavior[];
  context?: string;
}

interface Behavior {
  name: string;
  params: Param[];
  body: string;
  context?: string;
}

interface ParseResult {
  ok: boolean;
  value?: Entity[];
  errors?: Error[];
}

describe('entity-parsing', () => {
  it('parses-simple-entity', () => {
    const content = `
#decl surface web-app
  A Next.js application on localhost:3000.
#end
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(1);

    const entity = result.value![0];
    expect(entity.type).toBe('surface');
    expect(entity.name).toBe('web-app');
    expect(entity.params).toEqual([]);
    expect(entity.clauses).toEqual({});
    expect(entity.body).toContain('A Next.js application on localhost:3000.');
  });

  it('parses-entity-with-params', () => {
    const content = `
#decl fixture existing-user(email, password = "Default1!")
  A user with {email} and {password}.
#end
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(1);

    const entity = result.value![0];
    expect(entity.type).toBe('fixture');
    expect(entity.name).toBe('existing-user');
    expect(entity.params).toHaveLength(2);
    
    expect(entity.params[0]).toEqual({
      name: 'email',
      required: true,
      defaultValue: undefined
    });
    
    expect(entity.params[1]).toEqual({
      name: 'password',
      required: false,
      defaultValue: 'Default1!'
    });
    
    expect(entity.body).toContain('A user with {email} and {password}.');
  });

  it('parses-entity-with-clauses', () => {
    const content = `
#decl instrument login(email, password) on @{web-app}
  Navigate to /login and fill in credentials.
#end
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(1);

    const entity = result.value![0];
    expect(entity.type).toBe('instrument');
    expect(entity.name).toBe('login');
    expect(entity.params).toHaveLength(2);
    expect(entity.params[0].name).toBe('email');
    expect(entity.params[0].required).toBe(true);
    expect(entity.params[1].name).toBe('password');
    expect(entity.params[1].required).toBe(true);
    
    expect(entity.clauses).toHaveProperty('on');
    expect(entity.clauses.on).toEqual({ name: 'web-app' });
    
    expect(entity.references).toContainEqual({ name: 'web-app' });
  });

  it('parses-multiple-entities', () => {
    const content = `
Some prose text here.

#decl surface app1
  First app.
#end

More prose explaining things.

#decl fixture data1
  Some data.
#end

And another section of documentation.

#decl instrument tool1
  A tool.
#end
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(3);
    expect(result.value![0].name).toBe('app1');
    expect(result.value![1].name).toBe('data1');
    expect(result.value![2].name).toBe('tool1');
  });

  it('ignores-prose-between-entities', () => {
    const content = `
# Some documentation

This is just markdown prose explaining things.

#decl surface my-app
  An application.
#end

More prose here about design decisions.

#decl fixture my-data
  Some test data.
#end
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(2);
    expect(result.value![0].name).toBe('my-app');
    expect(result.value![1].name).toBe('my-data');
  });

  it('rejects-unclosed-decl', () => {
    const content = `
#decl surface broken
  This declaration is never closed.
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    expect(result.ok).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors!.length).toBeGreaterThan(0);
    expect(result.errors![0].message).toMatch(/unclosed.*#decl/i);
  });

  it('rejects-nested-decl', () => {
    const content = `
#decl surface outer
  #decl surface inner
    Nested declarations are not allowed.
  #end
#end
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    expect(result.ok).toBe(false);
    expect(result.errors).toBeDefined();
    expect(result.errors![0].message).toMatch(/#decl.*cannot.*nested/i);
  });
});

describe('feature-parsing', () => {
  it('parses-feature-with-context-and-behaviors', () => {
    const content = `
#decl feature registration on @{web-app}
  Registration flows.

  #context
    The application is running.
    Database is clean.
  #end

  #behavior valid-registration
    When submitting valid credentials.
    Then registration succeeds.
  #end

  #behavior invalid-email
    When submitting "bad-email".
    Then validation error is shown.
  #end
#end
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    expect(result.ok).toBe(true);
    expect(result.value).toHaveLength(1);

    const feature = result.value![0];
    expect(feature.type).toBe('feature');
    expect(feature.name).toBe('registration');
    expect(feature.clauses).toHaveProperty('on');
    expect(feature.clauses.on).toEqual({ name: 'web-app' });
    
    expect(feature.context).toBeDefined();
    expect(feature.context).toContain('The application is running.');
    expect(feature.context).toContain('Database is clean.');
    
    expect(feature.behaviors).toBeDefined();
    expect(feature.behaviors).toHaveLength(2);
    
    expect(feature.behaviors![0].name).toBe('valid-registration');
    expect(feature.behaviors![0].body).toContain('When submitting valid credentials.');
    expect(feature.behaviors![0].context).toBe(feature.context);
    
    expect(feature.behaviors![1].name).toBe('invalid-email');
    expect(feature.behaviors![1].body).toContain('Then validation error is shown.');
    expect(feature.behaviors![1].context).toBe(feature.context);
  });

  it('parses-feature-without-context', () => {
    const content = `
#decl feature simple-feature
  #behavior test1
    Test body.
  #end
#end
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    expect(result.ok).toBe(true);
    const feature = result.value![0];
    expect(feature.context).toBeUndefined();
    expect(feature.behaviors![0].context).toBeUndefined();
  });

  it('parses-for-each-expansion', () => {
    const content = `
#decl feature email-validation on @{web-app}
  #context
    App is running.
  #end

  #for email in ["not-an-email", "@missing", "spaces @x.com"]
  #behavior rejects-invalid-email({email})
    When submitting {email} as the email.
    Then a validation error is shown.
  #end
#end
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    expect(result.ok).toBe(true);
    const feature = result.value![0];
    
    expect(feature.behaviors).toHaveLength(3);
    expect(feature.behaviors![0].name).toBe('rejects-invalid-email("not-an-email")');
    expect(feature.behaviors![1].name).toBe('rejects-invalid-email("@missing")');
    expect(feature.behaviors![2].name).toBe('rejects-invalid-email("spaces @x.com")');
    
    // All behaviors inherit the context
    feature.behaviors!.forEach(behavior => {
      expect(behavior.context).toContain('App is running.');
    });
  });

  it('parses-for-each-with-tuples', () => {
    const content = `
#decl feature input-validation on @{web-app}
  #for field, value in [("email", ""), ("password", "short")]
  #behavior rejects-invalid({field}, {value})
    When submitting {value} in the {field} field.
    Then validation fails for {field}.
  #end
#end
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    expect(result.ok).toBe(true);
    const feature = result.value![0];
    
    expect(feature.behaviors).toHaveLength(2);
    expect(feature.behaviors![0].name).toBe('rejects-invalid("email", "")');
    expect(feature.behaviors![1].name).toBe('rejects-invalid("password", "short")');
  });

  it('rejects-multiple-context-blocks', () => {
    const content = `
#decl feature bad-feature
  #context
    First context.
  #end
  
  #context
    Second context.
  #end
#end
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toMatch(/only one.*#context/i);
  });

  it('rejects-behavior-outside-feature', () => {
    const content = `
#behavior orphaned-behavior
  This behavior is not inside a feature.
#end
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    expect(result.ok).toBe(false);
    expect(result.errors![0].message).toMatch(/#behavior.*inside.*feature/i);
  });
});

describe('reference-extraction', () => {
  it('extracts-bare-references', () => {
    const content = `
#decl instrument test-tool
  Uses @{web-app} and @{existing-user}.
#end
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    expect(result.ok).toBe(true);
    const entity = result.value![0];
    
    expect(entity.references).toHaveLength(2);
    expect(entity.references).toContainEqual({ name: 'web-app' });
    expect(entity.references).toContainEqual({ name: 'existing-user' });
  });

  it('extracts-parameterized-references', () => {
    const content = `
#decl behavior registration-test
  Call @{submit-registration}(email: "test@example.com", password: "Str0ng!").
#end
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    expect(result.ok).toBe(true);
    const entity = result.value![0];
    
    expect(entity.references).toHaveLength(1);
    expect(entity.references[0].name).toBe('submit-registration');
    expect(entity.references[0].args).toEqual({
      email: 'test@example.com',
      password: 'Str0ng!'
    });
  });

  it('extracts-param-passthrough-in-references', () => {
    const content = `
#decl instrument do-registration(email)
  Call @{submit-registration}(email: {email}, password: "default").
#end
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    expect(result.ok).toBe(true);
    const entity = result.value![0];
    
    expect(entity.references).toHaveLength(1);
    const ref = entity.references[0];
    expect(ref.name).toBe('submit-registration');
    expect(ref.args?.email).toEqual({ param: 'email' });
    expect(ref.args?.password).toBe('default');
  });

  it('extracts-own-param-usage', () => {
    const content = `
#decl instrument login-action(email, password)
  Fill {email} into the email field and {password} into password.
#end
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    expect(result.ok).toBe(true);
    const entity = result.value![0];
    
    expect(entity.paramUsages).toContain('email');
    expect(entity.paramUsages).toContain('password');
  });

  it('warns-on-undeclared-param-usage', () => {
    const content = `
#decl instrument broken-action(email)
  Fill {email} and also {phone} into the form.
#end
    `.trim();

    const result = parseBvfFile(content) as ParseResult;

    // This should parse successfully but include a warning
    expect(result.ok).toBe(true);
    const entity = result.value![0];
    
    expect(entity.paramUsages).toContain('phone');
    
    // The parser should flag that 'phone' is undeclared
    // (Implementation will add a warnings array or similar)
  });
});
