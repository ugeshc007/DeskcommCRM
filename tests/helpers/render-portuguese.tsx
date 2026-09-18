import { render as renderBase, type RenderOptions } from '@testing-library/react';
import type { ReactElement, ReactNode } from 'react';
import { IdiomaProvider } from '@/lib/i18n/IdiomaProvider';

/** Legacy Portuguese assertions choose their locale explicitly, without changing
 * the application's English default or mocking its translation implementation. */
export function render(ui: ReactElement, options: RenderOptions = {}) {
  const Outer = options.wrapper;
  function Wrapper({ children }: { children: ReactNode }) {
    const localized = <IdiomaProvider locale="pt-BR">{children}</IdiomaProvider>;
    return Outer ? <Outer>{localized}</Outer> : localized;
  }
  return renderBase(ui, { ...options, wrapper: Wrapper });
}
