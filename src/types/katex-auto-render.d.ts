declare module 'katex/contrib/auto-render' {
  export interface Delimiter {
    left: string
    right: string
    display: boolean
  }

  export interface RenderOptions {
    delimiters?: Delimiter[]
    throwOnError?: boolean
    errorColor?: string
    ignoredTags?: string[]
  }

  export default function renderMathInElement(
    element: HTMLElement,
    options?: RenderOptions,
  ): void
}
