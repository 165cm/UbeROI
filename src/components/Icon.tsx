/** 主要な移動先は、端末に左右されない線画で揃える。名前は隣の文字で伝える。 */
const paths = {
  clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  return: 'M9 5 3 11l6 6M3 11h12a5 5 0 0 1 0 10h-3',
  coins: 'M20 6c0 2-4 4-8 4S4 8 4 6s4-4 8-4 8 2 8 4ZM4 6v6c0 2 4 4 8 4s8-2 8-4V6M4 12v6c0 2 4 4 8 4s8-2 8-4v-6',
  bulb: 'M9 18h6m-5 4h4M8 14a6 6 0 1 1 8 0l-1 4H9ZM12 1v1M2 7l2 1m16 0 2-1',
  document: 'M6 2h8l5 5v15H5V2ZM14 2v6h5M8 12h8m-8 4h8',
  home: 'M3 10 12 3l9 7v11h-6v-7H9v7H3Z',
  plan: 'M5 5h14a2 2 0 0 1 2 2v13H3V7a2 2 0 0 1 2-2ZM7 3v4m10-4v4M3 11h18',
  records: 'M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01',
  analytics: 'M4 21V11m6 10V4m6 17v-7m5 7V7',
  settings: 'M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1ZM12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
} as const

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg className="ui-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d={paths[name]} /></svg>
}
