import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ConfirmModal } from './ConfirmModal';

describe('ConfirmModal', () => {
  const defaultProps = {
    isOpen: true,
    title: '删除项目',
    description: '此操作不可恢复，数据将被永久移除。',
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when isOpen is false', () => {
    const { container } = render(
      <ConfirmModal {...defaultProps} isOpen={false} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders title and description when open', () => {
    render(<ConfirmModal {...defaultProps} />);
    expect(screen.getByText('删除项目')).toBeInTheDocument();
    expect(screen.getByText('此操作不可恢复，数据将被永久移除。')).toBeInTheDocument();
  });

  it('renders default confirm/cancel labels on buttons', () => {
    render(<ConfirmModal {...defaultProps} />);
    const buttons = screen.getAllByRole('button');
    const texts = buttons.map(b => b.textContent);
    expect(texts).toContain('确认');
    expect(texts).toContain('取消');
  });

  it('renders custom confirm/cancel labels', () => {
    render(
      <ConfirmModal
        {...defaultProps}
        confirmLabel="立即删除"
        cancelLabel="返回"
      />,
    );
    expect(screen.getByRole('button', { name: '立即删除' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '返回' })).toBeInTheDocument();
  });

  it('calls onConfirm when confirm button is clicked', async () => {
    const user = userEvent.setup();
    render(<ConfirmModal {...defaultProps} confirmLabel="立即删除" />);
    await user.click(screen.getByRole('button', { name: '立即删除' }));
    expect(defaultProps.onConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when cancel button is clicked', async () => {
    const user = userEvent.setup();
    render(<ConfirmModal {...defaultProps} cancelLabel="返回" />);
    await user.click(screen.getByRole('button', { name: '返回' }));
    expect(defaultProps.onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when backdrop is clicked', async () => {
    const user = userEvent.setup();
    const { container } = render(<ConfirmModal {...defaultProps} />);
    const backdrop = container.firstElementChild!;
    await user.click(backdrop);
    expect(defaultProps.onCancel).toHaveBeenCalledOnce();
  });

  it('does not call onCancel when modal card is clicked', async () => {
    const user = userEvent.setup();
    render(<ConfirmModal {...defaultProps} />);
    // Click on the title text (inside the card), not the backdrop
    await user.click(screen.getByText('删除项目'));
    expect(defaultProps.onCancel).not.toHaveBeenCalled();
    expect(defaultProps.onConfirm).not.toHaveBeenCalled();
  });

  it('calls onCancel when Escape is pressed', () => {
    render(<ConfirmModal {...defaultProps} />);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(defaultProps.onCancel).toHaveBeenCalledOnce();
  });

  it('calls onCancel when close X button is clicked', async () => {
    const user = userEvent.setup();
    render(<ConfirmModal {...defaultProps} />);
    // The X close button is the first button rendered (inside the card)
    const closeBtn = screen.getAllByRole('button')[0];
    await user.click(closeBtn);
    expect(defaultProps.onCancel).toHaveBeenCalledOnce();
  });

  it('focuses the confirm button after opening', async () => {
    render(<ConfirmModal {...defaultProps} confirmLabel="立即删除" />);
    await waitFor(() => {
      expect(screen.getByRole('button', { name: '立即删除' })).toHaveFocus();
    });
  });

  it('applies danger variant styling', () => {
    render(<ConfirmModal {...defaultProps} variant="danger" confirmLabel="立即删除" />);
    const btn = screen.getByRole('button', { name: '立即删除' });
    expect(btn.className).toContain('bg-red-600');
  });

  it('applies warning variant styling (default)', () => {
    render(<ConfirmModal {...defaultProps} variant="warning" confirmLabel="立即删除" />);
    const btn = screen.getByRole('button', { name: '立即删除' });
    expect(btn.className).toContain('bg-amber-600');
  });
});
