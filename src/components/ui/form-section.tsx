import type { ReactNode } from 'react';
import { Label } from './label';

interface FormSectionProps {
  title?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}

/** Grouped settings block, in the shape of a macOS inset form section. */
export function FormSection({ title, footer, children }: FormSectionProps) {
  return (
    <section className="space-y-1.5">
      {title ? (
        <h3 className="px-3 text-[length:var(--text-secondary)] font-semibold text-muted-foreground">{title}</h3>
      ) : null}
      <div className="overflow-hidden rounded-[10px] bg-[var(--grouped-bg)]">
        <div className="space-y-4 p-3">{children}</div>
      </div>
      {footer ? <p className="px-3 text-[length:var(--text-secondary)] text-muted-foreground">{footer}</p> : null}
    </section>
  );
}

interface FormRowProps {
  label: ReactNode;
  description?: ReactNode;
  htmlFor?: string;
  children: ReactNode;
}

/** Label on the left, control on the right. */
export function FormRow({ label, description, htmlFor, children }: FormRowProps) {
  return (
    <div className="flex min-h-9 items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0">
      <div className="min-w-0 flex-1">
        <Label htmlFor={htmlFor} className="text-[length:var(--text-body)]">{label}</Label>
        {description ? <p className="text-[length:var(--text-secondary)] text-muted-foreground">{description}</p> : null}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}
