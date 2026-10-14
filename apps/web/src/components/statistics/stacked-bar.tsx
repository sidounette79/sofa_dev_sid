interface StackedBarSegment {
  label: string;
  value: number;
  colorClass: string;
}

export function StackedBar({
  rowLabel,
  segments,
}: {
  rowLabel: string;
  segments: StackedBarSegment[];
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium">{rowLabel}</span>
        <span className="text-muted-foreground">{total}</span>
      </div>
      <div className="bg-muted/20 flex h-3 w-full overflow-hidden rounded-full">
        {total === 0 ? null : (
          segments.map((segment) => {
            if (segment.value === 0) return null;
            const pct = (segment.value / total) * 100;
            return (
              <div
                key={segment.label}
                className={`h-full ${segment.colorClass} bg-current`}
                style={{ width: `${pct}%` }}
                title={`${segment.label}: ${segment.value}`}
              />
            );
          })
        )}
      </div>
    </div>
  );
}
