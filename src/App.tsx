import { En } from './ui/En.tsx';

export function App() {
  return (
    <main className="mx-auto max-w-xl p-6 font-sans text-slate-900">
      <h1 className="mb-4 text-3xl font-bold">לומדים אנגלית</h1>
      <p className="text-lg">
        המילה הראשונה שלנו היא <En className="font-semibold">Hello, world!</En> — ברוכים הבאים.
      </p>
    </main>
  );
}
