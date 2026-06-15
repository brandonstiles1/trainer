export default function Loading() {
  return (
    <main className="p-6 space-y-6 animate-pulse">
      <div className="h-8 w-28 rounded-md bg-black/10" />
      <div className="space-y-2">
        <div className="h-4 w-20 rounded bg-black/5" />
        <div className="h-12 rounded-[13px] border border-[color:var(--hairline)] bg-black/[0.03]" />
      </div>
      <div className="space-y-2">
        <div className="h-4 w-20 rounded bg-black/5" />
        <div className="h-4 w-40 rounded bg-black/5" />
      </div>
    </main>
  );
}
