// スクショの文字の読み取り：端末の中で動く文字認識（tesseract.js・日本語）。画像も文字も外へ送らない。
// 必要なファイルはこのアプリと同じ場所の ocr/ から、使う時だけ読み込む（vite.config.ts・sw.template.js）

/** 画像を順に読み、文字をつなげて返す（1つのクエストの画面を2枚に分けて撮った時など） */
export async function recognizeImages(files: readonly Blob[]): Promise<string> {
  const { createWorker } = await import('tesseract.js')
  const base = new URL(`${import.meta.env.BASE_URL}ocr/`, location.href).href
  const worker = await createWorker('jpn', 1, {
    workerPath: `${base}worker.min.js`,
    corePath: base,
    langPath: base.replace(/\/$/, ''),
    gzip: true,
    // 読み取りのデータは Service Worker が端末に保存するので、ブラウザーの別の保存場所は使わない
    cacheMethod: 'none',
    workerBlobURL: false,
  })
  try {
    const texts: string[] = []
    for (const f of files) texts.push((await worker.recognize(f)).data.text)
    return texts.join('\n')
  } finally {
    await worker.terminate()
  }
}
