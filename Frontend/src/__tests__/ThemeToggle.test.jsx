// @vitest-environment jsdom

import React from 'react';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import { render, screen, fireEvent, cleanup } from '@testing-library/react';

import '@testing-library/jest-dom/vitest';

import ThemeToggle from '../components/ThemeToggle';
import SharedThemeToggle from '../components/shared/ThemeToggle';

describe('Theme switcher and localStorage persistence', () => {
  let mediaQuery;

  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove('dark');

    mediaQuery = {
      matches: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => mediaQuery)
    );
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    document.documentElement.classList.remove('dark');
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders an accessible theme toggle button', () => {
    render(<ThemeToggle />);

    expect(
      screen.getByRole('button', {
        name: 'Toggle application theme color',
      })
    ).toBeInTheDocument();
  });

  it('initializes light mode by default', () => {
    render(<ThemeToggle />);

    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('detects system dark mode preference', () => {
    mediaQuery.matches = true;

    render(<ThemeToggle />);

    expect(document.documentElement).toHaveClass('dark');
  });

  it('restores a saved dark theme', () => {
    localStorage.setItem('theme', JSON.stringify('dark'));

    render(<ThemeToggle />);

    expect(document.documentElement).toHaveClass('dark');
  });

  it('restores light mode despite system dark preference', () => {
    mediaQuery.matches = true;

    localStorage.setItem('theme', JSON.stringify('light'));

    render(<ThemeToggle />);

    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('switches from light to dark mode', () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button'));

    expect(document.documentElement).toHaveClass('dark');
  });

  it('persists dark mode in localStorage', () => {
    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button'));

    expect(JSON.parse(localStorage.getItem('theme'))).toBe('dark');
  });

  it('switches from dark to light mode and persists it', () => {
    localStorage.setItem('theme', JSON.stringify('dark'));

    render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button'));

    expect(document.documentElement).not.toHaveClass('dark');

    expect(JSON.parse(localStorage.getItem('theme'))).toBe('light');
  });

  it('restores the selected theme after remounting', () => {
    const { unmount } = render(<ThemeToggle />);

    fireEvent.click(screen.getByRole('button'));

    unmount();

    document.documentElement.classList.remove('dark');

    render(<ThemeToggle />);

    expect(document.documentElement).toHaveClass('dark');
  });

  it('handles corrupted localStorage data gracefully', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    localStorage.setItem('theme', 'invalid-json');

    render(<ThemeToggle />);

    expect(document.documentElement).not.toHaveClass('dark');
  });

  it('updates the shared toggle accessible label', () => {
    render(<SharedThemeToggle />);

    fireEvent.click(
      screen.getByRole('button', {
        name: 'Switch to dark mode',
      })
    );

    expect(
      screen.getByRole('button', {
        name: 'Switch to light mode',
      })
    ).toBeInTheDocument();
  });

  it('removes system preference listeners on unmount', () => {
    const { unmount } = render(<ThemeToggle />);

    const handler = mediaQuery.addEventListener.mock.calls[0][1];

    unmount();

    expect(mediaQuery.removeEventListener).toHaveBeenCalledWith('change', handler);
  });
});
