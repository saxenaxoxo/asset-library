import { afterEach, describe, expect, it } from 'vitest'
import { storage } from '../src/host'

function setLocalStorage(value: () => unknown): void {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get: value })
}

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'localStorage')
})

describe('storage', () => {
  it('reads and writes when localStorage works', () => {
    const data = new Map<string, string>()
    const fake = {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => void data.set(key, value),
      removeItem: (key: string) => void data.delete(key)
    }
    setLocalStorage(() => fake)
    storage.set('a', '1')
    expect(storage.get('a')).toBe('1')
    storage.remove('a')
    expect(storage.get('a')).toBeNull()
  })

  it('never throws when localStorage is missing or broken', () => {
    setLocalStorage(() => {
      throw new Error('denied')
    })
    expect(storage.get('a')).toBeNull()
    expect(() => storage.set('a', '1')).not.toThrow()
    expect(() => storage.remove('a')).not.toThrow()

    const throwing = (): never => {
      throw new Error('quota')
    }
    setLocalStorage(() => ({ getItem: throwing, setItem: throwing, removeItem: throwing }))
    expect(storage.get('a')).toBeNull()
    expect(() => storage.set('a', '1')).not.toThrow()
    expect(() => storage.remove('a')).not.toThrow()
  })
})
