import { describe, it, expect } from 'vitest';
import { h32, rnd01, mulberry32, vnoise, fbm } from './rng.js';

describe('rng', () => {
  it('h32 jest deterministyczny i bezstanowy', () => {
    const first = h32(12, 34, 56, 78);
    for (let i = 0; i < 1000; i++) {
      h32(i, i * 7, i * 13, i * 29); // szum między wywołaniami
      expect(h32(12, 34, 56, 78)).toBe(first);
    }
  });

  it('rnd01 mieści się w [0,1)', () => {
    for (let i = 0; i < 5000; i++) {
      const v = rnd01(i, i * 3, 7, 1);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('h32 rozprasza sąsiednie współrzędne', () => {
    // sąsiednie komórki nie mogą dawać skorelowanych wartości,
    // bo teren zrobi się pasiasty
    const a = rnd01(100, 100, 1, 0);
    const b = rnd01(101, 100, 1, 0);
    const c = rnd01(100, 101, 1, 0);
    expect(Math.abs(a - b)).toBeGreaterThan(0.01);
    expect(Math.abs(a - c)).toBeGreaterThan(0.01);
  });

  it('mulberry32 daje ten sam ciąg dla tego samego seeda', () => {
    const a = mulberry32(1337);
    const b = mulberry32(1337);
    for (let i = 0; i < 200; i++) expect(a()).toBe(b());
  });

  it('vnoise jest ciągły i mieści się w [0,1]', () => {
    const a = vnoise(10.0, 10.0, 3);
    const b = vnoise(10.01, 10.0, 3);
    expect(Math.abs(a - b)).toBeLessThan(0.05);
    for (let i = 0; i < 500; i++) {
      const v = vnoise(i * 0.37, i * 0.11, 3);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it('fbm jest odtwarzalny i znormalizowany', () => {
    for (let i = 0; i < 300; i++) {
      const x = i * 0.13;
      const y = i * 0.29;
      const v = fbm(x, y, 42, 5);
      expect(v).toBe(fbm(x, y, 42, 5));
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
