export default function Loading() {
  return (
    <main className="px-4 py-6 max-w-md mx-auto pb-24 animate-pulse">
      <div className="h-8 w-36 rounded-md bg-black/10 px-1" />
      <div className="mt-4 space-y-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[68px] rounded-[13px] border-[0.5px] border-[color:var(--hairline)] bg-black/[0.03]" />
        ))}
      </div>
    </main>
  );
}
