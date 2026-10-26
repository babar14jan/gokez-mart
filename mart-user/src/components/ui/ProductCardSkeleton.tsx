export default function ProductCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-2xl border border-cream-200 bg-white shadow-card dark:border-slate-700 dark:bg-slate-800">
      <div className="aspect-square animate-pulse bg-cream-100 dark:bg-slate-700" />
      <div className="space-y-2 p-3">
        <div className="h-3 w-4/5 animate-pulse rounded-full bg-cream-200 dark:bg-slate-700" />
        <div className="h-3 w-2/5 animate-pulse rounded-full bg-cream-200 dark:bg-slate-700" />
        <div className="h-4 w-1/2 animate-pulse rounded-full bg-cream-200 dark:bg-slate-700" />
      </div>
    </div>
  );
}
