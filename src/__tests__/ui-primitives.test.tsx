import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusDot } from '@/components/ui/status-dot';
import { PanelHeader, PanelToolbar } from '@/components/ui/panel-chrome';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';

beforeEach(() => {
  vi.stubGlobal('ResizeObserver', class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('StatusDot', () => {
  it('renders connected variant with semantic class', () => {
    render(<StatusDot variant="connected" data-testid="dot" />);
    const dot = screen.getByTestId('dot');
    expect(dot.getAttribute('data-variant')).toBe('connected');
    expect(dot.className).toContain('bg-status-connected');
  });

  it('renders pending variant with pulse animation', () => {
    render(<StatusDot variant="pending" data-testid="dot" />);
    const dot = screen.getByTestId('dot');
    expect(dot.className).toContain('animate-pulse');
    expect(dot.className).toContain('bg-status-pending');
  });
});

describe('PanelChrome', () => {
  it('renders panel header and toolbar slots', () => {
    render(
      <div>
        <PanelHeader data-testid="header">Header</PanelHeader>
        <PanelToolbar data-testid="toolbar">Toolbar</PanelToolbar>
      </div>,
    );
    expect(screen.getByTestId('header').getAttribute('data-slot')).toBe('panel-header');
    expect(screen.getByTestId('toolbar').getAttribute('data-slot')).toBe('panel-toolbar');
  });

  it('uses fixed h-8 chrome height for default density', () => {
    render(
      <div>
        <PanelHeader data-testid="header">Header</PanelHeader>
        <PanelToolbar data-testid="toolbar">Toolbar</PanelToolbar>
      </div>,
    );
    expect(screen.getByTestId('header').className).toContain('h-8');
    expect(screen.getByTestId('toolbar').className).toContain('h-8');
  });
});

describe('Tabs variants', () => {
  it('renders underline variant on list and trigger', () => {
    render(
      <Tabs defaultValue="a">
        <TabsList variant="underline" data-testid="list">
          <TabsTrigger variant="underline" value="a">
            Tab A
          </TabsTrigger>
        </TabsList>
      </Tabs>,
    );
    expect(screen.getByTestId('list').getAttribute('data-variant')).toBe('underline');
    expect(screen.getByRole('tab').getAttribute('data-variant')).toBe('underline');
    expect(screen.getByTestId('list').className).toContain('border-b');
  });
});

describe('Interactive control colours', () => {
  it('uses the primary colour for slider progress and focus state', () => {
    const { container } = render(<Slider value={[50]} />);
    expect(container.querySelector('[data-slot="slider-range"]')?.className).toContain('bg-primary');
    expect(container.querySelector('[data-slot="slider-thumb"]')?.className).toContain('border-primary');
  });

  it('uses the primary colour for checked switches', () => {
    render(<Switch checked aria-label="Enabled" />);
    expect(screen.getByRole('switch').className).toContain('data-[state=checked]:bg-primary');
  });
});
