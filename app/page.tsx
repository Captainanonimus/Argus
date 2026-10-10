export default function Home() {
  return (
    <main className="min-h-screen p-8">
      <div className="rounded-lg bg-panel p-6">
        <h1 className="font-display text-4xl">Argus</h1>
        <p className="mt-2">Theme check</p>
        <p className="mt-4 font-mono tabular">
          <span className="text-bid">101.25</span>{" "}
          <span className="text-ask">101.30</span>{" "}
          <span className="text-alert">ALERT</span>
        </p>
      </div>
    </main>
  );
}
