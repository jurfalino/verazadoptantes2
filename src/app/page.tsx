import SearchSection from '@/components/SearchSection';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-50 via-white to-blue-50">
      <div className="container mx-auto px-4 py-12">
        <header className="text-center mb-12">
          <h1 className="text-4xl md:text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 to-blue-500 mb-4">
            SafeAdoption
          </h1>
          <p className="text-gray-600 text-lg max-w-xl mx-auto">
            The single source of truth for pet adoptions. Vet potential adopters and ensure your animals go to safe homes.
          </p>
        </header>

        <SearchSection />

        <footer className="mt-20 text-center text-gray-400 text-sm">
          <p>© 2026 SafeAdoption. Protecting pets together.</p>
        </footer>
      </div>
    </main>
  );
}
