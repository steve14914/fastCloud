// 메모 본문(HTML)을 화면에 넣기 전에 허용한 태그와 속성만 남긴다.
// 메모는 나만 쓰지만, 혹시 이상한 HTML(스크립트 등)이 들어가도 실행되지 않게 하는 안전장치다.

const allowedTags = new Set([
  'B', 'STRONG', 'I', 'EM', 'U', 'S', 'STRIKE', 'FONT', 'SPAN', 'MARK',
  'P', 'DIV', 'BR', 'UL', 'OL', 'LI', 'H1', 'H2', 'H3', 'BLOCKQUOTE',
])
// 내용째 버리는 태그
const droppedTags = new Set(['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'TEMPLATE', 'SVG', 'MATH', 'LINK', 'META'])
// style 속성에서 남기는 항목과 값 모양 (색, 글자 크기)
const allowedStyles = ['background-color', 'font-size']
const safeStyleValue = /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%]+\)|transparent|[a-z-]+|[\d.]+(px|em|rem|%))$/i

export function sanitizeMemoHtml(html: string): string {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html')
  clean(doc.body)
  return doc.body.innerHTML
}

function clean(parent: Element) {
  for (const node of Array.from(parent.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) continue
    if (node.nodeType !== Node.ELEMENT_NODE) {
      node.remove() // 주석 등
      continue
    }
    const el = node as Element
    if (droppedTags.has(el.tagName)) {
      el.remove()
      continue
    }
    clean(el)
    if (!allowedTags.has(el.tagName)) {
      el.replaceWith(...Array.from(el.childNodes)) // 모르는 태그는 벗기고 내용만 남긴다
      continue
    }
    for (const attr of Array.from(el.attributes)) {
      if (!keepAttr(el, attr.name, attr.value)) el.removeAttribute(attr.name)
    }
    const style = (el as HTMLElement).style
    if (style?.length) {
      const kept = allowedStyles
        .map((p) => [p, style.getPropertyValue(p).trim()] as const)
        .filter(([, v]) => v && safeStyleValue.test(v))
      el.removeAttribute('style')
      for (const [p, v] of kept) (el as HTMLElement).style.setProperty(p, v)
    }
  }
}

function keepAttr(el: Element, name: string, value: string) {
  if (name === 'style') return true // 위에서 따로 거른다
  if (el.tagName === 'FONT' && name === 'size') return /^[1-7]$/.test(value)
  if (el.tagName === 'UL' && name === 'class') return value === 'checklist'
  if (el.tagName === 'LI' && name === 'data-checked') return value === 'true'
  return false
}

/** 본문에 보이는 내용이 하나도 없는지 (빈칸 안내 문구를 띄울지 정할 때) */
export function isEmptyHtml(el: HTMLElement) {
  return el.textContent === '' && !el.querySelector('li, img')
}
