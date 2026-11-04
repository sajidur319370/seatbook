import { Link } from 'react-router';

export function ForbiddenPage() {
  return (
    <div className="grid place-items-center py-16 text-center">
      <div className="space-y-2">
        <h1 className="text-2xl font-semibold">You don't have access to this page</h1>
        <p className="text-gray-600">Your account doesn't have permission to view it.</p>
        <Link to="/" className="text-blue-600 hover:underline">
          Back to home
        </Link>
      </div>
    </div>
  );
}
