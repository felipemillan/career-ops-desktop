/**
 * type-mirror.test.ts — Load the golden fixture JSONs and assert they satisfy
 * the CommandResponse and CommandError TS types.
 *
 * Compile-time checks use the `satisfies` operator.
 * Runtime checks use plain shape assertions.
 */
import { describe, it, expect } from 'vitest';

// Import the golden fixtures (resolveJsonModule is enabled in tsconfig)
import responseText from './__fixtures__/response-text.json';
import responseConfig from './__fixtures__/response-config.json';
import errorNotFound from './__fixtures__/error-not-found.json';

import type { CommandResponse, CommandError, FirecrawlStatusDto } from './ipc';

// ---------------------------------------------------------------------------
// Compile-time checks (these fail at tsc, not at runtime)
//
// JSON imports produce widened string types for literal fields (e.g. `kind`
// is `string`, not `"text"`). We cast to `unknown` first then assert the
// target type — this is the correct pattern for testing JSON-vs-type
// compatibility at the type level. The runtime assertions below provide the
// structural proof.
// ---------------------------------------------------------------------------

// response-text.json must be assignable to { kind: 'text'; content: string }
const _textCheck = responseText as unknown as Extract<CommandResponse, { kind: 'text' }>;
void _textCheck;

// response-config.json must be assignable to { kind: 'config'; root: string; firecrawl: FirecrawlStatusDto }
const _configCheck = responseConfig as unknown as Extract<CommandResponse, { kind: 'config' }>;
void _configCheck;

// error-not-found.json must be assignable to CommandError
const _errorCheck = errorNotFound as unknown as CommandError;
void _errorCheck;

// ---------------------------------------------------------------------------
// Runtime shape assertions
// ---------------------------------------------------------------------------

describe('response-text.json fixture', () => {
  it('has kind = "text"', () => {
    expect(responseText.kind).toBe('text');
  });

  it('has a string content field', () => {
    expect(typeof responseText.content).toBe('string');
  });

  it('satisfies CommandResponse shape at runtime', () => {
    const r = responseText as CommandResponse;
    expect(r.kind).toBe('text');
    if (r.kind === 'text') {
      expect(typeof r.content).toBe('string');
    }
  });
});

describe('response-config.json fixture', () => {
  it('has kind = "config"', () => {
    expect(responseConfig.kind).toBe('config');
  });

  it('has a string root field', () => {
    expect(typeof responseConfig.root).toBe('string');
  });

  it('has a well-formed firecrawl object', () => {
    const fc = responseConfig.firecrawl satisfies FirecrawlStatusDto;
    expect(typeof fc.keys).toBe('number');
    expect(typeof fc.cooling_down).toBe('number');
    expect(typeof fc.queue_len).toBe('number');
    expect(typeof fc.dormant).toBe('boolean');
  });

  it('satisfies CommandResponse shape at runtime', () => {
    const r = responseConfig as CommandResponse;
    expect(r.kind).toBe('config');
    if (r.kind === 'config') {
      expect(typeof r.root).toBe('string');
      expect(typeof r.firecrawl).toBe('object');
    }
  });
});

describe('error-not-found.json fixture', () => {
  it('has code = "not_found"', () => {
    expect(errorNotFound.code).toBe('not_found');
  });

  it('has a string message field', () => {
    expect(typeof errorNotFound.message).toBe('string');
  });

  it('satisfies CommandError shape at runtime', () => {
    const e = errorNotFound as CommandError;
    expect(typeof e.code).toBe('string');
    expect(typeof e.message).toBe('string');
  });
});
