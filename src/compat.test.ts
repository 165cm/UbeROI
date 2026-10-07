// 古い iPhone の Safari でも読み込めること：読み込めない書き方が1つでもあると、アプリ全体が真っ白になる
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) return sourceFiles(path)
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : []
  })
}

describe('古い Safari との互換', () => {
  it('正規表現の後ろ読み（(?<=…)・(?<!…)）を使わない（iOS 16.3 までの Safari は読み込めない）', () => {
    const found = sourceFiles('src').filter((f) => /\(\?<[=!]/.test(readFileSync(f, 'utf8')))
    expect(found).toEqual([])
  })
})
