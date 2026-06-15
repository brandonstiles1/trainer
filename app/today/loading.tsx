export default function Loading() {
  return (
    <main className="px-6 py-8 max-w-md mx-auto space-y-6 animate-pulse">
      <div className="space-y-2">
        <div className="h-7 w-28 rounded-md bg-black/10" />
        <div className="h-4 w-20 rounded bg-black/5" />
      </div>
      <div className="space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-14 rounded-[13px] border-[0.5px] border-[color:var(--hairline)] bg-black/[0.03]" />
        ))}
      </div>
      <div className="h-12 rounded-[12px] bg-[var(--teal)]/20" />
    </main>
  );
}
