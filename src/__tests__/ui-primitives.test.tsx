import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatusDot } from '@/components/ui/status-dot';
import { PanelHeader, PanelToolbar } from '@/components/ui/panel-chrome';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';

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