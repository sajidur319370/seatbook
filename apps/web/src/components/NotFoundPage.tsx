import { Link } from 'react-router';

export function NotFoundPage() {
  return (
    <main className="grid min-h-screen place-items-center p-4 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">Page not found</h1>
        <p className="text-gray-600">This page doesn't exist or may have moved.</p>
        <Link to="/" className="text-blue-600 hover:underline">
          Back to home
        </Link>
      </div>
    </main>
  );
}
