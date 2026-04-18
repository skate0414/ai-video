import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { StageBreadcrumb } from './StageBreadcrumb';

function renderAtRoute(path: string, projectId = 'proj-1') {
  return render(
    <MemoryRouter initialEntries={[`/${projectId}/${path}`]}>
      <Routes>
        <Route path=":projectId/:stage" element={<StageBreadcrumb />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('StageBreadcrumb', () => {
  it('renders nothing when no projectId param exists', () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/style']}>
        <Routes>
          <Route path=":stage" element={<StageBreadcrumb />} />
        </Routes>
      </MemoryRouter>,
    );
    // StageBreadcrumb returns null when no projectId
    expect(container.querySelector('nav')).toBeNull();
  });

  it('renders nothing for unknown stage path', () => {
    const { container } = renderAtRoute('unknown');
    expect(container.querySelector('nav')).toBeNull();
  });

  it('renders only "风格" on the style page', () => {
    renderAtRoute('style');
    expect(screen.getByText('风格')).toBeInTheDocument();
    expect(screen.queryByText('脚本')).not.toBeInTheDocument();
  });

  it('renders breadcrumb trail up to script page', () => {
    renderAtRoute('script');
    expect(screen.getByText('风格')).toBeInTheDocument();
    expect(screen.getByText('脚本')).toBeInTheDocument();
    expect(screen.queryByText('分镜')).not.toBeInTheDocument();
  });

  it('renders full trail up to production page', () => {
    renderAtRoute('production');
    expect(screen.getByText('风格')).toBeInTheDocument();
    expect(screen.getByText('脚本')).toBeInTheDocument();
    expect(screen.getByText('分镜')).toBeInTheDocument();
    expect(screen.getByText('制作')).toBeInTheDocument();
    expect(screen.queryByText('回放')).not.toBeInTheDocument();
  });

  it('renders all 5 stages on replay page', () => {
    renderAtRoute('replay');
    expect(screen.getByText('风格')).toBeInTheDocument();
    expect(screen.getByText('脚本')).toBeInTheDocument();
    expect(screen.getByText('分镜')).toBeInTheDocument();
    expect(screen.getByText('制作')).toBeInTheDocument();
    expect(screen.getByText('回放')).toBeInTheDocument();
  });

  it('disables the current stage button', () => {
    renderAtRoute('storyboard');
    const currentBtn = screen.getByText('分镜');
    expect(currentBtn).toBeDisabled();
  });

  it('enables ancestor stage buttons for navigation', () => {
    renderAtRoute('storyboard');
    expect(screen.getByText('风格')).toBeEnabled();
    expect(screen.getByText('脚本')).toBeEnabled();
  });

  it('navigates to ancestor stage on click', async () => {
    const user = userEvent.setup();
    renderAtRoute('production');

    // On production page, 脚本 is an ancestor → enabled
    expect(screen.getByText('脚本')).toBeEnabled();

    await user.click(screen.getByText('脚本'));

    // After click, router navigates to script page — 脚本 becomes current (disabled)
    // and stages after it (分镜, 制作) disappear from the trail
    expect(screen.getByText('脚本')).toBeDisabled();
    expect(screen.queryByText('分镜')).not.toBeInTheDocument();
    expect(screen.queryByText('制作')).not.toBeInTheDocument();
  });

  it('has accessible nav element with aria-label', () => {
    renderAtRoute('script');
    expect(screen.getByLabelText('Stage breadcrumb')).toBeInTheDocument();
  });

  it('renders ChevronRight separators between stages', () => {
    renderAtRoute('storyboard');
    // 3 stages shown (风格 > 脚本 > 分镜), so 2 separators
    const nav = screen.getByLabelText('Stage breadcrumb');
    const svgs = nav.querySelectorAll('svg');
    expect(svgs.length).toBe(2);
  });
});
