import { memo } from 'react';
import { Badge } from '../ui';

const SUPPORTED_FORMATS = [
  { label: 'PDF', variant: 'gold' },
  { label: 'JPG', variant: 'teal' },
  { label: 'PNG', variant: 'teal' },
  { label: 'TIFF', variant: 'muted' },
  { label: 'WEBP', variant: 'muted' },
] as const;

export const FormatBadge = memo(function FormatBadge() {
  return (
    <div className="flex flex-wrap gap-1.5 justify-center">
      {SUPPORTED_FORMATS.map((f) => (
        <Badge key={f.label} variant={f.variant}>
          {f.label}
        </Badge>
      ))}
    </div>
  );
});
