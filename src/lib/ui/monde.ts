// Copie générée depuis lun-docs/design/kit : ne pas modifier ici
/**
 * World of the view holding an element. Floating layers are portalled to the body, outside the view
 * root that carries `data-monde`: they copy it to keep the world's accent.
 */
export function mondeOf(node: Element | null | undefined): string | undefined {
  return node?.closest('[data-monde]')?.getAttribute('data-monde') ?? undefined;
}
