import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { IdiomaProvider, useT } from '@/lib/i18n/IdiomaProvider';
import { render as renderPortuguese } from '@/tests/helpers/render-portuguese';
import { IDIOMA_PADRAO } from '@/lib/i18n/idiomas';

function Example() { const t = useT(); return <button>{t('Contatos')}</button>; }
afterEach(cleanup);
describe('explicit test locale and production fallback', () => {
  it('still defaults to English without a provider', () => {
    expect(IDIOMA_PADRAO).toBe('en');
    render(<Example />);
    expect(screen.getByRole('button', { name: 'Contacts' })).toBeInTheDocument();
  });
  it('Portuguese fixtures use the real provider and survive rerender', () => {
    const view = renderPortuguese(<Example />);
    expect(screen.getByRole('button', { name: 'Contatos' })).toBeInTheDocument();
    view.rerender(<Example />);
    expect(screen.getByRole('button', { name: 'Contatos' })).toBeInTheDocument();
  });
  it('an explicit English locale remains English inside a Portuguese fixture', () => {
    renderPortuguese(<IdiomaProvider locale="en"><Example /></IdiomaProvider>);
    expect(screen.getByRole('button', { name: 'Contacts' })).toBeInTheDocument();
  });
  it('retains a caller supplied wrapper', () => {
    renderPortuguese(<Example />, { wrapper: ({ children }) => <section aria-label="Fixture">{children}</section> });
    expect(screen.getByRole('region', { name: 'Fixture' })).toHaveTextContent('Contatos');
  });
});
