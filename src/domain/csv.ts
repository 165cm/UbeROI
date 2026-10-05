// CSVの読み取り（RFC 4180）。書き出しは analytics.ts の toCsv

export type CsvParseResult = { ok: true; rows: string[][] } | { ok: false; problem: string }

/**
 * CSVを行と列に分ける。先頭のBOMを外し、改行は CRLF／LF のどちらも受け付ける。
 * 引用符で囲んだ列の中のカンマ・改行・""（引用符そのもの）を扱う。中身が空の行は飛ばす。
 */
export function parseCsv(text: string): CsvParseResult {
  const src = text.startsWith('﻿') ? text.slice(1) : text
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  let i = 0
  const endRow = () => {
    row.push(cell)
    if (!(row.length === 1 && row[0] === '')) rows.push(row)
    row = []
    cell = ''
  }
  while (i < src.length) {
    const ch = src[i]!
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        quoted = false
        i++
        // 閉じた引用符の後は、区切りか行末だけ
        if (i < src.length && src[i] !== ',' && src[i] !== '\r' && src[i] !== '\n') {
          return { ok: false, problem: `${rows.length + 1}行目：引用符（"）の後に余分な文字があります` }
        }
        continue
      }
      cell += ch
      i++
      continue
    }
    if (ch === '"') {
      if (cell !== '') return { ok: false, problem: `${rows.length + 1}行目：列の途中に引用符（"）があります` }
      quoted = true
      i++
    } else if (ch === ',') {
      row.push(cell)
      cell = ''
      i++
    } else if (ch === '\r' || ch === '\n') {
      endRow()
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1
    } else {
      cell += ch
      i++
    }
  }
  if (quoted) return { ok: false, problem: '引用符（"）が閉じられていません' }
  if (cell !== '' || row.length > 0) endRow()
  return { ok: true, rows }
}
